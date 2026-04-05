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

import { Logger } from './utils/logger';
import { TaskType, Priority } from './types/task';
import { GPUType } from './types/capability';
import type { CMPCapability } from './types/capability';

// Phase 1: Persistence
import { V3StateStore } from './persistence/v3-state-store';
import { StateMigrator } from './persistence/state-migrator';

// Phase 2: Job Queue
import { JobQueue } from './scheduler/job-queue';
import { JobExecutor, ComputeFn } from './scheduler/job-executor';
import { JobAnnouncer } from './scheduler/job-announcer';
import { JobDefinition, JobResult, JobState } from './scheduler/job-types';

// Phase 3: Unified Scheduler
import { UnifiedScheduler, PeerProvider, SchedulerResult, SchedulerComputeOptions } from './scheduler/unified-scheduler';
import { LoadMonitor, DeviceStateReader } from './scheduler/load-monitor';
import { DeviceScorer } from './scheduler/device-scorer';
import { ExecutionPlanner, ExecutionStrategy, MeshState } from './scheduler/execution-planner';

// Phase 4: Task Compiler
import { TaskCompiler, CompileResult } from './compiler/task-compiler';
import { ParallelPattern, TaskMeta } from './compiler/compiler-types';

// Phase 5: Speculative Racing
import { RaceManager, RacingMeshState, Racer, RacerResult } from './scheduler/race-manager';

// Phase 6: Computation Gravity
import { DataCatalog } from './gravity/data-catalog';
import { CodeShipper } from './gravity/code-shipper';
import { GravityPlanner, GravityStrategy, GravityDecision } from './gravity/gravity-planner';

// Phase 7: CMP Pipes
import { PipelineManager } from './pipes/pipeline-manager';

// Phase 8: Security
import { V3MessageEncryptor } from './security/v3-encryption';
import { AccessController, ACLMode } from './security/access-control';
import { RateLimiter } from './security/rate-limiter';
import { MeshFS } from './meshfs/meshfs';

import { V4WireHandler } from './v4-wire-handler';

const log = new Logger('V4Bridge');

// ─── V4 Compute Result ───

export interface V4ComputeResult {
  data: Uint8Array;
  totalTimeMs: number;
  chunksExecuted: number;
  devicesUsed: number;
  verified: boolean;
  localFallback: boolean;
  /** Which execution strategy was used */
  strategy: ExecutionStrategy;
  /** Detected parallelization pattern (if task compiler ran) */
  pattern: ParallelPattern | null;
  /** Whether gravity optimization was applied */
  gravityApplied: boolean;
  /** Gravity savings ratio (0-1) */
  gravitySavings: number;
  /** Whether speculative racing was used */
  raced: boolean;
  /** Number of racers (if raced) */
  racerCount: number;
}

// ─── V4 Compute Options ───

export interface V4ComputeOptions {
  entryPoint?: string;
  deadline?: number;
  taskType?: TaskType;
  priority?: Priority;
  chunkHint?: number;
  /** Data key for gravity optimization */
  dataKey?: string;
  /** Force a specific strategy */
  forceStrategy?: ExecutionStrategy;
  /** Force a specific pattern */
  forcePattern?: ParallelPattern;
  /** Skip gravity check */
  skipGravity?: boolean;
  /** Skip racing */
  skipRacing?: boolean;
  /** Submit as background job */
  background?: boolean;
}

// ─── V4 Bridge Config ───

export interface V4BridgeConfig {
  /** Enable task compiler auto-detection */
  enableCompiler: boolean;
  /** Enable gravity optimization */
  enableGravity: boolean;
  /** Enable speculative racing */
  enableRacing: boolean;
  /** Enable access control */
  enableACL: boolean;
  /** Enable rate limiting */
  enableRateLimit: boolean;
  /** Minimum input size for compiler (bytes) */
  compilerMinInputBytes: number;
}

export const DEFAULT_V4_CONFIG: V4BridgeConfig = {
  enableCompiler: true,
  enableGravity: true,
  enableRacing: true,
  enableACL: true,
  enableRateLimit: true,
  compilerMinInputBytes: 1024,
};

// ─── V4 Bridge ───

export class V4Bridge {
  // ── Core ──
  private localDeviceId: string;
  private config: V4BridgeConfig;
  private rawCompute: ComputeFn;
  private peerProvider: PeerProvider;

  // ── Modules ──
  readonly stateStore: V3StateStore | null;
  readonly jobQueue: JobQueue;
  readonly jobExecutor: JobExecutor;
  readonly jobAnnouncer: JobAnnouncer;
  readonly scheduler: UnifiedScheduler;
  readonly loadMonitor: LoadMonitor;
  readonly compiler: TaskCompiler;
  readonly raceManager: RaceManager;
  readonly dataCatalog: DataCatalog;
  readonly codeShipper: CodeShipper;
  readonly gravityPlanner: GravityPlanner;
  readonly pipelineManager: PipelineManager;
  readonly encryptor: V3MessageEncryptor;
  readonly accessControl: AccessController;
  readonly rateLimiter: RateLimiter;
  readonly meshFS: MeshFS;

  // ── State ──
  private started = false;

  // ── Stats ──
  private stats = {
    totalComputes: 0,
    compiledComputes: 0,
    gravityComputes: 0,
    racedComputes: 0,
    aclDenied: 0,
    rateLimited: 0,
    totalTimeMs: 0,
  };

  constructor(
    localDeviceId: string,
    rawCompute: ComputeFn,
    peerProvider: PeerProvider,
    deviceStateReader: DeviceStateReader,
    encryptFn: (plain: Uint8Array, key: Uint8Array) => Uint8Array,
    decryptFn: (cipher: Uint8Array, key: Uint8Array) => Uint8Array,
    stateStore: V3StateStore | null = null,
    config: Partial<V4BridgeConfig> = {},
  ) {
    this.localDeviceId = localDeviceId;
    this.rawCompute = rawCompute;
    this.peerProvider = peerProvider;
    this.config = { ...DEFAULT_V4_CONFIG, ...config };
    this.stateStore = stateStore;

    // ── Phase 1: Persistence ──
    // State store passed in from outside (already initialized)

    // ── Phase 2: Job Queue ──
    this.jobQueue = new JobQueue(stateStore);
    this.jobExecutor = new JobExecutor(
      this.jobQueue,
      (wasm, input, opts) => this.executeRaw(wasm, input, opts),
      { deviceId: localDeviceId, pollIntervalMs: 1000, maxConcurrent: 4 },
    );
    this.jobAnnouncer = new JobAnnouncer(this.jobQueue, { deviceId: localDeviceId });

    // ── Phase 3: Unified Scheduler ──
    this.loadMonitor = new LoadMonitor(localDeviceId, deviceStateReader);
    this.scheduler = new UnifiedScheduler(
      (wasm, input, opts) => this.executeRaw(wasm, input, opts),
      peerProvider,
      this.loadMonitor,
    );

    // ── Phase 4: Task Compiler ──
    this.compiler = new TaskCompiler();

    // ── Phase 5: Speculative Racing ──
    this.raceManager = new RaceManager();

    // ── Phase 6: Computation Gravity ──
    this.dataCatalog = new DataCatalog(localDeviceId);
    this.codeShipper = new CodeShipper(localDeviceId);
    this.gravityPlanner = new GravityPlanner(this.dataCatalog);

    // ── Phase 7: CMP Pipes ──
    this.pipelineManager = new PipelineManager(localDeviceId);

    // ── Phase 8: Security ──
    this.encryptor = new V3MessageEncryptor(encryptFn, decryptFn);
    this.accessControl = new AccessController();
    this.rateLimiter = new RateLimiter();
    this.meshFS = new MeshFS(localDeviceId);

    log.info('V4 Bridge created: all 8 pillars initialized');
  }

  // ══════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════

  /**
   * Start the V4 Bridge — activates all background services.
   */
  start(): void {
    if (this.started) return;

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
  stop(): void {
    if (!this.started) return;

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
  async compute(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: V4ComputeOptions = {},
  ): Promise<V4ComputeResult> {
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
    let gravityDecision: GravityDecision | null = null;
    if (this.config.enableGravity && !options.skipGravity && options.dataKey) {
      gravityDecision = this.gravityPlanner.plan(
        options.dataKey,
        wasmModule.length,
        Math.ceil(inputData.length * 0.1), // Estimate result ~10% of input
        this.localDeviceId,
      );

      if (gravityDecision.strategy === GravityStrategy.PULL) {
        this.stats.gravityComputes++;
        return this.executeViaGravity(wasmModule, inputData, options, gravityDecision, startMs);
      }
    }

    // ── Step 4: Task Compiler ──
    let compileResult: CompileResult | null = null;
    if (this.config.enableCompiler && inputData.length >= this.config.compilerMinInputBytes) {
      const peerIds = this.getPeerDeviceIds();
      // Also include peers from the peer provider
      const providerPeers = this.peerProvider.getPeerCapabilities();
      const allPeerIds = [...new Set([...peerIds, ...providerPeers.map(p => p.deviceId)])];

      const meta: TaskMeta = {
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
      const racingState: RacingMeshState = {
        availableDevices: this.getPeerDeviceIds().length + 1,
        avgUtilization: this.getAverageUtilization(),
        loadVariance: this.getMaxLoadVariance(),
        estimatedDurationMs: options.deadline ?? -1,
      };

      const raceDecision = this.raceManager.shouldRace(racingState);
      shouldRace = raceDecision.shouldRace;
    }

    // ── Step 6: Execute ──
    let result: V4ComputeResult;

    if (shouldRace && this.getPeerDeviceIds().length >= 1) {
      result = await this.executeWithRacing(wasmModule, inputData, options, startMs);
    } else if (compileResult && compileResult.plan.chunkCount > 1) {
      result = await this.executeWithCompiler(wasmModule, inputData, options, compileResult, startMs);
    } else {
      result = await this.executeViaScheduler(wasmModule, inputData, options, startMs);
    }

    // Attach gravity info
    result.gravityApplied = gravityDecision?.strategy === GravityStrategy.PULL || gravityDecision?.strategy === GravityStrategy.SCATTER;
    result.gravitySavings = gravityDecision?.savingsRatio ?? 0;

    this.stats.totalTimeMs += result.totalTimeMs;

    log.info(
      `V4 compute: ${result.strategy}, pattern=${result.pattern ?? 'none'}, ` +
      `${result.totalTimeMs}ms, ${result.devicesUsed} dev, ` +
      `gravity=${result.gravityApplied}, raced=${result.raced}`
    );

    return result;
  }

  // ══════════════════════════════════════
  // Execution Paths
  // ══════════════════════════════════════

  /**
   * Execute via the Unified Scheduler (default path).
   */
  private async executeViaScheduler(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: V4ComputeOptions,
    startMs: number,
  ): Promise<V4ComputeResult> {
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
  private async executeWithCompiler(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: V4ComputeOptions,
    compileResult: CompileResult,
    startMs: number,
  ): Promise<V4ComputeResult> {
    const plan = compileResult.plan;

    // Execute each chunk via the raw compute function
    const chunkResults: Uint8Array[] = [];

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
      strategy: ExecutionStrategy.WASM_DISTRIBUTE,
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
  private async executeViaGravity(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: V4ComputeOptions,
    decision: GravityDecision,
    startMs: number,
  ): Promise<V4ComputeResult> {
    const targetDevice = decision.targetDevices[0];

    try {
      const result = await this.codeShipper.shipCode(
        targetDevice,
        options.dataKey!,
        wasmModule,
        options.entryPoint ?? 'process',
        inputData,
        options.deadline ?? 30000,
      );

      return {
        data: result.data ?? new Uint8Array(0),
        totalTimeMs: Date.now() - startMs,
        chunksExecuted: 1,
        devicesUsed: 1,
        verified: result.success,
        localFallback: false,
        strategy: ExecutionStrategy.WASM_DISTRIBUTE,
        pattern: null,
        gravityApplied: true,
        gravitySavings: decision.savingsRatio,
        raced: false,
        racerCount: 0,
      };
    } catch (err: any) {
      // Gravity failed — fall back to scheduler
      log.warn(`Gravity execution failed: ${err.message} — falling back to scheduler`);
      return this.executeViaScheduler(wasmModule, inputData, options, startMs);
    }
  }

  /**
   * Execute with speculative racing.
   */
  private async executeWithRacing(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: V4ComputeOptions,
    startMs: number,
  ): Promise<V4ComputeResult> {
    const peerIds = this.getPeerDeviceIds().slice(0, 2); // Max 2 peers + local = 3 racers
    const allDevices = [this.localDeviceId, ...peerIds];

    const racers: Racer[] = allDevices.map(deviceId => ({
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
      } as RacerResult)).catch(err => ({
        deviceId,
        taskId: `race-${deviceId}`,
        success: false,
        data: null,
        totalTimeMs: Date.now() - startMs,
        error: err.message,
      } as RacerResult)),
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
        strategy: ExecutionStrategy.SPECULATIVE_RACE,
        pattern: null,
        gravityApplied: false,
        gravitySavings: 0,
        raced: true,
        racerCount: racers.length,
      };
    } catch (err: any) {
      // All racers failed — fall back to scheduler
      log.warn(`Racing failed: ${err.message} — falling back to scheduler`);
      return this.executeViaScheduler(wasmModule, inputData, options, startMs);
    }
  }

  /**
   * Submit as a background job.
   */
  private async submitBackgroundJob(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: V4ComputeOptions,
  ): Promise<V4ComputeResult> {
    const definition: JobDefinition = {
      wasmModule,
      inputData,
      entryPoint: options.entryPoint ?? 'process',
      taskType: options.taskType ?? TaskType.MAP_REDUCE,
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
      strategy: ExecutionStrategy.LOCAL_ONLY,
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

  private async executeRaw(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    opts: any,
  ): Promise<SchedulerResult> {
    const result = await this.rawCompute(wasmModule, inputData, opts);
    return {
      ...result,
      strategy: ExecutionStrategy.WASM_DISTRIBUTE,
      plan: {} as any,
    };
  }

  // ══════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════

  private getPeerDeviceIds(): string[] {
    return this.loadMonitor.getAllLoads()
      .filter(l => l.deviceId !== this.localDeviceId)
      .map(l => l.deviceId);
  }

  private getAverageUtilization(): number {
    const loads = this.loadMonitor.getAllLoads();
    if (loads.length === 0) return 0.5;
    return loads.reduce((s, l) => s + l.cpuPercent, 0) / loads.length / 100;
  }

  private getMaxLoadVariance(): number {
    const loads = this.loadMonitor.getAllLoads();
    let maxVar = 0;
    for (const l of loads) {
      const v = this.loadMonitor.getLoadVariance(l.deviceId);
      if (v > maxVar) maxVar = v;
    }
    return maxVar;
  }

  // ══════════════════════════════════════
  // Stats
  // ══════════════════════════════════════

  getStats(): {
    totalComputes: number;
    compiledComputes: number;
    gravityComputes: number;
    racedComputes: number;
    aclDenied: number;
    rateLimited: number;
    avgTimeMs: number;
    scheduler: any;
    compiler: any;
    gravity: any;
    racing: any;
    jobs: any;
    rateLimiter: any;
    meshFS: any;
  } {
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

  isStarted(): boolean {
    return this.started;
  }

  /**
   * Connect a V4WireHandler so all modules can send/receive
   * real wire messages through the mesh transport.
   */
  connectWireHandler(handler: V4WireHandler): void {
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
      } catch (err: any) {
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
