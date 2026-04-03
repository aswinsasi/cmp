/**
 * CMP v3.0 — Mesh Cortex Type Definitions (Layer 14)
 * Distributed neural network inference across mesh devices.
 *
 * A model is split into partitions. Each partition is assigned to a device
 * and backed by a LayerLifeform. Inference flows as a causal chain
 * through synapses connecting sequential layer partitions.
 *
 * Wire protocol message types: 0xF6-0xFB
 *
 * @module types/cortex
 * @author Agent Viscro
 */

// ─── Wire Protocol Messages (Layer 14) ───

export enum CortexMessageType {
  /** Announce model partition assignment */
  MODEL_PARTITION = 0xF6,
  /** Forward activation tensor to next layer */
  LAYER_ACTIVATION = 0xF7,
  /** Return processed activation from a layer */
  LAYER_RESULT = 0xF8,
  /** Request model rebalance (device joined/left) */
  MODEL_REBALANCE = 0xF9,
  /** Submit inference request to the cortex */
  INFERENCE_REQUEST = 0xFA,
  /** Return inference result */
  INFERENCE_RESULT = 0xFB,
}

// ─── Tensor ───

export interface Tensor {
  /** Flat data array */
  data: Float32Array;
  /** Shape dimensions e.g. [1, 768] for a single embedding */
  shape: number[];
}

// ─── Model Manifest ───

export interface ModelManifest {
  /** Unique model identifier */
  modelId: string;
  /** Human-readable model name */
  modelName: string;
  /** Total number of layers */
  totalLayers: number;
  /** Total parameters (approximate) */
  totalParams: number;
  /** Quantization bit depth */
  quantization: 4 | 8 | 16 | 32;
  /** Total model size in bytes */
  totalSizeBytes: number;
  /** Size of each layer in bytes */
  layerSizes: number[];
  /** Model input shape */
  inputShape: number[];
  /** Model output shape */
  outputShape: number[];
  /** Hidden dimension size */
  hiddenDim: number;
}

// ─── Layer Partition ───

export interface LayerPartition {
  /** Partition ID */
  partitionId: string;
  /** Model this partition belongs to */
  modelId: string;
  /** Layer range [start, end] inclusive */
  layerRange: [number, number];
  /** Weights for these layers (quantized) */
  weights: Float32Array;
  /** Size of this partition in bytes */
  sizeBytes: number;
  /** Device assigned to this partition */
  assignedDevice: string;
  /** Next partition's device (for forwarding activations) */
  nextDevice: string | null;
}

// ─── Inference Request ───

export interface InferenceRequest {
  /** Unique request ID */
  requestId: string;
  /** Target model */
  modelId: string;
  /** Input tensor */
  input: Tensor;
  /** Deadline timestamp */
  deadline: number;
  /** Callback: where to send the result */
  callbackDevice: string;
}

// ─── Inference Result ───

export interface InferenceResult {
  /** Request ID this result is for */
  requestId: string;
  /** Model used */
  modelId: string;
  /** Output tensor */
  output: Tensor;
  /** Total inference time in ms */
  totalMs: number;
  /** Per-partition timing */
  partitionTimings: Array<{
    partitionId: string;
    device: string;
    layerRange: [number, number];
    computeMs: number;
  }>;
  /** Whether any partition was served from a replica (fault recovery) */
  usedReplica: boolean;
}

// ─── Cortex Configuration ───

export interface CortexConfig {
  /** Maximum memory to use for model partitions (bytes). Default: 512MB */
  maxMemoryBytes: number;
  /** Inference timeout in ms. Default: 30000 */
  inferenceTimeoutMs: number;
  /** Whether to replicate partitions for fault tolerance. Default: true */
  replicatePartitions: boolean;
  /** Maximum partitions per device. Default: 4 */
  maxPartitionsPerDevice: number;
}

export const DEFAULT_CORTEX_CONFIG: CortexConfig = {
  maxMemoryBytes: 536870912,    // 512MB
  inferenceTimeoutMs: 30000,
  replicatePartitions: true,
  maxPartitionsPerDevice: 4,
};

// ─── Partition Assignment ───

export interface PartitionAssignment {
  partitionId: string;
  layerRange: [number, number];
  device: string;
  sizeBytes: number;
}

// ─── Cortex Status ───

export interface CortexStatus {
  /** Models loaded in the cortex */
  models: Array<{
    modelId: string;
    modelName: string;
    totalLayers: number;
    partitions: number;
    devices: string[];
    ready: boolean;
  }>;
  /** Total memory used across all partitions */
  totalMemoryUsed: number;
  /** Pending inference requests */
  pendingInferences: number;
  /** Completed inferences */
  completedInferences: number;
}
