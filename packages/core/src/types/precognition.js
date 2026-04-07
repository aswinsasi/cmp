"use strict";
/**
 * CMP v1.3 — Mesh Precognition Type Definitions
 * Layer 9: Speculative pre-computation during idle periods.
 *
 * @module types/precognition
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeculativeRejectReason = exports.SpeculativeAbortReason = exports.SpeculativeMessageType = exports.SpeculativeChunkStatus = exports.PredictionPattern = void 0;
// ─── Prediction Types ───
var PredictionPattern;
(function (PredictionPattern) {
    /** Same task type repeats at regular intervals */
    PredictionPattern["TEMPORAL_RECURRENCE"] = "temporal_recurrence";
    /** Task B always follows Task A */
    PredictionPattern["SEQUENTIAL_CHAIN"] = "sequential_chain";
    /** Same module with similar input sizes */
    PredictionPattern["PAYLOAD_SIMILARITY"] = "payload_similarity";
    /** Time-of-day correlation */
    PredictionPattern["DIURNAL_CYCLE"] = "diurnal_cycle";
    /** Burst pattern — rapid sequence of same task */
    PredictionPattern["BURST_PATTERN"] = "burst_pattern";
})(PredictionPattern || (exports.PredictionPattern = PredictionPattern = {}));
// ─── Speculative Execution Types ───
var SpeculativeChunkStatus;
(function (SpeculativeChunkStatus) {
    SpeculativeChunkStatus["QUEUED"] = "queued";
    SpeculativeChunkStatus["EXECUTING"] = "executing";
    SpeculativeChunkStatus["COMPLETED"] = "completed";
    SpeculativeChunkStatus["ABORTED"] = "aborted";
    SpeculativeChunkStatus["EVICTED"] = "evicted";
})(SpeculativeChunkStatus || (exports.SpeculativeChunkStatus = SpeculativeChunkStatus = {}));
// ─── Speculative Wire Message Types ───
var SpeculativeMessageType;
(function (SpeculativeMessageType) {
    SpeculativeMessageType[SpeculativeMessageType["SPECULATIVE_OFFER"] = 128] = "SPECULATIVE_OFFER";
    SpeculativeMessageType[SpeculativeMessageType["SPECULATIVE_ACK"] = 129] = "SPECULATIVE_ACK";
    SpeculativeMessageType[SpeculativeMessageType["SPECULATIVE_RESULT"] = 130] = "SPECULATIVE_RESULT";
    SpeculativeMessageType[SpeculativeMessageType["SPECULATIVE_ABORT"] = 131] = "SPECULATIVE_ABORT";
    SpeculativeMessageType[SpeculativeMessageType["PHANTOM_HIT"] = 132] = "PHANTOM_HIT";
})(SpeculativeMessageType || (exports.SpeculativeMessageType = SpeculativeMessageType = {}));
var SpeculativeAbortReason;
(function (SpeculativeAbortReason) {
    SpeculativeAbortReason[SpeculativeAbortReason["REAL_TASK_ARRIVED"] = 0] = "REAL_TASK_ARRIVED";
    SpeculativeAbortReason[SpeculativeAbortReason["PREDICTION_EXPIRED"] = 1] = "PREDICTION_EXPIRED";
    SpeculativeAbortReason[SpeculativeAbortReason["RESOURCE_NEEDED"] = 2] = "RESOURCE_NEEDED";
    SpeculativeAbortReason[SpeculativeAbortReason["MANUAL"] = 3] = "MANUAL";
})(SpeculativeAbortReason || (exports.SpeculativeAbortReason = SpeculativeAbortReason = {}));
var SpeculativeRejectReason;
(function (SpeculativeRejectReason) {
    SpeculativeRejectReason[SpeculativeRejectReason["BUSY"] = 0] = "BUSY";
    SpeculativeRejectReason[SpeculativeRejectReason["LOW_BATTERY"] = 1] = "LOW_BATTERY";
    SpeculativeRejectReason[SpeculativeRejectReason["NO_RUNTIME"] = 2] = "NO_RUNTIME";
})(SpeculativeRejectReason || (exports.SpeculativeRejectReason = SpeculativeRejectReason = {}));
//# sourceMappingURL=precognition.js.map