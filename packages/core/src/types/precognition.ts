/**
 * CMP v1.3 — Mesh Precognition Type Definitions
 * Layer 9: Speculative pre-computation during idle periods.
 *
 * @module types/precognition
 * @author Agent Viscro
 */

import { TaskType } from './task';

// ─── Prediction Types ───

export enum PredictionPattern {
  /** Same task type repeats at regular intervals */
  TEMPORAL_RECURRENCE = 'temporal_recurrence',
  /** Task B always follows Task A */
  SEQUENTIAL_CHAIN = 'sequential_chain',
  /** Same module with similar input sizes */
  PAYLOAD_SIMILARITY = 'payload_similarity',
  /** Time-of-day correlation */
  DIURNAL_CYCLE = 'diurnal_cycle',
  /** Burst pattern — rapid sequence of same task */
  BURST_PATTERN = 'burst_pattern',
}

export interface Prediction {
  /** Unique prediction ID */
  id: Uint8Array;                    // 16 bytes
  /** Predicted task type */
  taskType: TaskType;
  /** Predicted WASM module hash */
  moduleHash: Uint8Array;            // 32 bytes SHA-256
  /** Predicted input data fingerprint (first 32 bytes of SHA-256 of likely input) */
  inputFingerprint: Uint8Array;      // 32 bytes
  /** Confidence score 0.0 - 1.0 */
  confidence: number;
  /** Predicted time window when task will arrive (Unix ms) */
  predictedWindowStart: number;
  predictedWindowEnd: number;
  /** Source MER IDs that informed this prediction */
  sourceMerIds: string[];
  /** When this prediction was generated */
  createdAt: number;
  /** Prediction pattern type */
  patternType: PredictionPattern;
}

export interface PredictionSet {
  /** Ordered list of predictions, highest confidence first */
  predictions: Prediction[];
  /** Total speculative CCU budget for this cycle */
  speculativeBudget: number;
  /** Generation timestamp */
  generatedAt: number;
  /** Next scheduled generation time */
  nextGenerationAt: number;
}

// ─── Speculative Execution Types ───

export enum SpeculativeChunkStatus {
  QUEUED = 'queued',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  ABORTED = 'aborted',
  EVICTED = 'evicted',
}

export interface SpeculativeChunk {
  /** Links back to prediction */
  predictionId: Uint8Array;
  /** Actual chunk data (same format as regular chunks) */
  chunkId: Uint8Array;
  taskId: Uint8Array;
  /** Executor peer mesh ID */
  executorId: Uint8Array;
  /** Status */
  status: SpeculativeChunkStatus;
  /** Is this a soft allocation? (abortable if real task arrives) */
  softAllocation: boolean;
  /** Timestamp */
  startedAt: number;
  completedAt?: number;
}

// ─── Phantom Cache Types ───

export interface PhantomCacheEntry {
  /** Cache key = SHA-256(moduleHash + inputFingerprint + params) */
  cacheKey: string;
  /** The pre-computed result data (encrypted) */
  resultData: Uint8Array;
  /** Result hash for verification */
  resultHash: Uint8Array;            // 32 bytes
  /** Confidence that this result matches a future real task */
  confidence: number;
  /** Time-to-live in milliseconds */
  ttlMs: number;
  /** When cached */
  cachedAt: number;
  /** Prediction that generated this entry */
  predictionId: Uint8Array;
  /** Devices that participated in speculative execution */
  executorIds: Uint8Array[];
  /** Number of times this entry was hit by a real task */
  hitCount: number;
}

export interface PhantomCacheConfig {
  /** Maximum number of cached entries (default: 256) */
  maxEntries: number;
  /** Default TTL for cache entries in ms (default: 300000 = 5 minutes) */
  defaultTtlMs: number;
  /** Minimum confidence to cache a result (default: 0.6) */
  minCacheConfidence: number;
  /** Maximum total cache size in bytes (default: 50MB) */
  maxCacheSizeBytes: number;
}

// ─── Misprediction Tracking ───

export interface MispredictionStats {
  /** Total predictions made */
  totalPredictions: number;
  /** Predictions that matched a real task (cache hit) */
  hits: number;
  /** Predictions that expired without matching (cache miss) */
  misses: number;
  /** Hit rate = hits / totalPredictions */
  hitRate: number;
  /** Total speculative CCU spent */
  speculativeCcuSpent: number;
  /** CCU saved by cache hits (estimated) */
  ccuSavedByHits: number;
  /** Net CCU benefit = saved - spent */
  netCcuBenefit: number;
  /** Per-pattern hit rates */
  patternHitRates: Map<PredictionPattern, number>;
  /** Current aggressiveness level 0.0 - 1.0 */
  aggressiveness: number;
}

// ─── Dream Scheduler Config ───

export interface DreamSchedulerConfig {
  /** Minimum idle duration before dreaming starts (ms, default: 30000) */
  minIdleBeforeDreamMs: number;
  /** CPU threshold below which device is considered idle (default: 0.15 = 15%) */
  idleCpuThreshold: number;
  /** Maximum speculative CCU budget per dream cycle (default: 50) */
  maxSpeculativeBudgetPerCycle: number;
  /** How often to re-generate predictions (ms, default: 60000) */
  predictionIntervalMs: number;
  /** Minimum MERs required before predictions begin (default: 10) */
  minMersForPrediction: number;
  /** Maximum predictions per cycle (default: 8) */
  maxPredictionsPerCycle: number;
  /** Initial aggressiveness (default: 0.3 — conservative) */
  initialAggressiveness: number;
}

// ─── Speculative Wire Message Types ───

export enum SpeculativeMessageType {
  SPECULATIVE_OFFER = 0x80,
  SPECULATIVE_ACK = 0x81,
  SPECULATIVE_RESULT = 0x82,
  SPECULATIVE_ABORT = 0x83,
  PHANTOM_HIT = 0x84,
}

export enum SpeculativeAbortReason {
  REAL_TASK_ARRIVED = 0x00,
  PREDICTION_EXPIRED = 0x01,
  RESOURCE_NEEDED = 0x02,
  MANUAL = 0x03,
}

export enum SpeculativeRejectReason {
  BUSY = 0x00,
  LOW_BATTERY = 0x01,
  NO_RUNTIME = 0x02,
}
