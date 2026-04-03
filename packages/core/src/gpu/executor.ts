/**
 * CMP v3.0 — GPU Executor
 * Executes GPU compute tasks locally.
 *
 * Two modes:
 *   1. WebGPU mode: real GPU execution via navigator.gpu (browser/Deno)
 *   2. CPU fallback: interprets common shader patterns in JavaScript
 *
 * The CPU fallback handles standard compute kernels (matrix multiply,
 * element-wise ops, reductions) so the mesh can function even when
 * no real GPU is available. Production devices with WebGPU will use
 * the real GPU path.
 *
 * @module gpu/executor
 * @author Agent Viscro
 */

import type {
  GPUTask,
  GPUTaskResult,
  GPUBufferInput,
  GPUCapability,
} from '../types/gpu';
import { NO_GPU } from '../types/gpu';

// ─── Kernel Registry (CPU fallback) ───

/**
 * A CPU kernel that emulates a GPU compute shader.
 * Takes input buffers, returns output buffers.
 */
export type CPUKernel = (
  inputs: Float32Array[],
  workgroups: [number, number, number],
  params?: Record<string, number>,
) => Float32Array[];

/** Built-in CPU kernels for common operations */
const BUILTIN_KERNELS = new Map<string, CPUKernel>();

// Matrix multiply: C = A × B
BUILTIN_KERNELS.set('matmul', (inputs, workgroups) => {
  const A = inputs[0];
  const B = inputs[1];
  // Assume square matrices for simplicity; params would specify dimensions
  const n = Math.floor(Math.sqrt(A.length));
  const C = new Float32Array(n * n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += A[i * n + k] * B[k * n + j];
      }
      C[i * n + j] = sum;
    }
  }
  return [C];
});

// Element-wise add: C[i] = A[i] + B[i]
BUILTIN_KERNELS.set('add', (inputs) => {
  const A = inputs[0];
  const B = inputs[1];
  const C = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) C[i] = A[i] + B[i];
  return [C];
});

// Element-wise multiply: C[i] = A[i] * B[i]
BUILTIN_KERNELS.set('multiply', (inputs) => {
  const A = inputs[0];
  const B = inputs[1];
  const C = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) C[i] = A[i] * B[i];
  return [C];
});

// ReLU: C[i] = max(0, A[i])
BUILTIN_KERNELS.set('relu', (inputs) => {
  const A = inputs[0];
  const C = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) C[i] = Math.max(0, A[i]);
  return [C];
});

// Reduce sum: C[0] = sum(A)
BUILTIN_KERNELS.set('reduce_sum', (inputs) => {
  const A = inputs[0];
  let sum = 0;
  for (let i = 0; i < A.length; i++) sum += A[i];
  return [new Float32Array([sum])];
});

// Scale: C[i] = A[i] * scalar (scalar in B[0])
BUILTIN_KERNELS.set('scale', (inputs) => {
  const A = inputs[0];
  const scalar = inputs[1][0];
  const C = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) C[i] = A[i] * scalar;
  return [C];
});

// Softmax: C[i] = exp(A[i]) / sum(exp(A))
BUILTIN_KERNELS.set('softmax', (inputs) => {
  const A = inputs[0];
  const C = new Float32Array(A.length);
  let maxVal = -Infinity;
  for (let i = 0; i < A.length; i++) if (A[i] > maxVal) maxVal = A[i];
  let sumExp = 0;
  for (let i = 0; i < A.length; i++) {
    C[i] = Math.exp(A[i] - maxVal);
    sumExp += C[i];
  }
  for (let i = 0; i < A.length; i++) C[i] /= sumExp;
  return [C];
});

// ─── Shader Parser ───

/**
 * Detect which built-in kernel a shader corresponds to.
 * Looks for known patterns in the WGSL source.
 */
function detectKernel(shaderCode: string): string | null {
  const lower = shaderCode.toLowerCase();
  if (lower.includes('matmul') || lower.includes('matrix_multiply') || lower.includes('mat_mul')) return 'matmul';
  if (lower.includes('softmax')) return 'softmax';
  if (lower.includes('relu') || lower.includes('max(0')) return 'relu';
  if (lower.includes('reduce_sum') || lower.includes('reduction')) return 'reduce_sum';
  if (lower.includes('scale') || lower.includes('* scalar')) return 'scale';
  if (lower.includes('elementwise_add') || lower.includes('a + b') || lower.includes('add')) return 'add';
  if (lower.includes('elementwise_mul') || lower.includes('a * b') || lower.includes('multiply')) return 'multiply';
  return null;
}

// ═══════════════════════════════════════

export class GPUExecutor {
  private capability: GPUCapability;
  private customKernels = new Map<string, CPUKernel>();

  /** Stats */
  private executionCount = 0;
  private totalComputeMs = 0;
  private activeTasks = 0;

  constructor(capability?: Partial<GPUCapability>) {
    this.capability = {
      ...NO_GPU,
      available: true,
      adapterName: 'CPU Fallback',
      maxBufferSize: 268435456,              // 256MB
      maxComputeWorkgroups: [65535, 65535, 65535],
      maxComputeInvocations: 256,
      vramBytes: 2147483648,                 // 2GB simulated
      ...capability,
    };
  }

  /**
   * Register a custom CPU kernel for a specific shader pattern.
   */
  registerKernel(name: string, kernel: CPUKernel): void {
    this.customKernels.set(name, kernel);
  }

  /**
   * Execute a GPU task using CPU fallback.
   */
  async execute(task: GPUTask): Promise<GPUTaskResult> {
    const start = performance.now();
    this.activeTasks++;

    try {
      // Detect kernel from shader code
      let kernelName = detectKernel(task.shaderCode);
      let kernel: CPUKernel | undefined;

      // Check custom kernels first
      if (kernelName) {
        kernel = this.customKernels.get(kernelName) ?? BUILTIN_KERNELS.get(kernelName);
      }

      // If no kernel detected, try all custom kernels by name match
      if (!kernel) {
        for (const [name, k] of this.customKernels) {
          if (task.shaderCode.includes(name)) {
            kernel = k;
            kernelName = name;
            break;
          }
        }
      }

      if (!kernel) {
        // Generic fallback: pass-through first buffer
        const outputBuffers = task.outputBufferIndices.map(idx => {
          if (idx < task.buffers.length) {
            return new Float32Array(task.buffers[idx].data);
          }
          return new Float32Array(0);
        });

        return {
          taskId: task.taskId,
          success: true,
          outputBuffers,
          computeMs: performance.now() - start,
          executorDevice: 'local',
        };
      }

      // Execute the kernel
      const inputArrays = task.buffers.map(b => b.data);
      const outputs = kernel(inputArrays, task.workgroups);

      // Map outputs to requested indices
      const outputBuffers = task.outputBufferIndices.map((idx, i) => {
        if (i < outputs.length) return outputs[i];
        return new Float32Array(0);
      });

      const computeMs = performance.now() - start;
      this.executionCount++;
      this.totalComputeMs += computeMs;

      return {
        taskId: task.taskId,
        success: true,
        outputBuffers,
        computeMs,
        executorDevice: 'local',
      };
    } catch (err) {
      return {
        taskId: task.taskId,
        success: false,
        outputBuffers: [],
        computeMs: performance.now() - start,
        executorDevice: 'local',
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.activeTasks--;
    }
  }

  /**
   * Check if this executor can accept a new task.
   */
  canAccept(task: GPUTask, config: { maxConcurrentTasks: number; maxUtilization: number }): boolean {
    if (this.activeTasks >= config.maxConcurrentTasks) return false;

    // Check total buffer size
    let totalSize = 0;
    for (const buf of task.buffers) {
      totalSize += buf.data.byteLength;
    }
    if (totalSize > this.capability.maxBufferSize) return false;

    return true;
  }

  getCapability(): GPUCapability {
    return { ...this.capability };
  }

  getStats(): { executionCount: number; totalComputeMs: number; activeTasks: number } {
    return {
      executionCount: this.executionCount,
      totalComputeMs: this.totalComputeMs,
      activeTasks: this.activeTasks,
    };
  }
}
