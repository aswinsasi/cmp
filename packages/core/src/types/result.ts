/**
 * CMP Result Types
 * Layer 6: Chunk results, verification, and task completion.
 *
 * @module types/result
 * @author Agent Viscro
 */

import { ChunkId, TaskId, MeshId, Signature } from './primitives';

export enum ChunkStatus {
  SUCCESS = 0,
  FAILED = 1,
  TIMEOUT = 2,
  RESOURCE_EXCEEDED = 3,
}

export interface ResourceUsage {
  cpuMs: number;
  memoryPeakMb: number;
  gpuMs: number;
}

/**
 * Chunk Result - returned by executor after computation.
 */
export interface CMPResult {
  chunkId: ChunkId;
  taskId: TaskId;
  executorId: MeshId;
  status: ChunkStatus;
  /** Encrypted output data */
  payload: Uint8Array;
  executionTimeMs: number;
  resourceUsed: ResourceUsage;
  /** Verification proof (mode-dependent) */
  proof: Uint8Array;
  signature: Signature;
}

/**
 * Verification result from the assembly layer.
 */
export interface VerifyResult {
  valid: boolean;
  /** 0.0 - 1.0, higher = more confident */
  confidence: number;
  majorityHash?: string;
  reason?: string;
}

/**
 * Final task completion report.
 */
export interface TaskCompletion {
  taskId: TaskId;
  /** Assembled and decrypted result */
  result: Uint8Array;
  totalTimeMs: number;
  chunksExecuted: number;
  devicesUsed: number;
  verificationType: string;
  verificationResult: VerifyResult;
}
