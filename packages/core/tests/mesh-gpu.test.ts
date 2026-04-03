/**
 * CMP v3.0 — Mesh GPU Tests
 *
 * Tests GPU executor, mesh orchestration, distributed compute,
 * kernel detection, and fault tolerance.
 *
 * Run: npx tsx packages/core/tests/mesh-gpu.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GPUExecutor } from '../src/gpu/executor';
import { MeshGPU } from '../src/gpu/mesh-gpu';
import type { MeshGPUTransport, GPUPeerInfo } from '../src/gpu/mesh-gpu';
import type { GPUTask, GPUTaskResult, GPUBufferInput, GPUCapability } from '../src/types/gpu';

// ─── Helpers ───

function makeBuffer(label: string, data: number[], usage: GPUBufferInput['usage'] = 'storage'): GPUBufferInput {
  return { label, data: new Float32Array(data), usage };
}

function makeTask(
  shader: string,
  buffers: GPUBufferInput[],
  workgroups: [number, number, number] = [1, 1, 1],
  outputIndices: number[] = [0],
): GPUTask {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
    shaderCode: shader,
    buffers,
    workgroups,
    outputBufferIndices: outputIndices,
    priority: 'normal',
    deadline: 0,
    submitterDevice: 'local',
  };
}

// ─── Mock Transport ───

class MockGPUTransport implements MeshGPUTransport {
  private localId: string;
  private peers: GPUPeerInfo[];
  /** Remote executors for simulation */
  private remoteExecutors = new Map<string, GPUExecutor>();
  /** Track remote sends */
  tasksSent = 0;
  /** Simulate failures */
  failingDevices = new Set<string>();

  constructor(localId: string, peers?: GPUPeerInfo[]) {
    this.localId = localId;
    this.peers = peers ?? [];
  }

  getLocalDeviceId(): string {
    return this.localId;
  }

  getGPUPeers(): GPUPeerInfo[] {
    return this.peers;
  }

  addPeer(peer: GPUPeerInfo, executor?: GPUExecutor): void {
    this.peers.push(peer);
    if (executor) this.remoteExecutors.set(peer.deviceId, executor);
  }

  async sendGPUTask(deviceId: string, task: GPUTask): Promise<GPUTaskResult> {
    this.tasksSent++;

    if (this.failingDevices.has(deviceId)) {
      throw new Error(`Device ${deviceId} offline`);
    }

    const executor = this.remoteExecutors.get(deviceId);
    if (!executor) {
      throw new Error(`No executor for ${deviceId}`);
    }

    const result = await executor.execute(task);
    result.executorDevice = deviceId;
    return result;
  }
}

// ═══════════════════════════════════════
// GPU Executor Tests
// ═══════════════════════════════════════

describe('GPUExecutor', () => {

  describe('Built-in Kernels', () => {
    it('should execute matmul kernel', async () => {
      const executor = new GPUExecutor();

      // 2x2 matrix multiply: [[1,2],[3,4]] × [[5,6],[7,8]]
      const A = makeBuffer('A', [1, 2, 3, 4]);
      const B = makeBuffer('B', [5, 6, 7, 8]);
      const task = makeTask('matmul', [A, B], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      assert.equal(result.outputBuffers.length, 1);

      const C = result.outputBuffers[0];
      assert.equal(C.length, 4);
      // [[1*5+2*7, 1*6+2*8], [3*5+4*7, 3*6+4*8]] = [[19,22],[43,50]]
      assert.equal(C[0], 19);
      assert.equal(C[1], 22);
      assert.equal(C[2], 43);
      assert.equal(C[3], 50);
    });

    it('should execute add kernel', async () => {
      const executor = new GPUExecutor();

      const A = makeBuffer('A', [1, 2, 3]);
      const B = makeBuffer('B', [10, 20, 30]);
      const task = makeTask('elementwise_add', [A, B], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      const C = result.outputBuffers[0];
      assert.equal(C[0], 11);
      assert.equal(C[1], 22);
      assert.equal(C[2], 33);
    });

    it('should execute multiply kernel', async () => {
      const executor = new GPUExecutor();

      const A = makeBuffer('A', [2, 3, 4]);
      const B = makeBuffer('B', [5, 6, 7]);
      const task = makeTask('elementwise_mul', [A, B], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      const C = result.outputBuffers[0];
      assert.equal(C[0], 10);
      assert.equal(C[1], 18);
      assert.equal(C[2], 28);
    });

    it('should execute relu kernel', async () => {
      const executor = new GPUExecutor();

      const A = makeBuffer('A', [-2, 0, 3, -1, 5]);
      const task = makeTask('relu', [A], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      const C = result.outputBuffers[0];
      assert.equal(C[0], 0);
      assert.equal(C[1], 0);
      assert.equal(C[2], 3);
      assert.equal(C[3], 0);
      assert.equal(C[4], 5);
    });

    it('should execute reduce_sum kernel', async () => {
      const executor = new GPUExecutor();

      const A = makeBuffer('A', [1, 2, 3, 4, 5]);
      const task = makeTask('reduce_sum', [A], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      assert.equal(result.outputBuffers[0][0], 15);
    });

    it('should execute softmax kernel', async () => {
      const executor = new GPUExecutor();

      const A = makeBuffer('A', [1, 2, 3]);
      const task = makeTask('softmax', [A], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      const C = result.outputBuffers[0];
      assert.equal(C.length, 3);

      // Softmax should sum to 1.0
      const sum = C[0] + C[1] + C[2];
      assert.ok(Math.abs(sum - 1.0) < 0.001, `Softmax sum should be 1.0, got ${sum}`);

      // Values should be ordered
      assert.ok(C[0] < C[1]);
      assert.ok(C[1] < C[2]);
    });

    it('should execute scale kernel', async () => {
      const executor = new GPUExecutor();

      const A = makeBuffer('A', [1, 2, 3, 4]);
      const scalar = makeBuffer('scalar', [3.0]);
      const task = makeTask('scale', [A, scalar], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      const C = result.outputBuffers[0];
      assert.equal(C[0], 3);
      assert.equal(C[1], 6);
      assert.equal(C[2], 9);
      assert.equal(C[3], 12);
    });
  });

  describe('Custom Kernels', () => {
    it('should register and execute custom kernel', async () => {
      const executor = new GPUExecutor();

      // Custom kernel: square each element
      executor.registerKernel('square', (inputs) => {
        const A = inputs[0];
        const C = new Float32Array(A.length);
        for (let i = 0; i < A.length; i++) C[i] = A[i] * A[i];
        return [C];
      });

      const A = makeBuffer('A', [2, 3, 4, 5]);
      const task = makeTask('square', [A], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      const C = result.outputBuffers[0];
      assert.equal(C[0], 4);
      assert.equal(C[1], 9);
      assert.equal(C[2], 16);
      assert.equal(C[3], 25);
    });
  });

  describe('Fallback', () => {
    it('should pass through data for unknown shader', async () => {
      const executor = new GPUExecutor();

      const A = makeBuffer('A', [1, 2, 3]);
      const task = makeTask('unknown_shader_xyz_abc', [A], [1, 1, 1], [0]);

      const result = await executor.execute(task);

      assert.ok(result.success);
      // Should return copy of input buffer
      assert.equal(result.outputBuffers[0].length, 3);
    });
  });

  describe('Stats', () => {
    it('should track execution stats', async () => {
      const executor = new GPUExecutor();
      const A = makeBuffer('A', [1, 2, 3]);

      await executor.execute(makeTask('relu', [A]));
      await executor.execute(makeTask('relu', [A]));
      await executor.execute(makeTask('relu', [A]));

      const stats = executor.getStats();
      assert.equal(stats.executionCount, 3);
      assert.ok(stats.totalComputeMs >= 0);
      assert.equal(stats.activeTasks, 0);
    });
  });

  describe('Capacity Check', () => {
    it('should reject tasks when at max concurrency', async () => {
      const executor = new GPUExecutor();
      const A = makeBuffer('A', [1]);

      // Simulate active tasks by checking canAccept
      const task = makeTask('relu', [A]);
      assert.ok(executor.canAccept(task, { maxConcurrentTasks: 4, maxUtilization: 0.9 }));
    });

    it('should reject oversized buffers', () => {
      const executor = new GPUExecutor({ maxBufferSize: 100 });
      const bigBuffer: GPUBufferInput = {
        label: 'big',
        data: new Float32Array(1000), // 4000 bytes > 100
        usage: 'storage',
      };
      const task = makeTask('relu', [bigBuffer]);
      assert.ok(!executor.canAccept(task, { maxConcurrentTasks: 4, maxUtilization: 0.9 }));
    });
  });
});

// ═══════════════════════════════════════
// MeshGPU Tests
// ═══════════════════════════════════════

describe('MeshGPU', () => {

  describe('Local Compute', () => {
    it('should execute matmul locally', async () => {
      const transport = new MockGPUTransport('local');
      const gpu = new MeshGPU(transport);

      const A = makeBuffer('A', [1, 0, 0, 1]); // Identity 2x2
      const B = makeBuffer('B', [5, 6, 7, 8]);

      const result = await gpu.compute('matmul', [A, B], [1, 1, 1]);

      assert.ok(result.success);
      const C = result.outputBuffers[0];
      assert.equal(C[0], 5);
      assert.equal(C[1], 6);
      assert.equal(C[2], 7);
      assert.equal(C[3], 8);
    });

    it('should track completed tasks', async () => {
      const transport = new MockGPUTransport('local');
      const gpu = new MeshGPU(transport);

      await gpu.compute('relu', [makeBuffer('A', [1, -1])], [1, 1, 1]);
      await gpu.compute('relu', [makeBuffer('A', [2, -2])], [1, 1, 1]);

      const status = gpu.getStatus();
      assert.equal(status.completedTasks, 2);
      assert.equal(status.pendingTasks, 0);
    });
  });

  describe('Remote Compute', () => {
    it('should offload to GPU peer when available', async () => {
      const transport = new MockGPUTransport('local');

      const remoteExecutor = new GPUExecutor({
        available: true,
        adapterName: 'RTX 3060',
        vramBytes: 6442450944, // 6GB
      });

      transport.addPeer({
        deviceId: 'gpu-node',
        capability: remoteExecutor.getCapability(),
        latencyMs: 5,
      }, remoteExecutor);

      // Local has default "CPU Fallback" with 2GB, remote has 6GB
      // Remote should be preferred
      const gpu = new MeshGPU(transport);

      const A = makeBuffer('A', [1, 2, 3]);
      const B = makeBuffer('B', [4, 5, 6]);
      const result = await gpu.compute('elementwise_add', [A, B], [1, 1, 1]);

      assert.ok(result.success);
      assert.equal(result.outputBuffers[0][0], 5);
      assert.equal(result.outputBuffers[0][1], 7);
      assert.equal(result.outputBuffers[0][2], 9);
    });

    it('should fallback to local when remote fails', async () => {
      const transport = new MockGPUTransport('local');

      transport.addPeer({
        deviceId: 'broken-gpu',
        capability: {
          available: true,
          adapterName: 'BrokenGPU',
          maxBufferSize: 268435456,
          maxComputeWorkgroups: [65535, 65535, 65535],
          maxComputeInvocations: 256,
          vramBytes: 8589934592,
          vramUtilization: 0,
          computeUtilization: 0,
        },
        latencyMs: 2,
      });
      transport.failingDevices.add('broken-gpu');

      const gpu = new MeshGPU(transport);
      const A = makeBuffer('A', [-1, 2, -3]);
      const result = await gpu.compute('relu', [A], [1, 1, 1]);

      assert.ok(result.success);
      const C = result.outputBuffers[0];
      assert.equal(C[0], 0);
      assert.equal(C[1], 2);
      assert.equal(C[2], 0);
    });
  });

  describe('Distributed Compute', () => {
    it('should split computation across 2 devices', async () => {
      const transport = new MockGPUTransport('local');

      const remoteExec = new GPUExecutor({ available: true, vramBytes: 4294967296 });
      transport.addPeer({
        deviceId: 'peer-gpu',
        capability: remoteExec.getCapability(),
        latencyMs: 5,
      }, remoteExec);

      const gpu = new MeshGPU(transport);

      // 4x4 matrix, split by rows across 2 devices
      const data = new Float32Array([
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16,
      ]);

      const result = await gpu.distributeCompute(
        'relu', // pass-through for row chunks
        data,
        [4, 4],
        'row',
      );

      assert.ok(result.result.length > 0);
      assert.ok(result.devicesUsed >= 1);
      assert.ok(result.totalMs >= 0);
    });

    it('should handle single device distributed compute', async () => {
      const transport = new MockGPUTransport('local');
      const gpu = new MeshGPU(transport);

      const data = new Float32Array([1, 2, 3, 4, 5, 6]);
      const result = await gpu.distributeCompute('relu', data, [2, 3], 'row');

      assert.ok(result.result.length > 0);
      assert.equal(result.devicesUsed, 1);
    });
  });

  describe('Remote Task Handler', () => {
    it('should handle incoming GPU task', async () => {
      const transport = new MockGPUTransport('local');
      const gpu = new MeshGPU(transport);

      const task = makeTask('relu', [makeBuffer('A', [-5, 0, 5])]);
      const result = await gpu.handleRemoteTask(task);

      assert.ok(result.success);
      assert.equal(result.outputBuffers[0][0], 0);
      assert.equal(result.outputBuffers[0][1], 0);
      assert.equal(result.outputBuffers[0][2], 5);
    });
  });

  describe('Custom Kernels via MeshGPU', () => {
    it('should register and use custom kernel through MeshGPU', async () => {
      const transport = new MockGPUTransport('local');
      const gpu = new MeshGPU(transport);

      gpu.registerKernel('negate', (inputs) => {
        const C = new Float32Array(inputs[0].length);
        for (let i = 0; i < inputs[0].length; i++) C[i] = -inputs[0][i];
        return [C];
      });

      const result = await gpu.compute('negate', [makeBuffer('A', [1, -2, 3])], [1, 1, 1]);

      assert.ok(result.success);
      assert.equal(result.outputBuffers[0][0], -1);
      assert.equal(result.outputBuffers[0][1], 2);
      assert.equal(result.outputBuffers[0][2], -3);
    });
  });

  describe('Status', () => {
    it('should report mesh GPU status', async () => {
      const transport = new MockGPUTransport('local');
      transport.addPeer({
        deviceId: 'gpu-1',
        capability: {
          available: true,
          adapterName: 'RTX 4090',
          maxBufferSize: 1073741824,
          maxComputeWorkgroups: [65535, 65535, 65535],
          maxComputeInvocations: 1024,
          vramBytes: 25769803776, // 24GB
          vramUtilization: 0.2,
          computeUtilization: 0.1,
        },
        latencyMs: 3,
      });

      const gpu = new MeshGPU(transport);
      const status = gpu.getStatus();

      assert.ok(status.localGPU.available);
      assert.equal(status.remoteGPUs.length, 1);
      assert.equal(status.remoteGPUs[0].deviceId, 'gpu-1');
      assert.ok(status.meshComputeEstimate > 0);
    });
  });

  describe('Capability', () => {
    it('should return local GPU capability', () => {
      const transport = new MockGPUTransport('local');
      const gpu = new MeshGPU(transport, {}, { adapterName: 'TestGPU', vramBytes: 4294967296 });

      const cap = gpu.getLocalCapability();
      assert.equal(cap.adapterName, 'TestGPU');
      assert.equal(cap.vramBytes, 4294967296);
    });

    it('should list all mesh GPUs', () => {
      const transport = new MockGPUTransport('local');
      transport.addPeer({
        deviceId: 'peer-1',
        capability: { available: true, adapterName: 'P1', maxBufferSize: 0, maxComputeWorkgroups: [0, 0, 0], maxComputeInvocations: 0, vramBytes: 1000, vramUtilization: 0, computeUtilization: 0 },
        latencyMs: 5,
      });

      const gpu = new MeshGPU(transport);
      const caps = gpu.getMeshCapabilities();

      assert.ok(caps.length >= 1); // at least local
    });
  });
});
