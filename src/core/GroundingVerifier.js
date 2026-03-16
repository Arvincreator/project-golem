// ============================================================
// GroundingVerifier — RAG-backed claim verification + confidence scoring
// Modes: off (zero overhead), quick (heuristic), full (LLM-assisted)
// ============================================================

class GroundingVerifier {
    constructor(options = {}) {
        this.mode = options.mode || process.env.GROUNDING_MODE || 'off';
        this._magma = null;
        try {
            this._magma = require('../memory/graph/ma_gma');
        } catch (_) { /* MAGMA optional */ }
    }

    /**
     * Full verification pipeline
     */
    async verify(response, query, options = {}) {
        if (this.mode === 'off') {
            return {
                verifiedResponse: response,
                confidence: null,
                sources: [],
                flags: [],
                selfConsistent: null,
            };
        }

        if (this.mode === 'quick') {
            const confidence = this.quickConfidence(response, query);
            return {
                verifiedResponse: response,
                confidence,
                sources: [],
                flags: [],
                selfConsistent: null,
            };
        }

        // Full mode
        const claims = this._extractClaims(response);
        const ragResults = this._checkAgainstRAG(claims);

        let selfConsistency = null;
        if (options.brain && options.enableSelfConsistency) {
            selfConsistency = await this._selfConsistencyCheck(query, response, options.brain);
        }

        const confidence = this._computeConfidence(ragResults, selfConsistency);
        const verifiedResponse = this._formatWithAttribution(response, ragResults);

        const flags = ragResults
            .filter(r => r.status === 'CONTRADICTED')
            .map(r => ({
                claim: r.claim.text,
                reason: 'Contradicted by knowledge graph',
                severity: 'high',
            }));

        const sources = ragResults
            .filter(r => r.status === 'SUPPORTED' && r.sources.length > 0)
            .map(r => ({
                text: r.claim.text,
                entityId: r.sources[0].id,
                confidence: r.confidence,
            }));

        return {
            verifiedResponse,
            confidence,
            sources,
            flags,
            selfConsistent: selfConsistency ? selfConsistency.consistent : null,
        };
    }

    /**
     * Heuristic claim extraction (split sentences, filter non-factual)
     */
    _extractClaims(response) {
        if (!response) return [];
        // Split on sentence boundaries (CJK + Latin)
        const sentences = response
            .split(/(?<=[.!?。！？\n])\s*/)
            .map(s => s.trim())
            .filter(s => s.length > 5);

        // Filter out non-factual sentences (questions, greetings, filler)
        const nonFactual = /^(hi|hello|okay|sure|thanks|嗨|好的|謝謝|你好|I think|Maybe|Perhaps|可能|也許)/i;
        const factual = sentences
            .filter(s => !nonFactual.test(s))
            .filter(s => {
                // Must contain at least one noun-like word, number, or CJK content
                return /[A-Z][a-z]+|\d+|[\u4e00-\u9fff]{2,}/.test(s);
            });

        return factual.map((text, index) => ({ text, index }));
    }

    /**
     * Check each claim against MAGMA knowledge graph
     */
    _checkAgainstRAG(claims) {
        if (!this._magma || !claims.length) {
            return claims.map(c => ({
                claim: c,
                status: 'UNVERIFIED',
                sources: [],
                confidence: 0.0,
            }));
        }

        return claims.map(claim => {
            const result = this._queryByClaim(claim.text);

            if (result.nodes.length === 0) {
                return { claim, status: 'UNVERIFIED', sources: [], confidence: 0.0 };
            }

            // Check for contradictions vs support
            const topNode = result.nodes[0];
            const relevanceScore = topNode._relevanceScore || 0;

            if (relevanceScore >= 0.5) {
                return {
                    claim,
                    status: 'SUPPORTED',
                    sources: result.nodes.slice(0, 3),
                    confidence: Math.min(relevanceScore * 1.2, 1.0),
                };
            }

            // Low relevance = unverified, not contradicted
            return { claim, status: 'UNVERIFIED', sources: [], confidence: relevanceScore };
        });
    }

    /**
     * Targeted factual overlap search against MAGMA
     */
    _queryByClaim(claimText) {
        if (!this._magma) return { nodes: [], edges: [] };

        // Extract key terms (nouns, proper nouns, numbers)
        const terms = claimText
            .replace(/[^\w\u4e00-\u9fff\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 2)
            .slice(0, 5);

        if (terms.length === 0) return { nodes: [], edges: [] };

        // Query MAGMA with combined key terms
        const queryStr = terms.join(' ');
        return this._magma.query(queryStr);
    }

    /**
     * Self-consistency check: re-ask brain, compare key claims
     */
    async _selfConsistencyCheck(query, response, brain) {
        try {
            const prompt = `回答以下問題，用簡潔的事實陳述:\n${query}`;
            const secondResponse = await brain.sendMessage(prompt, true);

            if (!secondResponse || typeof secondResponse !== 'string') {
                return { consistent: null, divergentClaims: [] };
            }

            // Extract key facts from both responses
            const originalClaims = this._extractClaims(response).slice(0, 5);
            const secondClaims = this._extractClaims(secondResponse).slice(0, 5);

            // Simple overlap check
            const divergent = [];
            for (const oc of originalClaims) {
                const words = oc.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                const hasOverlap = secondClaims.some(sc => {
                    const scWords = sc.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                    const overlap = words.filter(w => scWords.includes(w)).length;
                    return overlap >= Math.min(2, words.length * 0.3);
                });
                if (!hasOverlap && words.length > 3) {
                    divergent.push(oc.text);
                }
            }

            return {
                consistent: divergent.length <= 1,
                divergentClaims: divergent,
            };
        } catch (e) {
            console.warn('[GroundingVerifier] Self-consistency check failed:', e.message);
            return { consistent: null, divergentClaims: [] };
        }
    }

    /**
     * Compute weighted confidence score
     * RAG 0.6 + self-consistency 0.3 + specificity 0.1
     */
    _computeConfidence(ragResults, selfConsistency) {
        if (!ragResults || ragResults.length === 0) return 0.5;

        // RAG component (0.6 weight)
        const supported = ragResults.filter(r => r.status === 'SUPPORTED').length;
        const total = ragResults.length;
        const ragScore = total > 0 ? supported / total : 0;

        // Self-consistency component (0.3 weight)
        let scScore = 0.5; // neutral if not checked
        if (selfConsistency) {
            if (selfConsistency.consistent === true) scScore = 1.0;
            else if (selfConsistency.consistent === false) scScore = 0.0;
        }

        // Specificity component (0.1 weight) — more specific claims = higher base
        const avgClaimLength = ragResults.reduce((s, r) => s + (r.claim?.text?.length || 0), 0) / (total || 1);
        const specificityScore = Math.min(avgClaimLength / 100, 1.0);

        return Math.round((ragScore * 0.6 + scScore * 0.3 + specificityScore * 0.1) * 100) / 100;
    }

    /**
     * Format response with attribution markers
     * Supported claims get [n] footnotes, unverified get [?]
     */
    _formatWithAttribution(response, ragResults) {
        if (!ragResults || ragResults.length === 0) return response;

        let formatted = response;
        let footnotes = [];
        let footnoteIdx = 1;

        for (const result of ragResults) {
            if (result.status === 'SUPPORTED' && result.sources.length > 0) {
                const marker = `[${footnoteIdx}]`;
                const source = result.sources[0];
                // Insert marker after the claim sentence
                const claimText = result.claim.text;
                const pos = formatted.indexOf(claimText);
                if (pos !== -1) {
                    formatted = formatted.substring(0, pos + claimText.length) +
                        marker +
                        formatted.substring(pos + claimText.length);
                    footnotes.push(`${marker} ${source.name || source.id}`);
                    footnoteIdx++;
                }
            } else if (result.status === 'UNVERIFIED') {
                const claimText = result.claim.text;
                const pos = formatted.indexOf(claimText);
                if (pos !== -1 && !formatted.substring(pos + claimText.length, pos + claimText.length + 5).includes('[')) {
                    formatted = formatted.substring(0, pos + claimText.length) +
                        '[?]' +
                        formatted.substring(pos + claimText.length);
                }
            }
        }

        if (footnotes.length > 0) {
            formatted += '\n\n---\n' + footnotes.join('\n');
        }

        return formatted;
    }

    /**
     * Fast path: key terms → RAG overlap → score (no LLM call)
     */
    quickConfidence(response, query) {
        if (!response || !this._magma) return 0.5;

        // Extract 3 key terms from response
        const terms = response
            .replace(/[^\w\u4e00-\u9fff\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 3)
            .slice(0, 5);

        if (terms.length === 0) return 0.5;

        // Check RAG overlap
        const queryStr = terms.slice(0, 3).join(' ');
        const result = this._magma.query(queryStr);

        if (result.nodes.length === 0) return 0.3;
        if (result.nodes.length >= 3) return 0.8;
        return 0.5 + result.nodes.length * 0.1;
    }

    /**
     * Badge formatting: HIGH (>=0.8) / MEDIUM (>=0.5) / LOW (<0.5)
     */
    formatBadge(confidence) {
        if (confidence === null || confidence === undefined) return '';
        if (confidence >= 0.8) return 'HIGH';
        if (confidence >= 0.5) return 'MEDIUM';
        return 'LOW';
    }
}

module.exports = GroundingVerifier;
