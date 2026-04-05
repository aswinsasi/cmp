/**
 * CMP v4.0 — Pipeline Manager
 *
 * Creates and manages streaming pipelines across the mesh.
 * This is the main entry point for CMP Pipes.
 *
 * Usage:
 *   const mgr = new PipelineManager('local', ['peer1', 'peer2']);
 *   mgr.define('myPipe', ['filter', 'map', 'collect']);
 *   mgr.start('myPipe');
 *   mgr.push('myPipe', data);    // Push items in
 *   mgr.push('myPipe', data2);
 *   const result = mgr.stop('myPipe');  // Get collected output
 *
 * @module pipes/pipeline-manager
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import {
  PipelineState, PipelineInstance, PipelineDefinition,
  PipelineMetrics, PipelineConfig, DEFAULT_PIPELINE_CONFIG,
  StageDefinition, PipelineEvent,
} from './pipeline-types';
import { StageExecutor } from './stage-executor';
import { StageRouter, StageAssignment } from './stage-router';
import { BackpressureController } from './backpressure';
import { isBuiltinStage, flushCollect, flushBatch } from './stages/builtin-stages';

const log = new Logger('PipeMgr');

// ─── Pipeline Manager ───

export class PipelineManager {
  private pipelines = new Map<string, ManagedPipeline>();
  private localDeviceId: string;
  private availableDevices: string[];
  private config: PipelineConfig;
  private router: StageRouter;
  private listeners = new Set<(event: PipelineEvent) => void>();

  constructor(
    localDeviceId: string,
    availableDevices: string[] = [],
    config: Partial<PipelineConfig> = {},
  ) {
    this.localDeviceId = localDeviceId;
    this.availableDevices = [localDeviceId, ...availableDevices];
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.router = new StageRouter(localDeviceId);
  }

  // ══════════════════════════════════════
  // Define
  // ══════════════════════════════════════

  /**
   * Define a new pipeline from stage names.
   *
   * @param name - Pipeline name
   * @param stageSpecs - Stage specifications: "name" or "name:param=value"
   */
  define(name: string, stageSpecs: string[]): PipelineInstance {
    if (this.pipelines.has(name)) {
      throw new Error(`Pipeline "${name}" already exists`);
    }

    if (this.pipelines.size >= this.config.maxPipelines) {
      throw new Error(`Maximum pipelines (${this.config.maxPipelines}) reached`);
    }

    // Parse stage specs
    const stages: StageDefinition[] = stageSpecs.map((spec, index) => {
      const { name: stageName, config: stageConfig } = this.parseStageSpec(spec);
      return {
        name: stageName,
        type: isBuiltinStage(stageName) ? 'builtin' : 'wasm',
        handler: stageName,
        config: stageConfig,
        index,
      };
    });

    const instance: PipelineInstance = {
      name,
      state: PipelineState.DEFINED,
      stages: [],
      definedAt: Date.now(),
      startedAt: null,
      stoppedAt: null,
      totalItemsPushed: 0,
      totalItemsEmitted: 0,
      error: null,
    };

    const executor = new StageExecutor();
    const backpressure = new BackpressureController(this.config);

    // Route stages to devices
    const assignments = this.router.assignStages(stages, this.availableDevices);

    // Initialize stage instances
    for (const stage of stages) {
      const assignment = assignments.find(a => a.stageIndex === stage.index)!;

      const stageInstance = executor.initStage(
        stage,
        assignment.deviceId,
        backpressure,
        // Downstream callback: forward to next stage
        stage.index < stages.length - 1
          ? (fromIndex, items) => {
              for (const item of items) {
                executor.processItem(fromIndex + 1, item);
              }
            }
          : // Last stage: count emitted items
            (fromIndex, items) => {
              const mp = this.pipelines.get(name);
              if (mp) mp.instance.totalItemsEmitted += items.length;
            },
        this.config.defaultBufferCapacity,
      );

      instance.stages.push(stageInstance);
    }

    // Set up rebalance callback
    backpressure.onRebalanceNeeded((stageIndex) => {
      this.handleRebalance(name, stageIndex);
    });

    const managed: ManagedPipeline = {
      instance,
      definition: { name, stages },
      executor,
      backpressure,
      assignments,
      metricsTimer: null,
    };

    this.pipelines.set(name, managed);

    log.info(`Pipeline "${name}" defined: ${stages.length} stages`);
    return instance;
  }

  // ══════════════════════════════════════
  // Start / Stop
  // ══════════════════════════════════════

  /**
   * Start a pipeline.
   */
  start(name: string): boolean {
    const mp = this.pipelines.get(name);
    if (!mp) return false;
    if (mp.instance.state === PipelineState.RUNNING) return true;

    mp.instance.state = PipelineState.RUNNING;
    mp.instance.startedAt = Date.now();

    // Start all stages
    for (const stage of mp.definition.stages) {
      mp.executor.startStage(stage.index);
    }

    // Start backpressure monitoring
    mp.backpressure.startMonitoring();

    this.emitEvent('started', name);
    log.info(`Pipeline "${name}" started: ${mp.assignments.map(a => `${a.stageName}→${a.deviceId}`).join(' | ')}`);

    return true;
  }

  /**
   * Stop a pipeline. Returns collected output (if last stage is 'collect').
   */
  stop(name: string): Uint8Array | null {
    const mp = this.pipelines.get(name);
    if (!mp) return null;

    mp.instance.state = PipelineState.STOPPING;

    // Flush stateful stages in order BEFORE stopping (stages must be 'running' to process)
    for (const stage of mp.definition.stages) {
      const stageConfig = mp.executor.getStageConfig(stage.index);
      if (!stageConfig) continue;

      if (stage.name === 'batch') {
        const flushed = flushBatch(stageConfig);
        if (flushed && stage.index < mp.definition.stages.length - 1) {
          mp.executor.processItem(stage.index + 1, flushed);
        }
      }
    }

    // Collect final output from last stage
    let result: Uint8Array | null = null;
    const lastStage = mp.definition.stages[mp.definition.stages.length - 1];
    if (lastStage) {
      const lastConfig = mp.executor.getStageConfig(lastStage.index);
      if (lastConfig && lastStage.name === 'collect') {
        result = flushCollect(lastConfig);
      }
    }

    // Now stop all stages
    mp.instance.state = PipelineState.STOPPED;
    mp.instance.stoppedAt = Date.now();

    for (const stage of mp.definition.stages) {
      mp.executor.stopStage(stage.index);
    }

    mp.backpressure.stopMonitoring();

    const uptime = mp.instance.startedAt ? Date.now() - mp.instance.startedAt : 0;
    this.emitEvent('stopped', name, `${mp.instance.totalItemsPushed} items in ${(uptime / 1000).toFixed(1)}s`);
    log.info(`Pipeline "${name}" stopped: ${mp.instance.totalItemsPushed} pushed, ${mp.instance.totalItemsEmitted} emitted`);

    return result;
  }

  // ══════════════════════════════════════
  // Push Data
  // ══════════════════════════════════════

  /**
   * Push an item into the pipeline (enters first stage).
   */
  push(name: string, data: Uint8Array): boolean {
    const mp = this.pipelines.get(name);
    if (!mp || mp.instance.state !== PipelineState.RUNNING) return false;

    mp.instance.totalItemsPushed++;
    mp.executor.processItem(0, data);
    return true;
  }

  /**
   * Push multiple items.
   */
  pushMany(name: string, items: Uint8Array[]): number {
    let count = 0;
    for (const item of items) {
      if (this.push(name, item)) count++;
    }
    return count;
  }

  // ══════════════════════════════════════
  // Query
  // ══════════════════════════════════════

  /**
   * Get pipeline metrics.
   */
  getMetrics(name: string): PipelineMetrics | null {
    const mp = this.pipelines.get(name);
    if (!mp) return null;

    const stageMetrics = mp.definition.stages.map(s =>
      mp.executor.getMetrics(s.index)!,
    ).filter(Boolean);

    const bottleneck = mp.backpressure.findBottleneck();

    return {
      name,
      state: mp.instance.state,
      uptime: mp.instance.startedAt ? Date.now() - mp.instance.startedAt : 0,
      totalItemsPushed: mp.instance.totalItemsPushed,
      totalItemsEmitted: mp.instance.totalItemsEmitted,
      stages: stageMetrics,
      bottleneckStage: bottleneck,
    };
  }

  /**
   * Get a pipeline instance.
   */
  get(name: string): PipelineInstance | null {
    return this.pipelines.get(name)?.instance ?? null;
  }

  /**
   * List all pipeline names and states.
   */
  list(): Array<{ name: string; state: PipelineState; stageCount: number }> {
    return Array.from(this.pipelines.values()).map(mp => ({
      name: mp.instance.name,
      state: mp.instance.state,
      stageCount: mp.definition.stages.length,
    }));
  }

  /**
   * Delete a pipeline (must be stopped first).
   */
  remove(name: string): boolean {
    const mp = this.pipelines.get(name);
    if (!mp) return false;
    if (mp.instance.state === PipelineState.RUNNING) {
      this.stop(name);
    }
    mp.backpressure.reset();
    mp.executor.reset();
    this.pipelines.delete(name);
    return true;
  }

  // ══════════════════════════════════════
  // Events
  // ══════════════════════════════════════

  onEvent(listener: (event: PipelineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ══════════════════════════════════════
  // Internals
  // ══════════════════════════════════════

  private parseStageSpec(spec: string): { name: string; config: Record<string, any> } {
    // Parse "name:key=value,key2=value2" or just "name"
    const colonIdx = spec.indexOf(':');
    if (colonIdx < 0) {
      return { name: spec.trim(), config: {} };
    }

    const name = spec.substring(0, colonIdx).trim();
    const configStr = spec.substring(colonIdx + 1).trim();
    const config: Record<string, any> = {};

    for (const pair of configStr.split(',')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx >= 0) {
        const key = pair.substring(0, eqIdx).trim();
        const val = pair.substring(eqIdx + 1).trim();
        // Try to parse as number
        const num = Number(val);
        config[key] = isNaN(num) ? val : num;
      }
    }

    // Also store as 'handler' for stages that use it
    if (configStr && !config.predicate && !config.transform) {
      config.handler = configStr;
    }

    return { name, config };
  }

  private handleRebalance(pipelineName: string, stageIndex: number): void {
    const mp = this.pipelines.get(pipelineName);
    if (!mp) return;

    const assignment = mp.assignments.find(a => a.stageIndex === stageIndex);
    if (!assignment) return;

    const newDevice = this.router.reassignStage(
      stageIndex,
      assignment.deviceId,
      this.availableDevices,
    );

    if (newDevice) {
      log.info(`Rebalancing stage ${stageIndex} of "${pipelineName}": ${assignment.deviceId} → ${newDevice}`);
      assignment.deviceId = newDevice;
      const stageInst = mp.executor.getStage(stageIndex);
      if (stageInst) stageInst.deviceId = newDevice;

      this.emitEvent('rebalance', pipelineName, stageIndex, `${assignment.deviceId} → ${newDevice}`);
    }
  }

  private emitEvent(type: PipelineEvent['type'], pipelineName: string, stageIndex?: number | string, details?: string): void {
    const event: PipelineEvent = {
      type,
      pipelineName,
      stageIndex: typeof stageIndex === 'number' ? stageIndex : undefined,
      timestamp: Date.now(),
      details: typeof stageIndex === 'string' ? stageIndex : details,
    };

    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
  }
}

// ─── Internal ───

interface ManagedPipeline {
  instance: PipelineInstance;
  definition: PipelineDefinition;
  executor: StageExecutor;
  backpressure: BackpressureController;
  assignments: StageAssignment[];
  metricsTimer: ReturnType<typeof setInterval> | null;
}
