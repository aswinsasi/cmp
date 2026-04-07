"use strict";
/**
 * CMP Beacon Types
 * Layer 1: Discovery beacon frame format.
 * Designed to fit within a single BLE 5.0 advertisement packet (38 bytes).
 *
 * @module types/beacon
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageType = exports.DEFAULT_TTL = exports.PROTOCOL_VERSION = exports.PEER_DEAD_MS = exports.PEER_STALE_MS = exports.BEACON_INTERVAL_MS = exports.BEACON_SIZE = exports.BEACON_MAGIC = void 0;
/** CMP magic bytes: ASCII "CMP" = 0x434D50 */
exports.BEACON_MAGIC = 0x434D50;
/** Total serialized beacon size in bytes */
exports.BEACON_SIZE = 38;
/** Default beacon broadcast interval (ms) */
exports.BEACON_INTERVAL_MS = 5000;
/** Mark peer as stale after this many ms without beacon */
exports.PEER_STALE_MS = 30000;
/** Remove peer from table after this many ms without beacon */
exports.PEER_DEAD_MS = 60000;
/** Current protocol version */
exports.PROTOCOL_VERSION = 1;
/** Default hop count for relay */
exports.DEFAULT_TTL = 3;
/**
 * CMP Message Types
 * Used as the first byte after magic for non-beacon messages.
 */
var MessageType;
(function (MessageType) {
    MessageType[MessageType["BEACON"] = 1] = "BEACON";
    MessageType[MessageType["HANDSHAKE_INIT"] = 2] = "HANDSHAKE_INIT";
    MessageType[MessageType["HANDSHAKE_RESPONSE"] = 3] = "HANDSHAKE_RESPONSE";
    MessageType[MessageType["CAPABILITY_EXCHANGE"] = 4] = "CAPABILITY_EXCHANGE";
    MessageType[MessageType["TASK_REQUEST"] = 16] = "TASK_REQUEST";
    MessageType[MessageType["BID"] = 17] = "BID";
    MessageType[MessageType["ASSIGNMENT"] = 18] = "ASSIGNMENT";
    MessageType[MessageType["ASSIGNMENT_ACK"] = 19] = "ASSIGNMENT_ACK";
    MessageType[MessageType["CHUNK_DATA"] = 32] = "CHUNK_DATA";
    MessageType[MessageType["CHUNK_RESULT"] = 33] = "CHUNK_RESULT";
    MessageType[MessageType["HEARTBEAT"] = 48] = "HEARTBEAT";
    MessageType[MessageType["DEPARTURE_NOTICE"] = 49] = "DEPARTURE_NOTICE";
    MessageType[MessageType["CHECKPOINT_STORE"] = 64] = "CHECKPOINT_STORE";
    MessageType[MessageType["CHECKPOINT_REQUEST"] = 65] = "CHECKPOINT_REQUEST";
    MessageType[MessageType["CHECKPOINT_RESPONSE"] = 66] = "CHECKPOINT_RESPONSE";
    MessageType[MessageType["CODE_REQUEST"] = 80] = "CODE_REQUEST";
    MessageType[MessageType["CODE_RESPONSE"] = 81] = "CODE_RESPONSE";
    MessageType[MessageType["CREDIT_RECEIPT"] = 96] = "CREDIT_RECEIPT";
    // Layer 8: Mesh Cognition (v1.2)
    MessageType[MessageType["MER_OFFER"] = 112] = "MER_OFFER";
    MessageType[MessageType["MER_REQUEST"] = 113] = "MER_REQUEST";
    MessageType[MessageType["MER_TRANSFER"] = 114] = "MER_TRANSFER";
    MessageType[MessageType["MER_STORE"] = 115] = "MER_STORE";
    MessageType[MessageType["MER_QUERY"] = 116] = "MER_QUERY";
    // Layer 9: Precognition (v1.3)
    MessageType[MessageType["SPECULATIVE_OFFER"] = 128] = "SPECULATIVE_OFFER";
    MessageType[MessageType["SPECULATIVE_ACK"] = 129] = "SPECULATIVE_ACK";
    MessageType[MessageType["SPECULATIVE_RESULT"] = 130] = "SPECULATIVE_RESULT";
    MessageType[MessageType["SPECULATIVE_ABORT"] = 131] = "SPECULATIVE_ABORT";
    MessageType[MessageType["PHANTOM_HIT"] = 132] = "PHANTOM_HIT";
    // Immune System (v1.3)
    MessageType[MessageType["ANTIBODY_OFFER"] = 144] = "ANTIBODY_OFFER";
    MessageType[MessageType["ANTIBODY_REQUEST"] = 145] = "ANTIBODY_REQUEST";
    MessageType[MessageType["ANTIBODY_TRANSFER"] = 146] = "ANTIBODY_TRANSFER";
    MessageType[MessageType["QUARANTINE_NOTIFY"] = 147] = "QUARANTINE_NOTIFY";
    // Temporal Compute Futures (v1.3)
    MessageType[MessageType["FUTURE_LIST"] = 160] = "FUTURE_LIST";
    MessageType[MessageType["FUTURE_BUY"] = 161] = "FUTURE_BUY";
    MessageType[MessageType["FUTURE_CONFIRM"] = 162] = "FUTURE_CONFIRM";
    MessageType[MessageType["FUTURE_CANCEL"] = 163] = "FUTURE_CANCEL";
    MessageType[MessageType["FUTURE_SETTLE"] = 164] = "FUTURE_SETTLE";
    MessageType[MessageType["FUTURE_QUERY"] = 165] = "FUTURE_QUERY";
    // Morphogenesis (v1.3)
    MessageType[MessageType["MORPHOGEN_SIGNAL"] = 176] = "MORPHOGEN_SIGNAL";
    MessageType[MessageType["ORGAN_ANNOUNCE"] = 177] = "ORGAN_ANNOUNCE";
    MessageType[MessageType["ORGAN_JOIN"] = 178] = "ORGAN_JOIN";
    MessageType[MessageType["ORGAN_ACK"] = 179] = "ORGAN_ACK";
    MessageType[MessageType["ORGAN_ROUTE"] = 180] = "ORGAN_ROUTE";
    // V4 Supercomputer (v4.0) — range 0xF2-0xFD
    MessageType[MessageType["V4_LOAD_REPORT"] = 242] = "V4_LOAD_REPORT";
    MessageType[MessageType["V4_JOB_ANNOUNCE"] = 243] = "V4_JOB_ANNOUNCE";
    MessageType[MessageType["V4_JOB_RESULT"] = 244] = "V4_JOB_RESULT";
    MessageType[MessageType["V4_PIPE_DATA"] = 245] = "V4_PIPE_DATA";
    MessageType[MessageType["V4_PIPE_BACKPRESSURE"] = 246] = "V4_PIPE_BACKPRESSURE";
    MessageType[MessageType["V4_CATALOG_GOSSIP"] = 247] = "V4_CATALOG_GOSSIP";
    MessageType[MessageType["V4_CODE_SHIP"] = 248] = "V4_CODE_SHIP";
    MessageType[MessageType["V4_CODE_RESULT"] = 249] = "V4_CODE_RESULT";
    MessageType[MessageType["V4_TASK_CANCEL"] = 250] = "V4_TASK_CANCEL";
    MessageType[MessageType["V4_TASK_CANCEL_ACK"] = 251] = "V4_TASK_CANCEL_ACK";
})(MessageType || (exports.MessageType = MessageType = {}));
//# sourceMappingURL=beacon.js.map