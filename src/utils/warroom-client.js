// ============================================================
// War Room Client — Bidirectional sync (replaces 4 duplicate implementations)
// ============================================================
const { getWarRoomToken } = require('./yedan-auth');
const endpoints = require('../config/endpoints');

const WARROOM_URL = endpoints.WARROOM_URL;
let _circuitOpen = false;
let _circuitResetTime = 0;
const CIRCUIT_COOLDOWN = 60000; // 1 min

function _checkCircuit() {
    if (_circuitOpen && Date.now() > _circuitResetTime) {
        _circuitOpen = false;
    }
    return !_circuitOpen;
}

function _tripCircuit() {
    _circuitOpen = true;
    _circuitResetTime = Date.now() + CIRCUIT_COOLDOWN;
    console.warn('[WarRoom] Circuit breaker tripped — pausing for 60s');
}

async function report(event, data, source = endpoints.AGENT_ID) {
    if (!WARROOM_URL) return null;
    if (!_checkCircuit()) return null;
    try {
        const res = await fetch(`${WARROOM_URL}/report`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getWarRoomToken()}`
            },
            body: JSON.stringify({ source, event, data, timestamp: new Date().toISOString() }),
            signal: AbortSignal.timeout(10000)
        });
        return res.ok ? await res.json().catch(() => null) : null;
    } catch (e) {
        _tripCircuit();
        return null;
    }
}

async function getStatus() {
    if (!WARROOM_URL) return null;
    if (!_checkCircuit()) return null;
    try {
        const res = await fetch(`${WARROOM_URL}/dashboard`, {
            headers: { 'Authorization': `Bearer ${getWarRoomToken()}` },
            signal: AbortSignal.timeout(8000)
        });
        return res.ok ? await res.json() : null;
    } catch (e) {
        _tripCircuit();
        return null;
    }
}

async function getAlerts() {
    if (!WARROOM_URL) return [];
    if (!_checkCircuit()) return [];
    try {
        const res = await fetch(`${WARROOM_URL}/agents`, {
            headers: { 'Authorization': `Bearer ${getWarRoomToken()}` },
            signal: AbortSignal.timeout(8000)
        });
        return res.ok ? await res.json() : [];
    } catch (e) {
        _tripCircuit();
        return [];
    }
}

module.exports = { report, getStatus, getAlerts };
