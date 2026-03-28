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

import { MeshId, Hash64, Signature, Hash256 } from './primitives';
import { TaskType } from './task';

// ── MER Size Constraints ──

/** Maximum MER binary size in bytes */
export const MER_MAX_SIZE = 256;

/** MER ID size in bytes */
export const MER_ID_SIZE = 16;

/** Mesh signature (LSH) size in bytes */
export const MESH_SIGNATURE_SIZE = 8;

/** Environment hash size in bytes */
export const ENVIRONMENT_HASH_SIZE = 8;

/** Origin mesh hash size in bytes */
export const ORIGIN_MESH_HASH_SIZE = 8;

/** Number of capability tiers (T1-T5) */
export const TIER_COUNT = 5;

// ── MER Defaults ──

/** Default MER time-to-live in days */
export const MER_DEFAULT_TTL_DAYS = 90;

/** Maximum MER generation (caps evolutionary drift) */
export const MER_MAX_GENERATION = 100;

/** Maximum MERs stored per device */
export const MER_MAX_PER_DEVICE = 1000;

/** Maximum MERs from a single origin mesh */
export const MER_MAX_PER_ORIGIN = 50;

/** Maximum MERs transferred per mesh join event */
export const MER_MAX_PER_JOIN = 50;

/** Minimum confidence to use a strategy hint (0-100) */
export const MER_MIN_HINT_CONFIDENCE = 70;

/** Minimum reputation to generate MERs stored in DHT */
export const MER_MIN_REPUTATION_STORE = 2000;

/** Minimum reputation for MERs to be used in hint generation */
export const MER_MIN_REPUTATION_HINT = 3000;

/** Reputation bonus for validated pollination */
export const MER_POLLINATION_BONUS = 50;

// ── Decomposition Strategy ──

export enum DecompositionStrategy {
  DATA_PARALLEL = 0,
  MODEL_PARALLEL = 1,
  PIPELINE = 2,
  MAP_REDUCE = 3,
  SCATTER_GATHER = 4,
}

// ── Tier Role ──

/** How a capability tier should be used for a given task type */
export enum TierRole {
  /** Exclude this tier from task assignment */
  EXCLUDE = 0,
  /** Include as standard compute participant */
  COMPUTE = 1,
  /** Prefer this tier for best results */
  PREFER = 2,
}

// ── Bottleneck Flags ──

export enum BottleneckFlag {
  NETWORK = 0x01,
  CPU = 0x02,
  MEMORY = 0x04,
}

// ── Mesh Experience Record (MER) ──

export interface MERPerformance {
  /** Total task execution time including distribution overhead */
  totalTimeMs: number;
  /** Distribution overhead as percentage of total time (0-100) */
  distributionOverheadPct: number;
  /** Actual vs theoretical speedup as percentage (0-100) */
  executionEfficiency: number;
  /** Number of fault events (executor failures) during task */
  faultEvents: number;
  /** Number of chunks that were reassigned due to failures */
  reassignmentCount: number;
}

export interface MERLearnedHints {
  /** Optimal chunk size in KB, learned from past executions */
  optimalChunkSizeKb: number;
  /** Optimal number of devices for this task type */
  optimalDeviceCount: number;
  /**
   * Best role for each capability tier (T1-T5).
   * 5 bytes: index 0 = T1, index 4 = T5.
   * Values: TierRole enum (EXCLUDE=0, COMPUTE=1, PREFER=2)
   */
  bestTierMapping: Uint8Array;
  /**
   * Bottleneck flags bitfield.
   * bit 0: network bottleneck
   * bit 1: CPU bottleneck
   * bit 2: memory bottleneck
   */
  bottleneckFlags: number;
}

/**
 * Mesh Experience Record (MER)
 *
 * A compact (<256 bytes), signed record capturing performance outcomes
 * and learned optimization parameters from a completed distributed computation.
 *
 * MERs are the atomic unit of knowledge in the Mesh Cognition Layer.
 * They are generated after verified task completion, stored in the
 * Distributed Mesh Memory (DHT), and propagated between meshes
 * through device mobility (cross-mesh pollination).
 */
export interface CMP_MER {
  /** Unique identifier (16 bytes) */
  merId: Uint8Array;
  /** Type of task this MER describes */
  taskType: TaskType;
  /**
   * Locality-sensitive hash of the mesh's capability profile.
   * Similar meshes produce similar signatures, enabling MER relevance
   * matching without exposing exact mesh composition. (8 bytes)
   */
  meshSignature: Uint8Array;
  /** Number of devices that participated in this task */
  deviceCount: number;
  /** Decomposition strategy that was used */
  strategyUsed: DecompositionStrategy;
  /** Number of chunks the task was split into */
  chunkCount: number;
  /** Average chunk payload size in KB */
  avgChunkSizeKb: number;
  /** Performance metrics from the completed task */
  performance: MERPerformance;
  /** Learned optimal parameters for future tasks of this type */
  learnedHints: MERLearnedHints;
  /**
   * Fuzzy hash of location/time pattern.
   * Provides k-anonymity (k ≥ 50 for typical urban environments).
   * Used for MER relevance ranking, NOT for tracking. (8 bytes)
   */
  environmentHash: Uint8Array;
  /** Confidence in this MER's learned values (0-100) */
  confidence: number;
  /**
   * Evolutionary generation count.
   * 0 = direct observation, >0 = evolved from parent MERs.
   * Capped at MER_MAX_GENERATION to prevent unbounded drift.
   */
  generation: number;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Time-to-live in days (default: 90) */
  ttlDays: number;
  /**
   * Locality-sensitive hash of the originating mesh.
   * NOT an exact identifier — prevents movement tracking. (8 bytes)
   */
  originMeshHash: Uint8Array;
  /** Ed25519 signature over MER binary content (64 bytes) */
  signature: Signature;
}

// ── MCL Profile ──

/**
 * MCL Profile — exchanged during capability advertisement.
 * Allows peers to discover relevant experience without
 * enumerating all MERs (bloom filter for efficient matching).
 */
export interface CMP_MCL_PROFILE {
  /** MCL protocol version (currently 1) */
  mclVersion: number;
  /** Total MERs this device carries */
  merCount: number;
  /**
   * Bloom filter of task types with experience.
   * k=3 hash functions, m=256 bits (32 bytes).
   * Allows efficient "do you have experience with X?" queries.
   */
  merCatalogBloom: Uint8Array;
  /** Age of oldest MER in days */
  oldestMerDays: number;
  /** Number of distinct mesh origins in MER store */
  crossMeshCount: number;
  /** Bytes available for MER exchange */
  storageAvailable: number;
}

// ── Strategy Hint ──

/**
 * Strategy Hint — generated from accumulated MERs.
 * Biases (but does NOT override) negotiation and distribution layers.
 *
 * Populated in the Task Request when the local Mesh Memory
 * contains relevant experience for the pending task type.
 */
export interface CMP_STRATEGY_HINT {
  /** Recommended decomposition strategy */
  recommendedStrategy: DecompositionStrategy;
  /** Recommended number of chunks */
  recommendedChunkCount: number;
  /** Recommended chunk size in KB */
  recommendedChunkSizeKb: number;
  /**
   * Recommended role for each tier (5 bytes, same as MER.learnedHints.bestTierMapping)
   */
  tierPreferences: Uint8Array;
  /** Confidence in this hint (0-100) */
  confidence: number;
  /** Highest generation among contributing MERs */
  merGeneration: number;
  /** Number of MERs that contributed to this hint */
  sourceMerCount: number;
}

// ── MCL Wire Messages ──

/** MER summary included in MER_OFFER (lightweight, no full MER payload) */
export interface MERSummary {
  merId: Uint8Array;
  taskType: TaskType;
  confidence: number;
  generation: number;
}

export interface MER_OFFER_Wire {
  offererId: number[];
  taskTypes: number[];
  summaries: {
    merId: number[];
    taskType: number;
    confidence: number;
    generation: number;
  }[];
}

export interface MER_REQUEST_Wire {
  requesterId: number[];
  merIds: number[][];
}

export interface MER_TRANSFER_Wire {
  senderId: number[];
  mers: MER_Wire[];
  transferSig: number[];
}

export interface MER_STORE_Wire {
  merId: number[];
  merData: number[];
}

export interface MER_QUERY_Wire {
  taskType: number;
  meshSignature: number[];
  maxResults: number;
}

/** MER in wire format (all Uint8Arrays as number[]) */
export interface MER_Wire {
  merId: number[];
  taskType: number;
  meshSignature: number[];
  deviceCount: number;
  strategyUsed: number;
  chunkCount: number;
  avgChunkSizeKb: number;
  performance: MERPerformance;
  learnedHints: {
    optimalChunkSizeKb: number;
    optimalDeviceCount: number;
    bestTierMapping: number[];
    bottleneckFlags: number;
  };
  environmentHash: number[];
  confidence: number;
  generation: number;
  createdAt: number;
  ttlDays: number;
  originMeshHash: number[];
  signature: number[];
}

// ── MCL Configuration ──

export interface MCLConfig {
  /** Enable Mesh Cognition Layer */
  enabled: boolean;
  /** Maximum MERs stored on this device */
  maxMers: number;
  /** Maximum MERs from a single origin mesh */
  maxPerOrigin: number;
  /** Maximum MERs transferred per join event */
  maxPerJoin: number;
  /** Minimum confidence to apply strategy hints (0-100) */
  minHintConfidence: number;
  /** MER time-to-live in days */
  merTtlDays: number;
  /** Probabilistic forwarding range [min, max] */
  forwardingRange: [number, number];
}

export const DEFAULT_MCL_CONFIG: MCLConfig = {
  enabled: true,
  maxMers: MER_MAX_PER_DEVICE,
  maxPerOrigin: MER_MAX_PER_ORIGIN,
  maxPerJoin: MER_MAX_PER_JOIN,
  minHintConfidence: MER_MIN_HINT_CONFIDENCE,
  merTtlDays: MER_DEFAULT_TTL_DAYS,
  forwardingRange: [0.6, 0.8],
};
