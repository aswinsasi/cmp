/**
 * CMP Task Types
 * Layer 3-4: Task requests, chunks, and decomposition.
 *
 * @module types/task
 * @author Agent Viscro
 */

import { TaskId, MeshId, ChunkId, Hash256, Signature, CCU } from './primitives';
import { Runtime } from './capability';

export enum TaskType {
  INFERENCE = 0,
  MAP_REDUCE = 1,
  PIPELINE = 2,
  SCATTER_GATHER = 3,
  CUSTOM = 4,
}

export enum SecurityLevel {
  PUBLIC = 0,
  PRIVATE = 1,
  CONFIDENTIAL = 2,
}

export enum VerifyMode {
  NONE = 0,
  CHECKSUM = 1,
  REDUNDANT = 2,
  ZK_PROOF = 3,
}

export enum EncryptionAlgo {
  AES_256_GCM = 0,
  CHACHA20_POLY1305 = 1,
}

export enum Priority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export enum OutputFormat {
  RAW_BYTES = 0,
  JSON = 1,
  TENSOR = 2,
  PROTOBUF = 3,
}

export interface ComputeBudget {
  minCores: number;
  minMemoryMb: number;
  gpuRequired: boolean;
  deadlineMs: number;
}

export interface TaskSecurity {
  encryption: EncryptionAlgo;
  verifyMode: VerifyMode;
  dataSensitivity: SecurityLevel;
}

/**
 * Task Request - broadcast to mesh when computation is needed.
 */
export interface CMPTaskRequest {
  taskId: TaskId;
  requesterId: MeshId;
  taskType: TaskType;
  runtimeRequired: Runtime;
  payloadSizeKb: number;
  computeBudget: ComputeBudget;
  security: TaskSecurity;
  /** Suggested number of chunks, 0 = auto */
  chunkHint: number;
  priority: Priority;
  creditsOffered: CCU;
  signature: Signature;
}

export interface CodeReference {
  runtime: Runtime;
  moduleHash: Hash256;
  moduleUrl?: string;
  entryPoint: string;
}

export interface ExpectedOutput {
  format: OutputFormat;
  maxSizeKb: number;
}

/**
 * Chunk - a unit of distributed work assigned to a device.
 */
export interface CMPChunk {
  chunkId: ChunkId;
  taskId: TaskId;
  sequence: number;
  totalChunks: number;
  assigneeId: MeshId;
  /** Encrypted input data */
  payload: Uint8Array;
  codeRef: CodeReference;
  /** ChunkIds that must complete before this chunk can execute */
  dependencies: ChunkId[];
  expectedOutput: ExpectedOutput;
  /** Number of devices that run this chunk (for redundant verification) */
  redundancy: number;
  timeoutMs: number;
}
