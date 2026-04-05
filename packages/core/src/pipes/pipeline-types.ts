/**
 * CMP v4.0 — Pipeline Types
 *
 * Type definitions for CMP Pipes — Unix-style streaming pipelines
 * across mesh devices. Each stage runs on a different device
 * simultaneously, streaming data through the pipeline.
 *
 * Example:
 *   pipe: capture_frames | detect_objects | count_people | alert
 *   4 stages, 4 devices, all running simultaneously.
 *
 * @module pipes/pipeline-types
 * @author Agent Viscro
 */

// ─── Wire Protocol Message Types ───

export enum PipeMessageType {
  PIPE_DEFINE       = 0xE0,
  PIPE_START        = 0xE1,
  PIPE_DATA         = 0xE2,
  PIPE_BACKPRESSURE = 0xE3,
  PIPE_METRICS      = 0xE4,
  PIPE_REBALANCE    = 0xE5,
  PIPE_STOP         = 0xE6,
}

// ─── Pipeline State ───

export enum PipelineState {
  DEFINED  = 'defined',
  STARTING = 'starting',
  RUNNING  = 'running',
  PAUSED   = 'paused',
  STOPPING = 'stopping',
  STOPPED  = 'stopped',
  FAILED   = 'failed',
}

// ─── Stage Definition ───

export interface StageDefinition {
  /** Stage name (e.g., "filter", "map", "detect_objects") */
  name: string;
  /** Stage type: builtin or wasm */
  type: 'builtin' | 'wasm';
  /** For builtin: function name. For wasm: hex-encoded module */
  handler: string;
  /** Stage configuration / parameters */
  config: Record<string, any>;
  /** Stage index in the pipeline (0-based) */
  index: number;
}

// ─── Stage Instance (runtime) ───

export interface StageInstance {
  definition: StageDefinition;
  /** Device this stage is assigned to */
  deviceId: string;
  /** Current state */
  state: 'idle' | 'running' | 'paused' | 'stopped';
  /** Items processed so far */
  itemsProcessed: number;
  /** Items currently in buffer */
  bufferSize: number;
  /** Buffer capacity before backpressure triggers */
  bufferCapacity: number;
  /** Whether backpressure is active */
  backpressureActive: boolean;
  /** Throughput: items per second */
  throughput: number;
  /** Average processing time per item (ms) */
  avgLatencyMs: number;
  /** Start time */
  startedAt: number | null;
}

// ─── Pipeline Definition ───

export interface PipelineDefinition {
  /** Pipeline name */
  name: string;
  /** Ordered list of stages */
  stages: StageDefinition[];
}

// ─── Pipeline Instance (runtime) ───

export interface PipelineInstance {
  /** Pipeline name */
  name: string;
  /** Current state */
  state: PipelineState;
  /** Stage instances */
  stages: StageInstance[];
  /** When pipeline was defined */
  definedAt: number;
  /** When pipeline was started */
  startedAt: number | null;
  /** When pipeline was stopped */
  stoppedAt: number | null;
  /** Total items pushed into pipeline */
  totalItemsPushed: number;
  /** Total items emitted from last stage */
  totalItemsEmitted: number;
  /** Error message (if failed) */
  error: string | null;
}

// ─── Pipeline Metrics ───

export interface PipelineMetrics {
  name: string;
  state: PipelineState;
  uptime: number;
  totalItemsPushed: number;
  totalItemsEmitted: number;
  stages: StageMetrics[];
  bottleneckStage: number | null;
}

export interface StageMetrics {
  index: number;
  name: string;
  deviceId: string;
  itemsProcessed: number;
  bufferSize: number;
  throughput: number;
  avgLatencyMs: number;
  backpressureActive: boolean;
}

// ─── Pipeline Config ───

export interface PipelineConfig {
  /** Default buffer capacity per stage */
  defaultBufferCapacity: number;
  /** Backpressure threshold (fraction of buffer capacity) */
  backpressureThreshold: number;
  /** Persistent backpressure timeout before rebalance (ms) */
  rebalanceTimeoutMs: number;
  /** Metrics reporting interval (ms) */
  metricsIntervalMs: number;
  /** Maximum pipelines allowed */
  maxPipelines: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  defaultBufferCapacity: 100,
  backpressureThreshold: 0.8,
  rebalanceTimeoutMs: 30000,
  metricsIntervalMs: 5000,
  maxPipelines: 10,
};

// ─── Stage Function ───

/**
 * A stage processing function.
 * Receives an item, returns zero or more output items.
 * Returning empty array = item filtered out.
 * Returning multiple items = fan-out.
 */
export type StageFn = (item: Uint8Array, config: Record<string, any>) => Uint8Array[];

// ─── Pipeline Event ───

export interface PipelineEvent {
  type: 'started' | 'stopped' | 'failed' | 'backpressure' | 'rebalance' | 'item_pushed' | 'item_emitted';
  pipelineName: string;
  stageIndex?: number;
  timestamp: number;
  details?: string;
}
