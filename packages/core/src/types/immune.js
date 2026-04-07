"use strict";
/**
 * CMP v1.3 — Mesh Immune System Type Definitions
 * Adaptive defense system: threat detection, antibody generation,
 * quarantine management, and cross-mesh immune sharing.
 *
 * @module types/immune
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImmuneMessageType = exports.QuarantineLevel = exports.SignatureMetric = exports.DetectionMethod = exports.ThreatSeverity = exports.ThreatType = void 0;
// ─── Threat Types ───
var ThreatType;
(function (ThreatType) {
    ThreatType["RESULT_POISONING"] = "result_poisoning";
    ThreatType["CAPABILITY_FRAUD"] = "capability_fraud";
    ThreatType["TASK_SINKHOLE"] = "task_sinkhole";
    ThreatType["BEACON_FLOODING"] = "beacon_flooding";
    ThreatType["SYBIL_ATTACK"] = "sybil_attack";
    ThreatType["DATA_EXFILTRATION"] = "data_exfiltration";
    ThreatType["PROTOCOL_ABUSE"] = "protocol_abuse";
    ThreatType["TIMING_ATTACK"] = "timing_attack";
    ThreatType["REPUTATION_GAMING"] = "reputation_gaming";
    ThreatType["ANOMALOUS"] = "anomalous";
})(ThreatType || (exports.ThreatType = ThreatType = {}));
var ThreatSeverity;
(function (ThreatSeverity) {
    ThreatSeverity["LOW"] = "low";
    ThreatSeverity["MEDIUM"] = "medium";
    ThreatSeverity["HIGH"] = "high";
    ThreatSeverity["CRITICAL"] = "critical";
})(ThreatSeverity || (exports.ThreatSeverity = ThreatSeverity = {}));
var DetectionMethod;
(function (DetectionMethod) {
    DetectionMethod["REDUNDANT_MISMATCH"] = "redundant_mismatch";
    DetectionMethod["STATISTICAL_ANOMALY"] = "statistical_anomaly";
    DetectionMethod["ANTIBODY_MATCH"] = "antibody_match";
    DetectionMethod["RATE_VIOLATION"] = "rate_violation";
    DetectionMethod["CAPABILITY_MISMATCH"] = "capability_mismatch";
})(DetectionMethod || (exports.DetectionMethod = DetectionMethod = {}));
var SignatureMetric;
(function (SignatureMetric) {
    SignatureMetric["RESULT_ERROR_RATE"] = "result_error_rate";
    SignatureMetric["TIMEOUT_RATE"] = "timeout_rate";
    SignatureMetric["CAPABILITY_HONESTY"] = "capability_honesty";
    SignatureMetric["BEACON_RATE"] = "beacon_rate";
    SignatureMetric["IDENTITY_MULTIPLICITY"] = "identity_multiplicity";
    SignatureMetric["BID_TIMING_VARIANCE"] = "bid_timing_variance";
    SignatureMetric["CHERRY_PICK_RATIO"] = "cherry_pick_ratio";
    SignatureMetric["REPUTATION_VELOCITY"] = "reputation_velocity";
})(SignatureMetric || (exports.SignatureMetric = SignatureMetric = {}));
// ─── Quarantine Types ───
var QuarantineLevel;
(function (QuarantineLevel) {
    QuarantineLevel["WATCH"] = "watch";
    QuarantineLevel["RESTRICTED"] = "restricted";
    QuarantineLevel["EXPELLED"] = "expelled";
})(QuarantineLevel || (exports.QuarantineLevel = QuarantineLevel = {}));
// ─── Wire Protocol ───
var ImmuneMessageType;
(function (ImmuneMessageType) {
    ImmuneMessageType[ImmuneMessageType["ANTIBODY_OFFER"] = 144] = "ANTIBODY_OFFER";
    ImmuneMessageType[ImmuneMessageType["ANTIBODY_REQUEST"] = 145] = "ANTIBODY_REQUEST";
    ImmuneMessageType[ImmuneMessageType["ANTIBODY_TRANSFER"] = 146] = "ANTIBODY_TRANSFER";
    ImmuneMessageType[ImmuneMessageType["QUARANTINE_NOTIFY"] = 147] = "QUARANTINE_NOTIFY";
})(ImmuneMessageType || (exports.ImmuneMessageType = ImmuneMessageType = {}));
//# sourceMappingURL=immune.js.map