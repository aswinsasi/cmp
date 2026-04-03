/**
 * CMP v3.0 — Mesh GPU Type Definitions (Layer 16)
 * Share GPU compute across the mesh. A device without a GPU can
 * submit compute shaders that execute on a remote device's GPU.
 *
 * Wire protocol message types: 0xFC-0xFE
 *
 * @module types/gpu
 * @author Agent Viscro
 */

// ─── Wire Protocol Messages (Layer 16) ───

export enum GPUMessageType {
  /** Submit a GPU compute task */
  GPU_TASK_SUBMIT = 0xFC,
  /** Return GPU compute result */
  GPU_TASK_RESULT = 0xFD,
  /** GPU capability advertisement */
  GPU_CAPABILITY_AD = 0xFE,
}

// ─── GPU Capability ───

export interface GPUCapability {
  /** Whether GPU is available on this device */
  available: boolean;
  /** GPU adapter name (e.g. "NVIDIA RTX 3060") */
  adapterName: string;
  /** Maximum buffer size in bytes */
  maxBufferSize: number;
  /** Max compute workgroup dimensions [x, y, z] */
  maxComputeWorkgroups: [number, number, number];
  /** Max invocations per workgroup */
  maxComputeInvocations: number;
  /** Estimated VRAM in bytes */
  vramBytes: number;
  /** Current VRAM usage (0.0-1.0) */
  vramUtilization: number;
  /** Current compute utilization (0.0-1.0) */
  computeUtilization: number;
}

export const NO_GPU: GPUCapability = {
  available: false,
  adapterName: 'none',
  maxBufferSize: 0,
  maxComputeWorkgroups: [0, 0, 0],
  maxComputeInvocations: 0,
  vramBytes: 0,
  vramUtilization: 0,
  computeUtilization: 0,
};

// ─── GPU Task ───

export interface GPUTask {
  /** Unique task ID */
  taskId: string;
  /** WGSL compute shader source code */
  shaderCode: string;
  /** Input buffers */
  buffers: GPUBufferInput[];
  /** Workgroup dispatch dimensions [x, y, z] */
  workgroups: [number, number, number];
  /** Which buffer indices to read back as output */
  outputBufferIndices: number[];
  /** Priority */
  priority: 'low' | 'normal' | 'high';
  /** Deadline timestamp (0 = no deadline) */
  deadline: number;
  /** Submitter device ID */
  submitterDevice: string;
}

// ─── GPU Buffer ───

export interface GPUBufferInput {
  /** Buffer label (for debugging) */
  label: string;
  /** Buffer data (Float32Array serialized as base64 or raw) */
  data: Float32Array;
  /** Buffer usage: 'storage' for read-write, 'uniform' for read-only */
  usage: 'storage' | 'uniform' | 'read-only-storage';
}

// ─── GPU Result ───

export interface GPUTaskResult {
  /** Task ID this result is for */
  taskId: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Output buffer data (one per outputBufferIndices entry) */
  outputBuffers: Float32Array[];
  /** Compute time in ms */
  computeMs: number;
  /** Device that executed the task */
  executorDevice: string;
  /** Error message if failed */
  error?: string;
}

// ─── Distributed GPU Compute ───

export interface DistributedGPUTask {
  /** Original task ID */
  taskId: string;
  /** Shader code (same for all chunks) */
  shaderCode: string;
  /** How data was split */
  splitStrategy: 'row' | 'column' | 'block';
  /** Total chunks */
  totalChunks: number;
  /** Chunk index for this sub-task */
  chunkIndex: number;
  /** Chunk data */
  chunkData: Float32Array;
  /** Original data shape [rows, cols] */
  originalShape: [number, number];
  /** Workgroups for this chunk */
  workgroups: [number, number, number];
}

// ─── Mesh GPU Configuration ───

export interface MeshGPUConfig {
  /** Max concurrent GPU tasks per device. Default: 4 */
  maxConcurrentTasks: number;
  /** GPU task timeout in ms. Default: 30000 */
  taskTimeoutMs: number;
  /** Minimum VRAM available to accept tasks (bytes). Default: 64MB */
  minVramForAcceptance: number;
  /** Maximum utilization to accept new tasks (0.0-1.0). Default: 0.9 */
  maxUtilizationForAcceptance: number;
}

export const DEFAULT_MESH_GPU_CONFIG: MeshGPUConfig = {
  maxConcurrentTasks: 4,
  taskTimeoutMs: 30000,
  minVramForAcceptance: 67108864,  // 64MB
  maxUtilizationForAcceptance: 0.9,
};

// ─── Mesh GPU Status ───

export interface MeshGPUStatus {
  /** Local GPU capability */
  localGPU: GPUCapability;
  /** Remote GPU-capable peers */
  remoteGPUs: Array<{
    deviceId: string;
    capability: GPUCapability;
    latencyMs: number;
  }>;
  /** Total GPU compute available in mesh (estimated TFLOPS) */
  meshComputeEstimate: number;
  /** Pending tasks */
  pendingTasks: number;
  /** Completed tasks */
  completedTasks: number;
  /** Failed tasks */
  failedTasks: number;
}
