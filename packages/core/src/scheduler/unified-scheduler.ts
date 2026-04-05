/**
 * CMP v4.0 — Unified Scheduler
 *
 * Single entry point for ALL computation on the mesh.
 * Replaces the direct CMPNode.compute() path with intelligent
 * routing that considers task type, device capabilities, load,
 * and data locality.
 *
 * Flow:
 *   1. User calls scheduler.compute(wasm, input, opts)
 *   2. ExecutionPlanner analyzes the task → ExecutionPlan
 *   3. DeviceScorer ranks available devices
 *   4. LoadMonitor filters overloaded devices
 *   5. Scheduler dispatches to the right execution path:
 *      - WASM_DISTRIBUTE → node.compute() (existing L3-L6)
 *      - CORTEX_SPLIT → cortex inference (L14, future)
 *      - GPU_COMPUTE → GPU offload (L16, future)
 *      - LOCAL_ONLY → local WASM sandbox
 *      - SPECULATIVE_RACE → race on N devices (Phase 5, future)
 *   6. Result returned to caller
 *
 * The scheduler also integrates with:
 *   - JobQueue (Phase 2) for background/async jobs
 *   - V3StateStore (Phase 1) for persisting scheduler decisions
 *
 * @module scheduler/unified-scheduler
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { TaskType, Priority } from '../types/task';
import type { CMPCapability } from '../types/capability';
import { ExecutionPlanner, ExecutionStrategy, ExecutionPlan, MeshState, TaskAnalysis } from './execution-planner';
import { DeviceScorer, ScoredDevice, TaskHint } from './device-scorer';
import { LoadMonitor, LoadReport } from './load-monitor';

const log = new Logger('Scheduler');

// ─── Compute Function Types ───

/**
 * Function to execute WASM on the mesh (wraps CMPNode.compute).
 */
export type MeshComputeFn = (
  wasmModule: Uint8Array,
  inputData: Uint8Array,
  options: {
    entryPoint?: string;
    deadline?: number;
    chunkHint?: number;
    taskType?: number;
    priority?: number;
  },
) => Promise<SchedulerResult>;

/**
 * Result from the scheduler.
 */
export interface SchedulerResult {
  data: Uint8Array;
  totalTimeMs: number;
  chunksExecuted: number;
  devicesUsed: number;
  verified: boolean;
  localFallback: boolean;
  /** Which strategy was actually used */
  strategy: ExecutionStrategy;
  /** The full execution plan that was generated */
  plan: ExecutionPlan;
  /** Device scores (if multiple devices were considered) */
  deviceScores?: ScoredDevice[];
}

// ─── Compute Options ───

export interface SchedulerComputeOptions {
  entryPoint?: string;
  deadline?: number;
  chunkHint?: number;
  taskType?: TaskType;
  priority?: Priority;
  /** Force a specific strategy (bypass planner) */
  forceStrategy?: ExecutionStrategy;
  /** Data locality hints (device IDs where data lives) */
  dataLocationDeviceIds?: string[];
  /** Whether GPU is required */
  requiresGPU?: boolean;
  /** Whether this is latency-sensitive */
  latencySensitive?: boolean;
}

// ─── Scheduler Config ───

export interface UnifiedSchedulerConfig {
  /** Minimum score for a device to be considered (0-1) */
  minDeviceScore: number;
  /** Maximum devices to consider for scoring */
  maxCandidates: number;
  /** Whether to log detailed planning decisions */
  verbose: boolean;
}

const DEFAULT_CONFIG: UnifiedSchedulerConfig = {
  minDeviceScore: 0.1,
  maxCandidates: 10,
  verbose: false,
};

// ─── Scheduler Stats ───

export interface SchedulerStats {
  totalTasks: number;
  tasksByStrategy: Record<string, number>;
  avgPlanTimeMs: number;
  avgExecutionTimeMs: number;
  localFallbackCount: number;
  plannerConfidenceAvg: number;
}

// ─── Peer Provider ───

/**
 * Interface for getting peer capabilities.
 * Abstracted so the scheduler doesn't depend directly on CMPNode.
 */
export interface PeerProvider {
  /** Get all peer capabilities */
  getPeerCapabilities(): Array<{ deviceId: string; capability: CMPCapability }>;
  /** Get mesh state summary */
  getMeshState(): MeshState;
}

// ─── Unified Scheduler ───

export class UnifiedScheduler {
  private planner: ExecutionPlanner;
  private scorer: DeviceScorer;
  private loadMonitor: LoadMonitor;
  private computeFn: MeshComputeFn;
  private peerProvider: PeerProvider;
  private config: UnifiedSchedulerConfig;

  // Stats tracking
  private stats = {
    totalTasks: 0,
    tasksByStrategy: {} as Record<string, number>,
    totalPlanTimeMs: 0,
    totalExecutionTimeMs: 0,
    localFallbackCount: 0,
    totalConfidence: 0,
  };

  constructor(
    computeFn: MeshComputeFn,
    peerProvider: PeerProvider,
    loadMonitor: LoadMonitor,
    config: Partial<UnifiedSchedulerConfig> = {},
  ) {
    this.planner = new ExecutionPlanner();
    this.scorer = new DeviceScorer();
    this.loadMonitor = loadMonitor;
    this.computeFn = computeFn;
    this.peerProvider = peerProvider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main entry point — compute a task on the mesh.
   * Analyzes, plans, scores devices, dispatches.
   */
  async compute(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: SchedulerComputeOptions = {},
  ): Promise<SchedulerResult> {
    const startMs = Date.now();
    const taskType = options.taskType ?? TaskType.MAP_REDUCE;

    // ── Step 1: Analyze Task ──
    const analysis = this.planner.analyzeTask(wasmModule, inputData, taskType);

    // ── Step 2: Get Mesh State ──
    const meshState = this.peerProvider.getMeshState();

    // ── Step 3: Create Execution Plan ──
    let plan: ExecutionPlan;
    if (options.forceStrategy) {
      plan = this.forcedPlan(options.forceStrategy, analysis, meshState);
    } else {
      plan = this.planner.plan(analysis, meshState, taskType);
    }

    const planTimeMs = Date.now() - startMs;

    // ── Step 4: Score Devices ──
    const taskHint: TaskHint = {
      taskType,
      payloadSizeKb: analysis.payloadSizeKb,
      requiresGPU: options.requiresGPU ?? plan.requiresGPU,
      latencySensitive: options.latencySensitive ?? false,
      dataLocationDeviceIds: options.dataLocationDeviceIds,
    };

    let deviceScores: ScoredDevice[] = [];

    if (plan.strategy !== ExecutionStrategy.LOCAL_ONLY) {
      const peers = this.peerProvider.getPeerCapabilities();
      const candidates = peers
        .map(p => ({
          deviceId: p.deviceId,
          capability: p.capability,
          load: this.loadMonitor.getLoad(p.deviceId),
        }))
        .filter(c => !this.loadMonitor.isOverloaded(c.deviceId));

      deviceScores = this.scorer.rankDevices(candidates, taskHint);

      // Filter by minimum score
      deviceScores = deviceScores.filter(d => d.score >= this.config.minDeviceScore);

      // If no viable devices, fall back to local
      if (deviceScores.length === 0 && plan.strategy !== ExecutionStrategy.LOCAL_ONLY) {
        log.info('No viable remote devices — falling back to local');
        plan = {
          ...plan,
          strategy: ExecutionStrategy.LOCAL_ONLY,
          reason: 'No viable remote devices (all overloaded or below score threshold)',
          deviceCount: 1,
          fallback: ExecutionStrategy.LOCAL_ONLY,
        };
      }
    }

    if (this.config.verbose) {
      log.info(`Plan: ${plan.strategy} (${plan.reason})`);
      log.info(`Plan time: ${planTimeMs}ms, candidates: ${deviceScores.length}`);
      if (deviceScores.length > 0) {
        log.info(`Best device: ${deviceScores[0].deviceId} (score: ${deviceScores[0].score})`);
      }
    }

    // ── Step 5: Dispatch ──
    const execStartMs = Date.now();
    let result: SchedulerResult;

    try {
      result = await this.dispatch(wasmModule, inputData, plan, options);
    } catch (err: any) {
      // Try fallback strategy
      if (plan.fallback !== plan.strategy) {
        log.warn(`Strategy ${plan.strategy} failed: ${err.message}. Trying fallback: ${plan.fallback}`);
        const fallbackPlan = { ...plan, strategy: plan.fallback };
        result = await this.dispatch(wasmModule, inputData, fallbackPlan, options);
      } else {
        throw err;
      }
    }

    // ── Step 6: Record Stats ──
    const execTimeMs = Date.now() - execStartMs;
    this.recordStats(plan, execTimeMs, result.localFallback);

    // Attach plan and scores to result
    result.strategy = plan.strategy;
    result.plan = plan;
    result.deviceScores = deviceScores;

    log.info(
      `Task complete: ${plan.strategy}, ${result.totalTimeMs}ms, ` +
      `${result.devicesUsed} devices, ${result.chunksExecuted} chunks`,
    );

    return result;
  }

  /**
   * Get scheduler statistics.
   */
  getStats(): SchedulerStats {
    const avgPlan = this.stats.totalTasks > 0
      ? this.stats.totalPlanTimeMs / this.stats.totalTasks : 0;
    const avgExec = this.stats.totalTasks > 0
      ? this.stats.totalExecutionTimeMs / this.stats.totalTasks : 0;
    const avgConf = this.stats.totalTasks > 0
      ? this.stats.totalConfidence / this.stats.totalTasks : 0;

    return {
      totalTasks: this.stats.totalTasks,
      tasksByStrategy: { ...this.stats.tasksByStrategy },
      avgPlanTimeMs: Math.round(avgPlan),
      avgExecutionTimeMs: Math.round(avgExec),
      localFallbackCount: this.stats.localFallbackCount,
      plannerConfidenceAvg: Math.round(avgConf * 100) / 100,
    };
  }

  /**
   * Get the planner instance (for direct analysis).
   */
  getPlanner(): ExecutionPlanner {
    return this.planner;
  }

  /**
   * Get the scorer instance (for direct scoring).
   */
  getScorer(): DeviceScorer {
    return this.scorer;
  }

  // ══════════════════════════════════════
  // Dispatch
  // ══════════════════════════════════════

  private async dispatch(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    plan: ExecutionPlan,
    options: SchedulerComputeOptions,
  ): Promise<SchedulerResult> {
    switch (plan.strategy) {
      case ExecutionStrategy.WASM_DISTRIBUTE:
        return this.dispatchWasm(wasmModule, inputData, plan, options);

      case ExecutionStrategy.CORTEX_SPLIT:
        // Cortex not yet integrated — fall through to WASM
        log.info('Cortex path not yet integrated — using WASM distribution');
        return this.dispatchWasm(wasmModule, inputData, plan, options);

      case ExecutionStrategy.GPU_COMPUTE:
        // GPU path not yet integrated — fall through to WASM
        log.info('GPU path not yet integrated — using WASM distribution');
        return this.dispatchWasm(wasmModule, inputData, plan, options);

      case ExecutionStrategy.AUTO_DECOMPOSE:
        // Phase 4 — not yet implemented
        log.info('Auto-decomposition not yet implemented — using WASM distribution');
        return this.dispatchWasm(wasmModule, inputData, plan, options);

      case ExecutionStrategy.SPECULATIVE_RACE:
        // Phase 5 — not yet implemented, fall back to WASM
        log.info('Speculative racing not yet implemented — using WASM distribution');
        return this.dispatchWasm(wasmModule, inputData, plan, options);

      case ExecutionStrategy.LOCAL_ONLY:
      default:
        return this.dispatchWasm(wasmModule, inputData, plan, options);
    }
  }

  /**
   * Dispatch via the existing WASM distribution pipeline.
   */
  private async dispatchWasm(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    plan: ExecutionPlan,
    options: SchedulerComputeOptions,
  ): Promise<SchedulerResult> {
    const rawResult = await this.computeFn(wasmModule, inputData, {
      entryPoint: options.entryPoint,
      deadline: options.deadline,
      chunkHint: plan.shouldChunk ? plan.chunkCount : (options.chunkHint ?? 0),
      taskType: options.taskType,
      priority: options.priority,
    });

    return {
      ...rawResult,
      strategy: plan.strategy,
      plan,
    };
  }

  // ══════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════

  private forcedPlan(
    strategy: ExecutionStrategy,
    analysis: TaskAnalysis,
    meshState: MeshState,
  ): ExecutionPlan {
    return {
      strategy,
      reason: `Forced strategy: ${strategy}`,
      deviceCount: Math.min(meshState.peerCount + 1, 4),
      shouldChunk: strategy === ExecutionStrategy.WASM_DISTRIBUTE,
      chunkCount: strategy === ExecutionStrategy.WASM_DISTRIBUTE ? Math.min(meshState.peerCount + 1, 4) : 0,
      requiresGPU: strategy === ExecutionStrategy.GPU_COMPUTE,
      estimatedTimeMs: -1,
      confidence: 1.0,
      fallback: ExecutionStrategy.LOCAL_ONLY,
    };
  }

  private recordStats(plan: ExecutionPlan, execTimeMs: number, localFallback: boolean): void {
    this.stats.totalTasks++;
    this.stats.tasksByStrategy[plan.strategy] =
      (this.stats.tasksByStrategy[plan.strategy] || 0) + 1;
    this.stats.totalExecutionTimeMs += execTimeMs;
    this.stats.totalConfidence += plan.confidence;
    if (localFallback) this.stats.localFallbackCount++;
  }
}
