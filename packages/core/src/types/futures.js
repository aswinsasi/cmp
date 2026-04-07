"use strict";
/**
 * CMP v1.3 — Temporal Compute Futures Type Definitions
 * Devices pre-commit future idle compute capacity as tradeable
 * "Compute Futures" — cryptographically signed promises to provide
 * compute during specific time windows.
 *
 * @module types/futures
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FutureMessageType = exports.FutureStatus = exports.CapabilityTier = void 0;
// ─── Capability Tier (simplified from CapMap) ───
var CapabilityTier;
(function (CapabilityTier) {
    CapabilityTier[CapabilityTier["T1"] = 1] = "T1";
    CapabilityTier[CapabilityTier["T2"] = 2] = "T2";
    CapabilityTier[CapabilityTier["T3"] = 3] = "T3";
    CapabilityTier[CapabilityTier["T4"] = 4] = "T4";
    CapabilityTier[CapabilityTier["T5"] = 5] = "T5";
})(CapabilityTier || (exports.CapabilityTier = CapabilityTier = {}));
var FutureStatus;
(function (FutureStatus) {
    /** Listed on market, not yet purchased */
    FutureStatus["LISTED"] = "listed";
    /** Purchased but delivery window hasn't started */
    FutureStatus["RESERVED"] = "reserved";
    /** Currently in delivery window */
    FutureStatus["ACTIVE"] = "active";
    /** Successfully delivered */
    FutureStatus["SETTLED"] = "settled";
    /** Seller failed to deliver */
    FutureStatus["DEFAULTED"] = "defaulted";
    /** Cancelled before purchase */
    FutureStatus["CANCELLED"] = "cancelled";
    /** Expired without being purchased */
    FutureStatus["EXPIRED"] = "expired";
})(FutureStatus || (exports.FutureStatus = FutureStatus = {}));
// ─── Wire Protocol ───
var FutureMessageType;
(function (FutureMessageType) {
    FutureMessageType[FutureMessageType["FUTURE_LIST"] = 160] = "FUTURE_LIST";
    FutureMessageType[FutureMessageType["FUTURE_BUY"] = 161] = "FUTURE_BUY";
    FutureMessageType[FutureMessageType["FUTURE_CONFIRM"] = 162] = "FUTURE_CONFIRM";
    FutureMessageType[FutureMessageType["FUTURE_CANCEL"] = 163] = "FUTURE_CANCEL";
    FutureMessageType[FutureMessageType["FUTURE_SETTLE"] = 164] = "FUTURE_SETTLE";
    FutureMessageType[FutureMessageType["FUTURE_QUERY"] = 165] = "FUTURE_QUERY";
})(FutureMessageType || (exports.FutureMessageType = FutureMessageType = {}));
//# sourceMappingURL=futures.js.map