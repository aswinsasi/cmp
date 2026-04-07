"use strict";
/**
 * CMP v2.0 — Layer 13: Cross-Mesh Wormholes Types
 *
 * Bridge separate meshes. Teleport Lifeforms across reality boundaries.
 *
 * When a device has both mesh connectivity AND internet, it becomes
 * a wormhole node bridging two separate physical meshes. Lifeforms
 * can be teleported between meshes with full state, causal history,
 * and economic balance preserved.
 *
 * Wire Protocol: 0xEC-0xF1
 *
 * @module types/wormhole
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_WORMHOLE_CONFIG = exports.TeleportState = exports.TeleportReason = exports.WormholeMessageType = void 0;
// ═══════════════════════════════════════
// Wire Protocol Messages (0xEC-0xF1)
// ═══════════════════════════════════════
var WormholeMessageType;
(function (WormholeMessageType) {
    /** This node can bridge to a remote mesh */
    WormholeMessageType[WormholeMessageType["WORMHOLE_ANNOUNCE"] = 236] = "WORMHOLE_ANNOUNCE";
    /** Directory of known remote meshes */
    WormholeMessageType[WormholeMessageType["WORMHOLE_DIRECTORY"] = 237] = "WORMHOLE_DIRECTORY";
    /** Initiate lifeform teleportation */
    WormholeMessageType[WormholeMessageType["TELEPORT_INITIATE"] = 238] = "TELEPORT_INITIATE";
    /** Teleportation payload (soul + state + history) */
    WormholeMessageType[WormholeMessageType["TELEPORT_PAYLOAD"] = 239] = "TELEPORT_PAYLOAD";
    /** Teleportation acknowledged by destination */
    WormholeMessageType[WormholeMessageType["TELEPORT_ACK"] = 240] = "TELEPORT_ACK";
    /** Cross-mesh synapse relay */
    WormholeMessageType[WormholeMessageType["CROSS_SYNAPSE_RELAY"] = 241] = "CROSS_SYNAPSE_RELAY";
})(WormholeMessageType || (exports.WormholeMessageType = WormholeMessageType = {}));
var TeleportReason;
(function (TeleportReason) {
    /** User-initiated move */
    TeleportReason["MANUAL"] = "manual";
    /** Better resources on remote mesh */
    TeleportReason["RESOURCE_SEEKING"] = "resource_seeking";
    /** Following a cross-mesh synapse partner */
    TeleportReason["SYNAPSE_FOLLOW"] = "synapse_follow";
    /** Load balancing across meshes */
    TeleportReason["LOAD_BALANCE"] = "load_balance";
    /** Escaping a degraded local mesh */
    TeleportReason["ESCAPE"] = "escape";
})(TeleportReason || (exports.TeleportReason = TeleportReason = {}));
var TeleportState;
(function (TeleportState) {
    /** Teleport initiated, preparing payload */
    TeleportState["PREPARING"] = "preparing";
    /** Payload being transmitted through wormhole */
    TeleportState["IN_TRANSIT"] = "in_transit";
    /** Destination mesh received and is reconstituting */
    TeleportState["RECONSTITUTING"] = "reconstituting";
    /** Teleport complete, Lifeform alive on destination */
    TeleportState["COMPLETE"] = "complete";
    /** Teleport failed */
    TeleportState["FAILED"] = "failed";
})(TeleportState || (exports.TeleportState = TeleportState = {}));
exports.DEFAULT_WORMHOLE_CONFIG = {
    announceIntervalMs: 15000,
    wormholeTimeoutMs: 45000,
    maxRemoteMeshes: 20,
    maxActiveTeleports: 3,
    teleportTimeoutMs: 30000,
    maxCrossSynapses: 10,
    bloomFilterSize: 256,
    minWormholeQuality: 0.3,
};
//# sourceMappingURL=wormhole.js.map