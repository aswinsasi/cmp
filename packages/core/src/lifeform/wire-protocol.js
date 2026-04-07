"use strict";
/**
 * CMP v1.4 — Lifeform Wire Protocol
 * Serialization/deserialization for all 33 Lifeform message types.
 * Uses JSON encoding over the existing CMP Frame format (16-byte header).
 *
 * Messages are encoded as CMP Frames with type in the 0xC0-0xE0 range.
 * Payload is JSON for v1.4 (binary optimization in v1.5).
 *
 * @module lifeform/wire-protocol
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeLifeformMessage = encodeLifeformMessage;
exports.decodeLifeformMessage = decodeLifeformMessage;
exports.isLifeformMessage = isLifeformMessage;
exports.lifeformMessageName = lifeformMessageName;
// ─── Encoder / Decoder ───
/**
 * Encode a Lifeform message payload to bytes.
 * Uses JSON encoding over the wire.
 */
function encodeLifeformMessage(type, payload) {
    const json = JSON.stringify({ msgType: type, ...payload });
    return new TextEncoder().encode(json);
}
/**
 * Decode a Lifeform message payload from bytes.
 * Returns { type, ...payload } or null if invalid.
 */
function decodeLifeformMessage(data) {
    try {
        const json = new TextDecoder().decode(data);
        const parsed = JSON.parse(json);
        if (typeof parsed.msgType !== 'number')
            return null;
        const { msgType, ...rest } = parsed;
        return { ...rest, type: msgType };
    }
    catch {
        return null;
    }
}
/**
 * Check if a message type code is in the Lifeform range (0xC0-0xE0).
 */
function isLifeformMessage(typeCode) {
    return typeCode >= 0xC0 && typeCode <= 0xE0;
}
/**
 * Get human-readable name for a Lifeform message type.
 */
function lifeformMessageName(type) {
    const names = {
        0xC0: 'SPAWN',
        0xC1: 'SPAWN_ACK',
        0xC2: 'CAUSE',
        0xC3: 'RESPONSE',
        0xC4: 'STATE_DELTA',
        0xC5: 'STATE_ACK',
        0xC6: 'MIGRATE_OFFER',
        0xC7: 'MIGRATE_ACK',
        0xC8: 'HOST_CHANGE',
        0xC9: 'REPLICATE_OFFER',
        0xCA: 'REPLICA_RELEASE',
        0xCB: 'DNS_UPDATE',
        0xCC: 'DNS_QUERY',
        0xCD: 'DNS_RESPONSE',
        0xCE: 'SYNAPSE_OFFER',
        0xCF: 'SYNAPSE_ACK',
        0xD0: 'KILL',
        0xD1: 'HEARTBEAT',
        0xD2: 'CCU_TOPUP',
        0xD3: 'QUERY',
        0xD4: 'FUSION_PROPOSE',
        0xD5: 'FUSION_ACCEPT',
        0xD6: 'FUSION_REJECT',
        0xD7: 'FUSION_EXECUTE',
        0xD8: 'FISSION_NOTIFY',
        0xD9: 'MUTATE',
        0xDA: 'GENERATION_RESULT',
        0xDB: 'INTENT_DECLARE',
        0xDC: 'INTENT_REVOKE',
        0xDD: 'INTENT_SAMPLE_REQ',
        0xDE: 'INTENT_SAMPLE_RES',
        0xDF: 'INTENT_VIOLATION',
        0xE0: 'STATE_READ',
    };
    return names[type] ?? `UNKNOWN(0x${type.toString(16)})`;
}
//# sourceMappingURL=wire-protocol.js.map