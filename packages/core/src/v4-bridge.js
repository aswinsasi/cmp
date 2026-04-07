"use strict";
/**
 * CMP v4.0 — V4 Bridge
 *
 * Integration layer that wires all 8 v4 pillars into a single
 * cohesive compute path. This is the "brain" of v4.0.
 *
 * Compute flow:
 *   1. AccessController + RateLimiter gate the request
 *   2. TaskCompiler analyzes the code → detects pattern
 *   3. GravityPlanner checks data locality → code-to-data?
 *   4. UnifiedScheduler picks strategy + scores devices
 *   5. RaceManager decides whether to race
 *   6. Execute (via node.compute, gravity code-ship, or race)
 *   7. TaskCompiler merges chunk results
 *   8. Result returned (or stored in JobQueue if background)
 *
 * Integration points:
 *   - CMPNode.compute() is the execution backend
 *   - LoadMonitor feeds device scores + race decisions
 *   - DataCatalog feeds gravity planner
 *   - MeshFS uses DataCatalog for gravity-aware reads
 *   - V3StateStore persists everything across restarts
 *   - PipelineManager is independently accessible for streaming
 *
 * @module v4-bridge
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.V4Bridge = exports.DEFAULT_V4_CONFIG = void 0;
const logger_1 = require("./utils/logger");
const task_1 = require("./types/task");
// Phase 2: Job Queue
const job_queue_1 = require("./scheduler/job-queue");
const job_executor_1 = require("./scheduler/job-executor");
const job_announcer_1 = require("./scheduler/job-announcer");
// Phase 3: Unified Scheduler
const unified_scheduler_1 = require("./scheduler/unified-scheduler");
const load_monitor_1 = require("./scheduler/load-monitor");
const execution_planner_1 = require("./scheduler/execution-planner");
// Phase 4: Task Compiler
const task_compiler_1 = require("./compiler/task-compiler");
// Phase 5: Speculative Racing
const race_manager_1 = require("./scheduler/race-manager");
// Phase 6: Computation Gravity
const data_catalog_1 = require("./gravity/data-catalog");
const code_shipper_1 = require("./gravity/code-shipper");
const gravity_planner_1 = require("./gravity/gravity-planner");
// Phase 7: CMP Pipes
const pipeline_manager_1 = require("./pipes/pipeline-manager");
// Phase 8: Security
const v3_encryption_1 = require("./security/v3-encryption");
const access_control_1 = require("./security/access-control");
const rate_limiter_1 = require("./security/rate-limiter");
const meshfs_1 = require("./meshfs/meshfs");
const log = new logger_1.Logger('V4Bridge');
exports.DEFAULT_V4_CONFIG = {
    enableCompiler: true,
    enableGravity: true,
    enableRacing: true,
    enableACL: true,
    enableRateLimit: true,
    compilerMinInputBytes: 1024,
};
// ─── V4 Bridge ───
class V4Bridge {
    // ── Core ──
    localDeviceId;
    config;
    rawCompute;
    peerProvider;
    // ── Modules ──
    stateStore;
    jobQueue;
    jobExecutor;
    jobAnnouncer;
    scheduler;
    loadMonitor;
    compiler;
    raceManager;
    dataCatalog;
    codeShipper;
    gravityPlanner;
    pipelineManager;
    encryptor;
    accessControl;
    rateLimiter;
    meshFS;
    // ── State ──
    started = false;
    // ── Stats ──
    stats = {
        totalComputes: 0,
        compiledComputes: 0,
        gravityComputes: 0,
        racedComputes: 0,
        aclDenied: 0,
        rateLimited: 0,
        totalTimeMs: 0,
    };
    constructor(localDeviceId, rawCompute, peerProvider, deviceStateReader, encryptFn, decryptFn, stateStore = null, config = {}) {
        this.localDeviceId = localDeviceId;
        this.rawCompute = rawCompute;
        this.peerProvider = peerProvider;
        this.config = { ...exports.DEFAULT_V4_CONFIG, ...config };
        this.stateStore = stateStore;
        // ── Phase 1: Persistence ──
        // State store passed in from outside (already initialized)
        // ── Phase 2: Job Queue ──
        this.jobQueue = new job_queue_1.JobQueue(stateStore);
        this.jobExecutor = new job_executor_1.JobExecutor(this.jobQueue, (wasm, input, opts) => this.executeRaw(wasm, input, opts), { deviceId: localDeviceId, pollIntervalMs: 1000, maxConcurrent: 4 });
        this.jobAnnouncer = new job_announcer_1.JobAnnouncer(this.jobQueue, { deviceId: localDeviceId });
        // ── Phase 3: Unified Scheduler ──
        this.loadMonitor = new load_monitor_1.LoadMonitor(localDeviceId, deviceStateReader);
        this.scheduler = new unified_scheduler_1.UnifiedScheduler((wasm, input, opts) => this.executeRaw(wasm, input, opts), peerProvider, this.loadMonitor);
        // ── Phase 4: Task Compiler ──
        this.compiler = new task_compiler_1.TaskCompiler();
        // ── Phase 5: Speculative Racing ──
        this.raceManager = new race_manager_1.RaceManager();
        // ── Phase 6: Computation Gravity ──
        this.dataCatalog = new data_catalog_1.DataCatalog(localDeviceId);
        this.codeShipper = new code_shipper_1.CodeShipper(localDeviceId);
        this.gravityPlanner = new gravity_planner_1.GravityPlanner(this.dataCatalog);
        // ── Phase 7: CMP Pipes ──
        this.pipelineManager = new pipeline_manager_1.PipelineManager(localDeviceId);
        // ── Phase 8: Security ──
        this.encryptor = new v3_encryption_1.V3MessageEncryptor(encryptFn, decryptFn);
        this.accessControl = new access_control_1.AccessController();
        this.rateLimiter = new rate_limiter_1.RateLimiter();
        this.meshFS = new meshfs_1.MeshFS(localDeviceId);
        log.info('V4 Bridge created: all 8 pillars initialized');
    }
    // ══════════════════════════════════════
    // Lifecycle
    // ══════════════════════════════════════
    /**
     * Start the V4 Bridge — activates all background services.
     */
    start() {
        if (this.started)
            return;
        // Initialize job queue (loads persisted jobs)
        this.jobQueue.init();
        // Start background services
        this.jobExecutor.start();
        this.loadMonitor.start();
        this.rateLimiter.start();
        this.dataCatalog.start();
        this.started = true;
        log.info('V4 Bridge started: all services active');
    }
    /**
     * Stop the V4 Bridge — cleanly shuts down all services.
     */
    stop() {
        if (!this.started)
            return;
        this.jobExecutor.stop();
        this.loadMonitor.stop();
        this.rateLimiter.stop();
        this.dataCatalog.stop();
        this.started = false;
        log.info('V4 Bridge stopped');
    }
    // ══════════════════════════════════════
    // Main Compute Path (the integrated flow)
    // ══════════════════════════════════════
    /**
     * Submit a computation through the full v4 pipeline.
     *
     * Flow: ACL → Rate Limit → Compile → Gravity → Schedule → Race? → Execute → Merge
     */
    async compute(wasmModule, inputData, options = {}) {
        const startMs = Date.now();
        this.stats.totalComputes++;
        // ── Step 1: Security Gate ──
        if (this.config.enableACL) {
            const aclResult = this.accessControl.check(this.localDeviceId);
            if (!aclResult.allowed) {
                this.stats.aclDenied++;
                throw new Error(`Access denied: ${aclResult.reason}`);
            }
        }
        if (this.config.enableRateLimit) {
            const rateResult = this.rateLimiter.check(this.localDeviceId);
            if (!rateResult.allowed) {
                this.stats.rateLimited++;
                throw new Error(`Rate limited: ${rateResult.reason}`);
            }
        }
        // ── Step 2: Background Job? ──
        if (options.background) {
            return this.submitBackgroundJob(wasmModule, inputData, options);
        }
        // ── Step 3: Gravity Check ──
        let gravityDecision = null;
        if (this.config.enableGravity && !options.skipGravity && options.dataKey) {
            gravityDecision = this.gravityPlanner.plan(options.dataKey, wasmModule.length, Math.ceil(inputData.length * 0.1), // Estimate result ~10% of input
            this.localDeviceId);
            if (gravityDecision.strategy === gravity_planner_1.GravityStrategy.PULL) {
                this.stats.gravityComputes++;
                return this.executeViaGravity(wasmModule, inputData, options, gravityDecision, startMs);
            }
        }
        // ── Step 4: Task Compiler ──
        let compileResult = null;
        if (this.config.enableCompiler && inputData.length >= this.config.compilerMinInputBytes) {
            const peerIds = this.getPeerDeviceIds();
            // Also include peers from the peer provider
            const providerPeers = this.peerProvider.getPeerCapabilities();
            const allPeerIds = [...new Set([...peerIds, ...providerPeers.map(p => p.deviceId)])];
            const meta = {
                wasmExports: this.compiler.parseExports(wasmModule),
                inputSizeBytes: inputData.length,
                availableDevices: allPeerIds.length + 1,
                deviceIds: [this.localDeviceId, ...allPeerIds],
                entryPoint: options.entryPoint ?? 'process',
            };
            compileResult = this.compiler.compile(wasmModule, inputData, meta);
            this.stats.compiledComputes++;
        }
        // ── Step 5: Racing Decision ──
        let shouldRace = false;
        if (this.config.enableRacing && !options.skipRacing) {
            const racingState = {
                availableDevices: this.getPeerDeviceIds().length + 1,
                avgUtilization: this.getAverageUtilization(),
                loadVariance: this.getMaxLoadVariance(),
                estimatedDurationMs: options.deadline ?? -1,
            };
            const raceDecision = this.raceManager.shouldRace(racingState);
            shouldRace = raceDecision.shouldRace;
        }
        // ── Step 6: Execute ──
        let result;
        if (shouldRace && this.getPeerDeviceIds().length >= 1) {
            result = await this.executeWithRacing(wasmModule, inputData, options, startMs);
        }
        else if (compileResult && compileResult.plan.chunkCount > 1) {
            result = await this.executeWithCompiler(wasmModule, inputData, options, compileResult, startMs);
        }
        else {
            result = await this.executeViaScheduler(wasmModule, inputData, options, startMs);
        }
        // Attach gravity info
        result.gravityApplied = gravityDecision?.strategy === gravity_planner_1.GravityStrategy.PULL || gravityDecision?.strategy === gravity_planner_1.GravityStrategy.SCATTER;
        result.gravitySavings = gravityDecision?.savingsRatio ?? 0;
        this.stats.totalTimeMs += result.totalTimeMs;
        log.info(`V4 compute: ${result.strategy}, pattern=${result.pattern ?? 'none'}, ` +
            `${result.totalTimeMs}ms, ${result.devicesUsed} dev, ` +
            `gravity=${result.gravityApplied}, raced=${result.raced}`);
        return result;
    }
    // ══════════════════════════════════════
    // Execution Paths
    // ══════════════════════════════════════
    /**
     * Execute via the Unified Scheduler (default path).
     */
    async executeViaScheduler(wasmModule, inputData, options, startMs) {
        const schedResult = await this.scheduler.compute(wasmModule, inputData, {
            entryPoint: options.entryPoint,
            deadline: options.deadline,
            taskType: options.taskType,
            priority: options.priority,
            chunkHint: options.chunkHint,
            forceStrategy: options.forceStrategy,
        });
        return {
            data: schedResult.data,
            totalTimeMs: schedResult.totalTimeMs,
            chunksExecuted: schedResult.chunksExecuted,
            devicesUsed: schedResult.devicesUsed,
            verified: schedResult.verified,
            localFallback: schedResult.localFallback,
            strategy: schedResult.strategy,
            pattern: null,
            gravityApplied: false,
            gravitySavings: 0,
            raced: false,
            racerCount: 0,
        };
    }
    /**
     * Execute via Task Compiler (auto-parallelized).
     */
    async executeWithCompiler(wasmModule, inputData, options, compileResult, startMs) {
        const plan = compileResult.plan;
        // Execute each chunk via the raw compute function
        const chunkResults = [];
        for (const chunk of plan.chunks) {
            const result = await this.rawCompute(wasmModule, chunk.data, {
                entryPoint: options.entryPoint,
                deadline: options.deadline,
                taskType: options.taskType,
            });
            chunkResults.push(result.data);
        }
        // Merge results using the compiler's merge strategy
        const merged = this.compiler.mergeResults(plan, chunkResults);
        return {
            data: merged.data,
            totalTimeMs: Date.now() - startMs,
            chunksExecuted: plan.chunkCount,
            devicesUsed: plan.deviceAssignments.size,
            verified: true,
            localFallback: plan.deviceAssignments.size <= 1,
            strategy: execution_planner_1.ExecutionStrategy.WASM_DISTRIBUTE,
            pattern: plan.pattern,
            gravityApplied: false,
            gravitySavings: 0,
            raced: false,
            racerCount: 0,
        };
    }
    /**
     * Execute via Gravity (ship code to data).
     */
    async executeViaGravity(wasmModule, inputData, options, decision, startMs) {
        const targetDevice = decision.targetDevices[0];
        try {
            const result = await this.codeShipper.shipCode(targetDevice, options.dataKey, wasmModule, options.entryPoint ?? 'process', inputData, options.deadline ?? 30000);
            return {
                data: result.data ?? new Uint8Array(0),
                totalTimeMs: Date.now() - startMs,
                chunksExecuted: 1,
                devicesUsed: 1,
                verified: result.success,
                localFallback: false,
                strategy: execution_planner_1.ExecutionStrategy.WASM_DISTRIBUTE,
                pattern: null,
                gravityApplied: true,
                gravitySavings: decision.savingsRatio,
                raced: false,
                racerCount: 0,
            };
        }
        catch (err) {
            // Gravity failed — fall back to scheduler
            log.warn(`Gravity execution failed: ${err.message} — falling back to scheduler`);
            return this.executeViaScheduler(wasmModule, inputData, options, startMs);
        }
    }
    /**
     * Execute with speculative racing.
     */
    async executeWithRacing(wasmModule, inputData, options, startMs) {
        const peerIds = this.getPeerDeviceIds().slice(0, 2); // Max 2 peers + local = 3 racers
        const allDevices = [this.localDeviceId, ...peerIds];
        const racers = allDevices.map(deviceId => ({
            deviceId,
            taskId: `race-${deviceId}-${Date.now()}`,
            startedAt: Date.now(),
            promise: this.rawCompute(wasmModule, inputData, {
                entryPoint: options.entryPoint,
                deadline: options.deadline,
                taskType: options.taskType,
            }).then(r => ({
                deviceId,
                taskId: `race-${deviceId}`,
                success: true,
                data: r.data,
                totalTimeMs: r.totalTimeMs,
                error: null,
            })).catch(err => ({
                deviceId,
                taskId: `race-${deviceId}`,
                success: false,
                data: null,
                totalTimeMs: Date.now() - startMs,
                error: err.message,
            })),
        }));
        try {
            const { winner, record } = await this.raceManager.race(racers);
            this.stats.racedComputes++;
            return {
                data: winner.data ?? new Uint8Array(0),
                totalTimeMs: winner.totalTimeMs,
                chunksExecuted: 1,
                devicesUsed: 1,
                verified: true,
                localFallback: winner.deviceId === this.localDeviceId,
                strategy: execution_planner_1.ExecutionStrategy.SPECULATIVE_RACE,
                pattern: null,
                gravityApplied: false,
                gravitySavings: 0,
                raced: true,
                racerCount: racers.length,
            };
        }
        catch (err) {
            // All racers failed — fall back to scheduler
            log.warn(`Racing failed: ${err.message} — falling back to scheduler`);
            return this.executeViaScheduler(wasmModule, inputData, options, startMs);
        }
    }
    /**
     * Submit as a background job.
     */
    async submitBackgroundJob(wasmModule, inputData, options) {
        const definition = {
            wasmModule,
            inputData,
            entryPoint: options.entryPoint ?? 'process',
            taskType: options.taskType ?? task_1.TaskType.MAP_REDUCE,
            deadlineMs: options.deadline ?? 30000,
            chunkHint: options.chunkHint ?? 0,
        };
        const job = this.jobQueue.submit(definition, {
            priority: options.priority,
            background: true,
        });
        return {
            data: new TextEncoder().encode(JSON.stringify({ jobId: job.id, state: job.state })),
            totalTimeMs: 0,
            chunksExecuted: 0,
            devicesUsed: 0,
            verified: false,
            localFallback: false,
            strategy: execution_planner_1.ExecutionStrategy.LOCAL_ONLY,
            pattern: null,
            gravityApplied: false,
            gravitySavings: 0,
            raced: false,
            racerCount: 0,
        };
    }
    // ══════════════════════════════════════
    // Raw Execute (bypasses v4 pipeline)
    // ══════════════════════════════════════
    async executeRaw(wasmModule, inputData, opts) {
        const result = await this.rawCompute(wasmModule, inputData, opts);
        return {
            ...result,
            strategy: execution_planner_1.ExecutionStrategy.WASM_DISTRIBUTE,
            plan: {},
        };
    }
    // ══════════════════════════════════════
    // Helpers
    // ══════════════════════════════════════
    getPeerDeviceIds() {
        return this.loadMonitor.getAllLoads()
            .filter(l => l.deviceId !== this.localDeviceId)
            .map(l => l.deviceId);
    }
    getAverageUtilization() {
        const loads = this.loadMonitor.getAllLoads();
        if (loads.length === 0)
            return 0.5;
        return loads.reduce((s, l) => s + l.cpuPercent, 0) / loads.length / 100;
    }
    getMaxLoadVariance() {
        const loads = this.loadMonitor.getAllLoads();
        let maxVar = 0;
        for (const l of loads) {
            const v = this.loadMonitor.getLoadVariance(l.deviceId);
            if (v > maxVar)
                maxVar = v;
        }
        return maxVar;
    }
    // ══════════════════════════════════════
    // Stats
    // ══════════════════════════════════════
    getStats() {
        return {
            ...this.stats,
            avgTimeMs: this.stats.totalComputes > 0 ? Math.round(this.stats.totalTimeMs / this.stats.totalComputes) : 0,
            scheduler: this.scheduler.getStats(),
            compiler: this.compiler.getStats(),
            gravity: this.gravityPlanner.getStats(),
            racing: this.raceManager.getStats(),
            jobs: this.jobQueue.getStats(),
            rateLimiter: this.rateLimiter.getStats(),
            meshFS: this.meshFS.getStats(),
        };
    }
    isStarted() {
        return this.started;
    }
    /**
     * Connect a V4WireHandler so all modules can send/receive
     * real wire messages through the mesh transport.
     */
    connectWireHandler(handler) {
        handler.registerModules({
            loadMonitor: this.loadMonitor,
            jobAnnouncer: this.jobAnnouncer,
            cancelTracker: this.raceManager.getCancelTracker(),
            dataCatalog: this.dataCatalog,
            codeShipper: this.codeShipper,
            pipelineManager: this.pipelineManager,
        });
        // Wire the code shipper's execute handler to use the WASM sandbox
        this.codeShipper.setExecuteHandler(async (req) => {
            const startMs = Date.now();
            try {
                // Read local data for the requested key
                const localData = this.meshFS.read(req.dataKey);
                const input = localData ?? req.params;
                const result = await this.rawCompute(req.wasmModule, input, {
                    entryPoint: req.entryPoint,
                    deadline: req.deadlineMs,
                });
                return {
                    requestId: req.requestId,
                    executorId: this.localDeviceId,
                    success: true,
                    data: result.data,
                    executionTimeMs: Date.now() - startMs,
                    dataReadBytes: input.length,
                    error: null,
                };
            }
            catch (err) {
                return {
                    requestId: req.requestId,
                    executorId: this.localDeviceId,
                    success: false,
                    data: null,
                    executionTimeMs: Date.now() - startMs,
                    dataReadBytes: 0,
                    error: err.message,
                };
            }
        });
        log.info('V4 wire handler connected — all modules can send/receive over mesh transport');
    }
}
exports.V4Bridge = V4Bridge;
//# sourceMappingURL=v4-bridge.js.map