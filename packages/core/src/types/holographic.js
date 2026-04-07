"use strict";
/**
 * CMP v3.0 — Holographic State Type Definitions
 * Erasure-coded distributed shared memory across mesh devices.
 *
 * "Holographic" because any k-of-n shards can reconstruct the full data —
 * like a hologram where any fragment contains the whole image.
 *
 * Each shard is backed by a Lifeform (gets migration, replication, DNS for free).
 *
 * Wire protocol message types: 0xF0-0xF5
 *
 * @module types/holographic
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MESH_MEMORY_CONFIG = exports.HolographicMessageType = void 0;
// ─── Wire Protocol Messages (Layer 15) ───
var HolographicMessageType;
(function (HolographicMessageType) {
    /** Write shards to mesh memory */
    HolographicMessageType[HolographicMessageType["SHARD_WRITE"] = 240] = "SHARD_WRITE";
    /** Read shard from a holder */
    HolographicMessageType[HolographicMessageType["SHARD_READ"] = 241] = "SHARD_READ";
    /** Shard data response */
    HolographicMessageType[HolographicMessageType["SHARD_READ_RESPONSE"] = 242] = "SHARD_READ_RESPONSE";
    /** Request reconstruction from k peers */
    HolographicMessageType[HolographicMessageType["SHARD_RECONSTRUCT"] = 243] = "SHARD_RECONSTRUCT";
    /** Rebalance shards across devices */
    HolographicMessageType[HolographicMessageType["SHARD_REBALANCE"] = 244] = "SHARD_REBALANCE";
    /** Mesh memory status query/response */
    HolographicMessageType[HolographicMessageType["MEMORY_STATUS"] = 245] = "MEMORY_STATUS";
})(HolographicMessageType || (exports.HolographicMessageType = HolographicMessageType = {}));
exports.DEFAULT_MESH_MEMORY_CONFIG = {
    defaultRedundancy: 1.5,
    maxShardSizeBytes: 1048576, // 1MB
    maxContributionBytes: 268435456, // 256MB
    evictionPolicy: 'lru',
    defaultTtlMs: 0,
};
//# sourceMappingURL=holographic.js.map