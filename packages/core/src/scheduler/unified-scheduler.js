"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnifiedScheduler = void 0;
const logger_1 = require("../utils/logger");
const task_1 = require("../types/task");
const execution_planner_1 = require("./execution-planner");
const device_scorer_1 = require("./device-scorer");
const log = new logger_1.Logger('Scheduler');
const DEFAULT_CONFIG = {
    minDeviceScore: 0.1,
    maxCandidates: 10,
    verbose: false,
};
// ─── Unified Scheduler ───
class UnifiedScheduler {
    planner;
    scorer;
    loadMonitor;
    computeFn;
    peerProvider;
    config;
    // Stats tracking
    stats = {
        totalTasks: 0,
        tasksByStrategy: {},
        totalPlanTimeMs: 0,
        totalExecutionTimeMs: 0,
        localFallbackCount: 0,
        totalConfidence: 0,
    };
    constructor(computeFn, peerProvider, loadMonitor, config = {}) {
        this.planner = new execution_planner_1.ExecutionPlanner();
        this.scorer = new device_scorer_1.DeviceScorer();
        this.loadMonitor = loadMonitor;
        this.computeFn = computeFn;
        this.peerProvider = peerProvider;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Main entry point — compute a task on the mesh.
     * Analyzes, plans, scores devices, dispatches.
     */
    async compute(wasmModule, inputData, options = {}) {
        const startMs = Date.now();
        const taskType = options.taskType ?? task_1.TaskType.MAP_REDUCE;
        // ── Step 1: Analyze Task ──
        const analysis = this.planner.analyzeTask(wasmModule, inputData, taskType);
        // ── Step 2: Get Mesh State ──
        const meshState = this.peerProvider.getMeshState();
        // ── Step 3: Create Execution Plan ──
        let plan;
        if (options.forceStrategy) {
            plan = this.forcedPlan(options.forceStrategy, analysis, meshState);
        }
        else {
            plan = this.planner.plan(analysis, meshState, taskType);
        }
        const planTimeMs = Date.now() - startMs;
        // ── Step 4: Score Devices ──
        const taskHint = {
            taskType,
            payloadSizeKb: analysis.payloadSizeKb,
            requiresGPU: options.requiresGPU ?? plan.requiresGPU,
            latencySensitive: options.latencySensitive ?? false,
            dataLocationDeviceIds: options.dataLocationDeviceIds,
        };
        let deviceScores = [];
        if (plan.strategy !== execution_planner_1.ExecutionStrategy.LOCAL_ONLY) {
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
            if (deviceScores.length === 0 && plan.strategy !== execution_planner_1.ExecutionStrategy.LOCAL_ONLY) {
                log.info('No viable remote devices — falling back to local');
                plan = {
                    ...plan,
                    strategy: execution_planner_1.ExecutionStrategy.LOCAL_ONLY,
                    reason: 'No viable remote devices (all overloaded or below score threshold)',
                    deviceCount: 1,
                    fallback: execution_planner_1.ExecutionStrategy.LOCAL_ONLY,
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
        let result;
        try {
            result = await this.dispatch(wasmModule, inputData, plan, options);
        }
        catch (err) {
            // Try fallback strategy
            if (plan.fallback !== plan.strategy) {
                log.warn(`Strategy ${plan.strategy} failed: ${err.message}. Trying fallback: ${plan.fallback}`);
                const fallbackPlan = { ...plan, strategy: plan.fallback };
                result = await this.dispatch(wasmModule, inputData, fallbackPlan, options);
            }
            else {
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
        log.info(`Task complete: ${plan.strategy}, ${result.totalTimeMs}ms, ` +
            `${result.devicesUsed} devices, ${result.chunksExecuted} chunks`);
        return result;
    }
    /**
     * Get scheduler statistics.
     */
    getStats() {
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
    getPlanner() {
        return this.planner;
    }
    /**
     * Get the scorer instance (for direct scoring).
     */
    getScorer() {
        return this.scorer;
    }
    // ══════════════════════════════════════
    // Dispatch
    // ══════════════════════════════════════
    async dispatch(wasmModule, inputData, plan, options) {
        switch (plan.strategy) {
            case execution_planner_1.ExecutionStrategy.WASM_DISTRIBUTE:
                return this.dispatchWasm(wasmModule, inputData, plan, options);
            case execution_planner_1.ExecutionStrategy.CORTEX_SPLIT:
                // Cortex not yet integrated — fall through to WASM
                log.info('Cortex path not yet integrated — using WASM distribution');
                return this.dispatchWasm(wasmModule, inputData, plan, options);
            case execution_planner_1.ExecutionStrategy.GPU_COMPUTE:
                // GPU path not yet integrated — fall through to WASM
                log.info('GPU path not yet integrated — using WASM distribution');
                return this.dispatchWasm(wasmModule, inputData, plan, options);
            case execution_planner_1.ExecutionStrategy.AUTO_DECOMPOSE:
                // Phase 4 — not yet implemented
                log.info('Auto-decomposition not yet implemented — using WASM distribution');
                return this.dispatchWasm(wasmModule, inputData, plan, options);
            case execution_planner_1.ExecutionStrategy.SPECULATIVE_RACE:
                // Phase 5 — not yet implemented, fall back to WASM
                log.info('Speculative racing not yet implemented — using WASM distribution');
                return this.dispatchWasm(wasmModule, inputData, plan, options);
            case execution_planner_1.ExecutionStrategy.LOCAL_ONLY:
            default:
                return this.dispatchWasm(wasmModule, inputData, plan, options);
        }
    }
    /**
     * Dispatch via the existing WASM distribution pipeline.
     */
    async dispatchWasm(wasmModule, inputData, plan, options) {
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
    forcedPlan(strategy, analysis, meshState) {
        return {
            strategy,
            reason: `Forced strategy: ${strategy}`,
            deviceCount: Math.min(meshState.peerCount + 1, 4),
            shouldChunk: strategy === execution_planner_1.ExecutionStrategy.WASM_DISTRIBUTE,
            chunkCount: strategy === execution_planner_1.ExecutionStrategy.WASM_DISTRIBUTE ? Math.min(meshState.peerCount + 1, 4) : 0,
            requiresGPU: strategy === execution_planner_1.ExecutionStrategy.GPU_COMPUTE,
            estimatedTimeMs: -1,
            confidence: 1.0,
            fallback: execution_planner_1.ExecutionStrategy.LOCAL_ONLY,
        };
    }
    recordStats(plan, execTimeMs, localFallback) {
        this.stats.totalTasks++;
        this.stats.tasksByStrategy[plan.strategy] =
            (this.stats.tasksByStrategy[plan.strategy] || 0) + 1;
        this.stats.totalExecutionTimeMs += execTimeMs;
        this.stats.totalConfidence += plan.confidence;
        if (localFallback)
            this.stats.localFallbackCount++;
    }
}
exports.UnifiedScheduler = UnifiedScheduler;
//# sourceMappingURL=unified-scheduler.js.map