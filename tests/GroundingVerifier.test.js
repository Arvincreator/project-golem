const GroundingVerifier = require('../src/core/GroundingVerifier');

describe('GroundingVerifier', () => {
    let verifier;

    beforeEach(() => {
        verifier = new GroundingVerifier({ mode: 'full' });
    });

    // --- Claim Extraction ---

    test('_extractClaims extracts factual sentences', () => {
        const response = 'Tokyo is the capital of Japan. The population is 14 million. Hi there!';
        const claims = verifier._extractClaims(response);
        expect(claims.length).toBeGreaterThanOrEqual(2);
        expect(claims.some(c => c.text.includes('Tokyo'))).toBe(true);
    });

    test('_extractClaims filters out non-factual sentences', () => {
        const response = 'Hello! Sure thing. Maybe later.';
        const claims = verifier._extractClaims(response);
        expect(claims.length).toBe(0);
    });

    test('_extractClaims handles empty input', () => {
        expect(verifier._extractClaims('')).toEqual([]);
        expect(verifier._extractClaims(null)).toEqual([]);
    });

    test('_extractClaims handles CJK sentences', () => {
        const response = '東京是日本的首都。人口約1400萬。';
        const claims = verifier._extractClaims(response);
        expect(claims.length).toBeGreaterThanOrEqual(1);
    });

    // --- RAG Verification ---

    test('_checkAgainstRAG returns UNVERIFIED when no MAGMA', () => {
        const v = new GroundingVerifier({ mode: 'full' });
        v._magma = null;
        const claims = [{ text: 'some claim', index: 0 }];
        const results = v._checkAgainstRAG(claims);
        expect(results[0].status).toBe('UNVERIFIED');
    });

    test('_checkAgainstRAG returns SUPPORTED for matching nodes', () => {
        const mockMagma = {
            query: () => ({
                nodes: [{ id: 'test', name: 'Tokyo capital', _relevanceScore: 0.8 }],
                edges: [],
            }),
        };
        verifier._magma = mockMagma;
        const claims = [{ text: 'Tokyo is the capital', index: 0 }];
        const results = verifier._checkAgainstRAG(claims);
        expect(results[0].status).toBe('SUPPORTED');
        expect(results[0].confidence).toBeGreaterThan(0.5);
    });

    test('_checkAgainstRAG returns UNVERIFIED for low relevance', () => {
        const mockMagma = {
            query: () => ({
                nodes: [{ id: 'test', _relevanceScore: 0.1 }],
                edges: [],
            }),
        };
        verifier._magma = mockMagma;
        const claims = [{ text: 'Some obscure fact', index: 0 }];
        const results = verifier._checkAgainstRAG(claims);
        expect(results[0].status).toBe('UNVERIFIED');
    });

    // --- Confidence Computation ---

    test('_computeConfidence returns 0.5 for empty results', () => {
        expect(verifier._computeConfidence([], null)).toBe(0.5);
    });

    test('_computeConfidence weights RAG supported results', () => {
        const results = [
            { claim: { text: 'claim1' }, status: 'SUPPORTED', sources: [{ id: 'a' }], confidence: 0.9 },
            { claim: { text: 'claim2' }, status: 'SUPPORTED', sources: [{ id: 'b' }], confidence: 0.8 },
        ];
        const confidence = verifier._computeConfidence(results, null);
        expect(confidence).toBeGreaterThan(0.5);
    });

    test('_computeConfidence accounts for self-consistency', () => {
        const results = [
            { claim: { text: 'long claim text here' }, status: 'UNVERIFIED', sources: [], confidence: 0 },
        ];
        const withConsistent = verifier._computeConfidence(results, { consistent: true });
        const withInconsistent = verifier._computeConfidence(results, { consistent: false });
        expect(withConsistent).toBeGreaterThan(withInconsistent);
    });

    // --- Badge Formatting ---

    test('formatBadge returns correct badges', () => {
        expect(verifier.formatBadge(0.9)).toBe('HIGH');
        expect(verifier.formatBadge(0.8)).toBe('HIGH');
        expect(verifier.formatBadge(0.6)).toBe('MEDIUM');
        expect(verifier.formatBadge(0.5)).toBe('MEDIUM');
        expect(verifier.formatBadge(0.3)).toBe('LOW');
        expect(verifier.formatBadge(0.0)).toBe('LOW');
        expect(verifier.formatBadge(null)).toBe('');
    });

    // --- Quick Confidence ---

    test('quickConfidence returns 0.5 when no MAGMA', () => {
        const v = new GroundingVerifier({ mode: 'quick' });
        v._magma = null;
        expect(v.quickConfidence('some response', 'query')).toBe(0.5);
    });

    test('quickConfidence returns higher score for more matching nodes', () => {
        const mockMagma = {
            query: () => ({
                nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
                edges: [],
            }),
        };
        verifier._magma = mockMagma;
        expect(verifier.quickConfidence('Tokyo Japan capital city', 'test')).toBe(0.8);
    });

    // --- Full Pipeline ---

    test('verify returns pass-through in off mode', async () => {
        const v = new GroundingVerifier({ mode: 'off' });
        const result = await v.verify('test response', 'test query');
        expect(result.verifiedResponse).toBe('test response');
        expect(result.confidence).toBeNull();
        expect(result.sources).toEqual([]);
    });

    test('verify returns confidence badge in quick mode', async () => {
        const v = new GroundingVerifier({ mode: 'quick' });
        v._magma = null;
        const result = await v.verify('test response text here', 'test query');
        expect(result.confidence).toBeDefined();
        expect(typeof result.confidence).toBe('number');
    });

    test('verify full mode with mock MAGMA', async () => {
        const mockMagma = {
            query: () => ({
                nodes: [{ id: 'n1', name: 'Test Node', _relevanceScore: 0.7 }],
                edges: [],
            }),
        };
        verifier._magma = mockMagma;
        const result = await verifier.verify(
            'The Test Node is very important. It has been verified.',
            'test query'
        );
        expect(result.confidence).toBeDefined();
        expect(typeof result.confidence).toBe('number');
    });

    // --- Attribution Formatting ---

    test('_formatWithAttribution adds footnotes for supported claims', () => {
        const ragResults = [
            {
                claim: { text: 'Tokyo is the capital' },
                status: 'SUPPORTED',
                sources: [{ id: 'n1', name: 'Geography DB' }],
                confidence: 0.9,
            },
        ];
        const formatted = verifier._formatWithAttribution('Tokyo is the capital of Japan.', ragResults);
        expect(formatted).toContain('[1]');
        expect(formatted).toContain('Geography DB');
    });

    test('_formatWithAttribution adds [?] for unverified claims', () => {
        const ragResults = [
            {
                claim: { text: 'Some unverified fact' },
                status: 'UNVERIFIED',
                sources: [],
                confidence: 0,
            },
        ];
        const formatted = verifier._formatWithAttribution('Some unverified fact here.', ragResults);
        expect(formatted).toContain('[?]');
    });
});
