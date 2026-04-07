"use strict";
/**
 * CMP v1.3 — Mesh Morphogenesis Type Definitions
 * As meshes grow beyond ~15 devices, they self-organize into specialized
 * sub-meshes called "organs" based on workload affinity. Devices that
 * frequently execute the same task types cluster together using
 * chemical-gradient-inspired "morphogen signals."
 *
 * @module types/morphogenesis
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MorphogenMessageType = exports.OrganEvent = void 0;
// ─── Organ Events ───
var OrganEvent;
(function (OrganEvent) {
    OrganEvent["FORMING"] = "forming";
    OrganEvent["DEVICE_JOINED"] = "device_joined";
    OrganEvent["DEVICE_LEFT"] = "device_left";
    OrganEvent["MERGING"] = "merging";
    OrganEvent["DISSOLVING"] = "dissolving";
    OrganEvent["ACTIVE"] = "active";
})(OrganEvent || (exports.OrganEvent = OrganEvent = {}));
// ─── Wire Protocol ───
var MorphogenMessageType;
(function (MorphogenMessageType) {
    MorphogenMessageType[MorphogenMessageType["MORPHOGEN_SIGNAL"] = 176] = "MORPHOGEN_SIGNAL";
    MorphogenMessageType[MorphogenMessageType["ORGAN_ANNOUNCE"] = 177] = "ORGAN_ANNOUNCE";
    MorphogenMessageType[MorphogenMessageType["ORGAN_JOIN"] = 178] = "ORGAN_JOIN";
    MorphogenMessageType[MorphogenMessageType["ORGAN_ACK"] = 179] = "ORGAN_ACK";
    MorphogenMessageType[MorphogenMessageType["ORGAN_ROUTE"] = 180] = "ORGAN_ROUTE";
})(MorphogenMessageType || (exports.MorphogenMessageType = MorphogenMessageType = {}));
//# sourceMappingURL=morphogenesis.js.map