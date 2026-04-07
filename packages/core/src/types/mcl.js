"use strict";
/**
 * CMP Mesh Cognition Layer Types
 * Layer 8: Distributed learning, experience propagation, cross-mesh pollination.
 *
 * MERs (Mesh Experience Records) capture what worked and what failed during
 * past computations. They propagate between meshes through device mobility,
 * enabling meshes to learn from each other without any central infrastructure.
 *
 * @module types/mcl
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MCL_CONFIG = exports.BottleneckFlag = exports.TierRole = exports.DecompositionStrategy = exports.MER_POLLINATION_BONUS = exports.MER_MIN_REPUTATION_HINT = exports.MER_MIN_REPUTATION_STORE = exports.MER_MIN_HINT_CONFIDENCE = exports.MER_MAX_PER_JOIN = exports.MER_MAX_PER_ORIGIN = exports.MER_MAX_PER_DEVICE = exports.MER_MAX_GENERATION = exports.MER_DEFAULT_TTL_DAYS = exports.TIER_COUNT = exports.ORIGIN_MESH_HASH_SIZE = exports.ENVIRONMENT_HASH_SIZE = exports.MESH_SIGNATURE_SIZE = exports.MER_ID_SIZE = exports.MER_MAX_SIZE = void 0;
// ── MER Size Constraints ──
/** Maximum MER binary size in bytes */
exports.MER_MAX_SIZE = 256;
/** MER ID size in bytes */
exports.MER_ID_SIZE = 16;
/** Mesh signature (LSH) size in bytes */
exports.MESH_SIGNATURE_SIZE = 8;
/** Environment hash size in bytes */
exports.ENVIRONMENT_HASH_SIZE = 8;
/** Origin mesh hash size in bytes */
exports.ORIGIN_MESH_HASH_SIZE = 8;
/** Number of capability tiers (T1-T5) */
exports.TIER_COUNT = 5;
// ── MER Defaults ──
/** Default MER time-to-live in days */
exports.MER_DEFAULT_TTL_DAYS = 90;
/** Maximum MER generation (caps evolutionary drift) */
exports.MER_MAX_GENERATION = 100;
/** Maximum MERs stored per device */
exports.MER_MAX_PER_DEVICE = 1000;
/** Maximum MERs from a single origin mesh */
exports.MER_MAX_PER_ORIGIN = 50;
/** Maximum MERs transferred per mesh join event */
exports.MER_MAX_PER_JOIN = 50;
/** Minimum confidence to use a strategy hint (0-100) */
exports.MER_MIN_HINT_CONFIDENCE = 70;
/** Minimum reputation to generate MERs stored in DHT */
exports.MER_MIN_REPUTATION_STORE = 2000;
/** Minimum reputation for MERs to be used in hint generation */
exports.MER_MIN_REPUTATION_HINT = 3000;
/** Reputation bonus for validated pollination */
exports.MER_POLLINATION_BONUS = 50;
// ── Decomposition Strategy ──
var DecompositionStrategy;
(function (DecompositionStrategy) {
    DecompositionStrategy[DecompositionStrategy["DATA_PARALLEL"] = 0] = "DATA_PARALLEL";
    DecompositionStrategy[DecompositionStrategy["MODEL_PARALLEL"] = 1] = "MODEL_PARALLEL";
    DecompositionStrategy[DecompositionStrategy["PIPELINE"] = 2] = "PIPELINE";
    DecompositionStrategy[DecompositionStrategy["MAP_REDUCE"] = 3] = "MAP_REDUCE";
    DecompositionStrategy[DecompositionStrategy["SCATTER_GATHER"] = 4] = "SCATTER_GATHER";
})(DecompositionStrategy || (exports.DecompositionStrategy = DecompositionStrategy = {}));
// ── Tier Role ──
/** How a capability tier should be used for a given task type */
var TierRole;
(function (TierRole) {
    /** Exclude this tier from task assignment */
    TierRole[TierRole["EXCLUDE"] = 0] = "EXCLUDE";
    /** Include as standard compute participant */
    TierRole[TierRole["COMPUTE"] = 1] = "COMPUTE";
    /** Prefer this tier for best results */
    TierRole[TierRole["PREFER"] = 2] = "PREFER";
})(TierRole || (exports.TierRole = TierRole = {}));
// ── Bottleneck Flags ──
var BottleneckFlag;
(function (BottleneckFlag) {
    BottleneckFlag[BottleneckFlag["NETWORK"] = 1] = "NETWORK";
    BottleneckFlag[BottleneckFlag["CPU"] = 2] = "CPU";
    BottleneckFlag[BottleneckFlag["MEMORY"] = 4] = "MEMORY";
})(BottleneckFlag || (exports.BottleneckFlag = BottleneckFlag = {}));
exports.DEFAULT_MCL_CONFIG = {
    enabled: true,
    maxMers: exports.MER_MAX_PER_DEVICE,
    maxPerOrigin: exports.MER_MAX_PER_ORIGIN,
    maxPerJoin: exports.MER_MAX_PER_JOIN,
    minHintConfidence: exports.MER_MIN_HINT_CONFIDENCE,
    merTtlDays: exports.MER_DEFAULT_TTL_DAYS,
    forwardingRange: [0.6, 0.8],
};
//# sourceMappingURL=mcl.js.map