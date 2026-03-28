/**
 * CMP Mesh Experience Record (MER)
 * The atomic unit of knowledge in the Mesh Cognition Layer.
 *
 * MERs capture performance outcomes and learned optimization parameters
 * from completed distributed computations. They are:
 *   - Generated after verified task completion
 *   - Stored in the Distributed Mesh Memory (DHT)
 *   - Propagated between meshes through device mobility
 *   - Evolved through micro-evolution when multiple MERs exist
 *
 * Each MER is Ed25519-signed by the device that generated it.
 * Unsigned or invalid-signature MERs MUST be rejected.
 *
 * @module mcl/mer
 * @author Agent Viscro
 */

import {
  randomBytes, hash256, sign, verify, toHex, shortId, Logger,
} from '../';

import type { Signature } from '../types/primitives';
import type { TaskType } from '../types/task';
import type {
  CMP_MER, MERPerformance, MERLearnedHints,
  DecompositionStrategy, MER_Wire,
} from '../types/mcl';

import {
  MER_ID_SIZE, MESH_SIGNATURE_SIZE, ENVIRONMENT_HASH_SIZE,
  ORIGIN_MESH_HASH_SIZE, TIER_COUNT, MER_DEFAULT_TTL_DAYS,
  MER_MAX_GENERATION,
} from '../types/mcl';

const log = new Logger('MER');

// ── MER Creation ──

export interface MERCreateParams {
  taskType: TaskType;
  meshSignature: Uint8Array;
  deviceCount: number;
  strategyUsed: DecompositionStrategy;
  chunkCount: number;
  avgChunkSizeKb: number;
  performance: MERPerformance;
  learnedHints: MERLearnedHints;
  environmentHash: Uint8Array;
  originMeshHash: Uint8Array;
  /** 0 for direct observation, >0 for evolved MERs */
  generation?: number;
  /** Override confidence (0-100), otherwise auto-calculated */
  confidence?: number;
  /** Override TTL in days */
  ttlDays?: number;
}

/**
 * Create a new MER and sign it with the provided secret key.
 *
 * @param params - MER parameters from task completion
 * @param secretKey - Ed25519 secret key (64 bytes) for signing
 * @returns Signed CMP_MER
 */
export function createMER(params: MERCreateParams, secretKey: Uint8Array): CMP_MER {
  const merId = randomBytes(MER_ID_SIZE);
  const generation = Math.min(params.generation ?? 0, MER_MAX_GENERATION);

  // Auto-calculate confidence from performance metrics if not provided
  const confidence = params.confidence ?? calculateConfidence(params.performance, generation);

  const mer: CMP_MER = {
    merId,
    taskType: params.taskType,
    meshSignature: ensureSize(params.meshSignature, MESH_SIGNATURE_SIZE),
    deviceCount: params.deviceCount,
    strategyUsed: params.strategyUsed,
    chunkCount: params.chunkCount,
    avgChunkSizeKb: params.avgChunkSizeKb,
    performance: { ...params.performance },
    learnedHints: {
      optimalChunkSizeKb: params.learnedHints.optimalChunkSizeKb,
      optimalDeviceCount: params.learnedHints.optimalDeviceCount,
      bestTierMapping: ensureSize(params.learnedHints.bestTierMapping, TIER_COUNT),
      bottleneckFlags: params.learnedHints.bottleneckFlags & 0x07, // 3 bits
    },
    environmentHash: ensureSize(params.environmentHash, ENVIRONMENT_HASH_SIZE),
    confidence: clamp(confidence, 0, 100),
    generation,
    createdAt: Date.now(),
    ttlDays: params.ttlDays ?? MER_DEFAULT_TTL_DAYS,
    originMeshHash: ensureSize(params.originMeshHash, ORIGIN_MESH_HASH_SIZE),
    signature: new Uint8Array(64), // placeholder, filled below
  };

  // Sign the MER content (everything except the signature field)
  mer.signature = signMER(mer, secretKey);

  log.info(`MER created: ${shortId(merId)} gen=${generation} conf=${confidence} task=${mer.taskType}`);
  return mer;
}

/**
 * Auto-calculate MER confidence from performance metrics.
 * Higher efficiency + fewer faults + higher generation = higher confidence.
 */
function calculateConfidence(perf: MERPerformance, generation: number): number {
  let conf = perf.executionEfficiency; // base: 0-100

  // Penalize for faults
  conf -= perf.faultEvents * 10;

  // Penalize for high overhead
  if (perf.distributionOverheadPct > 20) {
    conf -= (perf.distributionOverheadPct - 20);
  }

  // Bonus for evolved MERs (more observations = more trustworthy)
  conf += Math.min(generation * 3, 15);

  return clamp(Math.round(conf), 5, 100);
}

// ── MER Signing & Verification ──

/**
 * Compute the canonical bytes to sign for a MER.
 * Includes all fields EXCEPT the signature itself.
 */
function merCanonicalBytes(mer: CMP_MER): Uint8Array {
  const parts: Uint8Array[] = [
    mer.merId,
    new Uint8Array([mer.taskType]),
    mer.meshSignature,
    new Uint8Array([mer.deviceCount]),
    new Uint8Array([mer.strategyUsed]),
    uint16BE(mer.chunkCount),
    uint32BE(mer.avgChunkSizeKb),
    uint32BE(mer.performance.totalTimeMs),
    new Uint8Array([mer.performance.distributionOverheadPct]),
    new Uint8Array([mer.performance.executionEfficiency]),
    new Uint8Array([mer.performance.faultEvents]),
    new Uint8Array([mer.performance.reassignmentCount]),
    uint32BE(mer.learnedHints.optimalChunkSizeKb),
    new Uint8Array([mer.learnedHints.optimalDeviceCount]),
    mer.learnedHints.bestTierMapping,
    new Uint8Array([mer.learnedHints.bottleneckFlags]),
    mer.environmentHash,
    new Uint8Array([mer.confidence]),
    uint16BE(mer.generation),
    uint48BE(mer.createdAt),
    uint16BE(mer.ttlDays),
    mer.originMeshHash,
  ];

  // Concatenate all parts
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Sign MER content with Ed25519.
 */
function signMER(mer: CMP_MER, secretKey: Uint8Array): Signature {
  const canonical = merCanonicalBytes(mer);
  const digest = hash256(canonical);
  return sign(digest, secretKey);
}

/**
 * Verify a MER's Ed25519 signature.
 *
 * @param mer - MER to verify
 * @param publicKey - 32-byte Ed25519 public key of the MER creator
 * @returns true if signature is valid
 */
export function verifyMER(mer: CMP_MER, publicKey: Uint8Array): boolean {
  const canonical = merCanonicalBytes(mer);
  const digest = hash256(canonical);
  return verify(digest, mer.signature, publicKey);
}

/**
 * Check if a MER has expired based on its TTL.
 */
export function isMERExpired(mer: CMP_MER): boolean {
  const expiresAt = mer.createdAt + (mer.ttlDays * 24 * 60 * 60 * 1000);
  return Date.now() > expiresAt;
}

/**
 * Compute the DHT key for a MER.
 * Key = SHA-256(taskType || meshSignature)[0:8]
 */
export function merDHTKey(taskType: TaskType, meshSignature: Uint8Array): Uint8Array {
  const input = new Uint8Array(1 + MESH_SIGNATURE_SIZE);
  input[0] = taskType;
  input.set(meshSignature.slice(0, MESH_SIGNATURE_SIZE), 1);
  return hash256(input).slice(0, 8);
}

// ── MER Wire Conversion ──

/**
 * Convert a CMP_MER to wire format (number arrays for JSON serialization).
 */
export function merToWire(mer: CMP_MER): MER_Wire {
  return {
    merId: Array.from(mer.merId),
    taskType: mer.taskType,
    meshSignature: Array.from(mer.meshSignature),
    deviceCount: mer.deviceCount,
    strategyUsed: mer.strategyUsed,
    chunkCount: mer.chunkCount,
    avgChunkSizeKb: mer.avgChunkSizeKb,
    performance: { ...mer.performance },
    learnedHints: {
      optimalChunkSizeKb: mer.learnedHints.optimalChunkSizeKb,
      optimalDeviceCount: mer.learnedHints.optimalDeviceCount,
      bestTierMapping: Array.from(mer.learnedHints.bestTierMapping),
      bottleneckFlags: mer.learnedHints.bottleneckFlags,
    },
    environmentHash: Array.from(mer.environmentHash),
    confidence: mer.confidence,
    generation: mer.generation,
    createdAt: mer.createdAt,
    ttlDays: mer.ttlDays,
    originMeshHash: Array.from(mer.originMeshHash),
    signature: Array.from(mer.signature),
  };
}

/**
 * Convert wire format back to CMP_MER.
 */
export function merFromWire(wire: MER_Wire): CMP_MER {
  return {
    merId: new Uint8Array(wire.merId),
    taskType: wire.taskType as TaskType,
    meshSignature: new Uint8Array(wire.meshSignature),
    deviceCount: wire.deviceCount,
    strategyUsed: wire.strategyUsed as any,
    chunkCount: wire.chunkCount,
    avgChunkSizeKb: wire.avgChunkSizeKb,
    performance: { ...wire.performance },
    learnedHints: {
      optimalChunkSizeKb: wire.learnedHints.optimalChunkSizeKb,
      optimalDeviceCount: wire.learnedHints.optimalDeviceCount,
      bestTierMapping: new Uint8Array(wire.learnedHints.bestTierMapping),
      bottleneckFlags: wire.learnedHints.bottleneckFlags,
    },
    environmentHash: new Uint8Array(wire.environmentHash),
    confidence: wire.confidence,
    generation: wire.generation,
    createdAt: wire.createdAt,
    ttlDays: wire.ttlDays,
    originMeshHash: new Uint8Array(wire.originMeshHash),
    signature: new Uint8Array(wire.signature),
  };
}

// ── Helpers ──

function ensureSize(arr: Uint8Array, size: number): Uint8Array {
  if (arr.length === size) return new Uint8Array(arr);
  const result = new Uint8Array(size);
  result.set(arr.slice(0, size));
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uint16BE(n: number): Uint8Array {
  const buf = new Uint8Array(2);
  buf[0] = (n >> 8) & 0xFF;
  buf[1] = n & 0xFF;
  return buf;
}

function uint32BE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (n >> 24) & 0xFF;
  buf[1] = (n >> 16) & 0xFF;
  buf[2] = (n >> 8) & 0xFF;
  buf[3] = n & 0xFF;
  return buf;
}

function uint48BE(n: number): Uint8Array {
  // 6 bytes for timestamps (good until year 10889)
  const buf = new Uint8Array(6);
  buf[0] = Math.floor(n / 2**40) & 0xFF;
  buf[1] = Math.floor(n / 2**32) & 0xFF;
  buf[2] = (n >> 24) & 0xFF;
  buf[3] = (n >> 16) & 0xFF;
  buf[4] = (n >> 8) & 0xFF;
  buf[5] = n & 0xFF;
  return buf;
}
