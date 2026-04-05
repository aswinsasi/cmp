/**
 * CMP v4.0 — Job Type Definitions
 *
 * Types for the persistent job queue system.
 * Jobs wrap mesh compute tasks with lifecycle management,
 * priority ordering, retry logic, and persistence.
 *
 * @module scheduler/job-types
 * @author Agent Viscro
 */

import { Priority, TaskType } from '../types/task';

// ─── Job State Machine ───

/**
 * Job lifecycle:
 *   SUBMITTED → QUEUED → ASSIGNED → RUNNING → COMPLETED
 *                                            → FAILED → RETRY → RUNNING
 *                                            → CANCELLED
 */
export enum JobState {
  SUBMITTED  = 'submitted',
  QUEUED     = 'queued',
  ASSIGNED   = 'assigned',
  RUNNING    = 'running',
  COMPLETED  = 'completed',
  FAILED     = 'failed',
  RETRY      = 'retry',
  CANCELLED  = 'cancelled',
}

/** Terminal states — job is done and won't change again */
export const TERMINAL_STATES = new Set([
  JobState.COMPLETED,
  JobState.FAILED,
  JobState.CANCELLED,
]);

/** Active states — job is in progress */
export const ACTIVE_STATES = new Set([
  JobState.QUEUED,
  JobState.ASSIGNED,
  JobState.RUNNING,
  JobState.RETRY,
]);

// ─── Job Definition ───

export interface JobDefinition {
  /** WASM module bytes (the code to execute) */
  wasmModule: Uint8Array;
  /** Input data bytes */
  inputData: Uint8Array;
  /** Entry point function name in WASM module */
  entryPoint: string;
  /** Task type hint for the scheduler */
  taskType: TaskType;
  /** Execution deadline per attempt (ms) */
  deadlineMs: number;
  /** Number of chunks (0 = auto) */
  chunkHint: number;
}

// ─── Job Record ───

export interface Job {
  /** Unique job ID (1-based auto-increment) */
  id: number;
  /** Current state */
  state: JobState;
  /** Priority (affects queue ordering) */
  priority: Priority;
  /** Whether the job was submitted as background */
  background: boolean;
  /** Job definition (what to execute) */
  definition: JobDefinition;
  /** Maximum retry attempts (default: 3) */
  maxRetries: number;
  /** Current retry count */
  retryCount: number;
  /** Error message (if FAILED) */
  error: string | null;
  /** Result data (if COMPLETED) */
  result: JobResult | null;
  /** ID of the device that claimed this job (if ASSIGNED/RUNNING) */
  claimedBy: string | null;
  /** Timestamps */
  submittedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  /** Tags for filtering/grouping */
  tags: string[];
}

// ─── Job Result ───

export interface JobResult {
  /** Output data bytes */
  data: Uint8Array;
  /** Total execution time (ms) */
  totalTimeMs: number;
  /** Number of chunks executed */
  chunksExecuted: number;
  /** Number of devices used */
  devicesUsed: number;
  /** Whether result was verified */
  verified: boolean;
  /** Whether execution fell back to local */
  localFallback: boolean;
}

// ─── Job Events ───

export interface JobEvent {
  type: 'submitted' | 'queued' | 'assigned' | 'started' | 'completed' | 'failed' | 'retry' | 'cancelled';
  jobId: number;
  timestamp: number;
  details?: string;
}

// ─── Job Queue Config ───

export interface JobQueueConfig {
  /** Maximum number of jobs to keep in history (default: 1000) */
  maxHistorySize: number;
  /** Default max retries for new jobs (default: 3) */
  defaultMaxRetries: number;
  /** Default deadline per attempt in ms (default: 30000) */
  defaultDeadlineMs: number;
  /** Interval to poll queue for pending jobs in ms (default: 1000) */
  pollIntervalMs: number;
  /** Maximum concurrent running jobs (default: 4) */
  maxConcurrent: number;
}

export const DEFAULT_JOB_QUEUE_CONFIG: JobQueueConfig = {
  maxHistorySize: 1000,
  defaultMaxRetries: 3,
  defaultDeadlineMs: 30000,
  pollIntervalMs: 1000,
  maxConcurrent: 4,
};

// ─── Job Filter ───

export interface JobFilter {
  state?: JobState | JobState[];
  priority?: Priority;
  background?: boolean;
  tags?: string[];
  limit?: number;
}

// ─── Job Stats ───

export interface JobStats {
  total: number;
  byState: Record<string, number>;
  completed: number;
  failed: number;
  cancelled: number;
  running: number;
  queued: number;
  avgCompletionTimeMs: number;
  totalRetries: number;
}

// ─── Wire Protocol ───

/** New v4.0 message types for job announcements */
export enum JobMessageType {
  JOB_ANNOUNCE = 0xD1,
  JOB_CLAIM    = 0xD2,
  JOB_RESULT   = 0xD3,
}

export interface JobAnnounceWire {
  jobId: number;
  priority: number;
  taskType: number;
  payloadSizeKb: number;
  deadlineMs: number;
  announcerId: string;
}

export interface JobClaimWire {
  jobId: number;
  claimerId: string;
  estimatedTimeMs: number;
}

export interface JobResultWire {
  jobId: number;
  executorId: string;
  success: boolean;
  resultHex: string | null;
  totalTimeMs: number;
  chunksExecuted: number;
  devicesUsed: number;
  error: string | null;
}
