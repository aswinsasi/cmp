/**
 * CMP v4.0 — Stage Executor
 *
 * Executes a single pipeline stage on a device.
 * Receives items from upstream, processes them through the stage
 * function, and forwards results to downstream.
 *
 * Tracks per-stage metrics: throughput, latency, buffer size.
 *
 * @module pipes/stage-executor
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import type { StageDefinition, StageInstance, StageFn, StageMetrics } from './pipeline-types';
import { getBuiltinStage } from './stages/builtin-stages';
import { BackpressureController } from './backpressure';

const log = new Logger('StageExec');

// ─── Stage Executor ───

export class StageExecutor {
  private stages = new Map<number, StageRuntime>();

  /**
   * Initialize a stage for execution.
   */
  initStage(
    definition: StageDefinition,
    deviceId: string,
    backpressure: BackpressureController,
    downstream: ((stageIndex: number, items: Uint8Array[]) => void) | null,
    bufferCapacity: number = 100,
  ): StageInstance {
    // Resolve the stage function
    let fn: StageFn;

    if (definition.type === 'builtin') {
      const builtin = getBuiltinStage(definition.name);
      if (!builtin) {
        throw new Error(`Unknown built-in stage: ${definition.name}`);
      }
      fn = builtin;
    } else {
      // WASM stage — wrap the handler string as a passthrough for now
      // (Real WASM execution would be wired via the WASM sandbox)
      fn = (item) => [item]; // Passthrough placeholder
    }

    const instance: StageInstance = {
      definition,
      deviceId,
      state: 'idle',
      itemsProcessed: 0,
      bufferSize: 0,
      bufferCapacity,
      backpressureActive: false,
      throughput: 0,
      avgLatencyMs: 0,
      startedAt: null,
    };

    const runtime: StageRuntime = {
      instance,
      fn,
      config: { ...definition.config },
      downstream,
      backpressure,
      totalLatencyMs: 0,
      throughputWindow: [],
    };

    backpressure.initStage(definition.index, bufferCapacity);
    this.stages.set(definition.index, runtime);

    return instance;
  }

  /**
   * Start a stage.
   */
  startStage(stageIndex: number): void {
    const runtime = this.stages.get(stageIndex);
    if (!runtime) return;
    runtime.instance.state = 'running';
    runtime.instance.startedAt = Date.now();
  }

  /**
   * Stop a stage.
   */
  stopStage(stageIndex: number): void {
    const runtime = this.stages.get(stageIndex);
    if (!runtime) return;
    runtime.instance.state = 'stopped';
  }

  /**
   * Process an item through a stage.
   * Returns the output items (may be 0, 1, or many).
   */
  processItem(stageIndex: number, item: Uint8Array): Uint8Array[] {
    const runtime = this.stages.get(stageIndex);
    if (!runtime || runtime.instance.state !== 'running') return [];

    // Check backpressure
    const canProcess = runtime.backpressure.onItemEnter(stageIndex);
    runtime.instance.backpressureActive = !canProcess;

    if (!canProcess) {
      // Buffer the item but don't process yet
      runtime.instance.bufferSize++;
      return [];
    }

    // Process
    const startMs = performance.now();
    let outputs: Uint8Array[];

    try {
      outputs = runtime.fn(item, runtime.config);
    } catch (err: any) {
      log.warn(`Stage ${stageIndex} (${runtime.instance.definition.name}) error: ${err.message}`);
      outputs = [];
    }

    const latencyMs = performance.now() - startMs;

    // Update metrics
    runtime.instance.itemsProcessed++;
    runtime.totalLatencyMs += latencyMs;
    runtime.instance.avgLatencyMs = runtime.totalLatencyMs / runtime.instance.itemsProcessed;

    // Track throughput (items in last 1 second)
    const now = Date.now();
    runtime.throughputWindow.push(now);
    runtime.throughputWindow = runtime.throughputWindow.filter(t => now - t < 1000);
    runtime.instance.throughput = runtime.throughputWindow.length;

    // Signal backpressure exit
    runtime.backpressure.onItemExit(stageIndex);

    // Forward to downstream
    if (outputs.length > 0 && runtime.downstream) {
      runtime.downstream(stageIndex, outputs);
    }

    return outputs;
  }

  /**
   * Get a stage instance.
   */
  getStage(stageIndex: number): StageInstance | null {
    return this.stages.get(stageIndex)?.instance ?? null;
  }

  /**
   * Get metrics for a stage.
   */
  getMetrics(stageIndex: number): StageMetrics | null {
    const runtime = this.stages.get(stageIndex);
    if (!runtime) return null;

    const inst = runtime.instance;
    return {
      index: inst.definition.index,
      name: inst.definition.name,
      deviceId: inst.deviceId,
      itemsProcessed: inst.itemsProcessed,
      bufferSize: inst.bufferSize,
      throughput: inst.throughput,
      avgLatencyMs: Math.round(inst.avgLatencyMs * 100) / 100,
      backpressureActive: inst.backpressureActive,
    };
  }

  /**
   * Get the stage config (for flushing stateful stages).
   */
  getStageConfig(stageIndex: number): Record<string, any> | null {
    return this.stages.get(stageIndex)?.config ?? null;
  }

  /**
   * Reset all stages.
   */
  reset(): void {
    this.stages.clear();
  }
}

// ─── Internal Runtime State ───

interface StageRuntime {
  instance: StageInstance;
  fn: StageFn;
  config: Record<string, any>;
  downstream: ((stageIndex: number, items: Uint8Array[]) => void) | null;
  backpressure: BackpressureController;
  totalLatencyMs: number;
  throughputWindow: number[];
}
