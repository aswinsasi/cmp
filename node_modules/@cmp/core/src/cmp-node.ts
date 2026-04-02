/**
 * CMP Node
 * The primary entry point for applications integrating CMP.
 * Wires together all 6 protocol layers and provides a simple,
 * high-level API for mesh formation and distributed computation.
 *
 * Usage:
 *   const node = new CMPNode({ transports: ['lan'] });
 *   await node.start();
 *   const result = await node.compute(wasmModule, inputData, { deadline: 5000 });
 *   await node.stop();
 *
 * @module cmp-node
 * @author Agent Viscro
 */

import { ITransport, TransportEvent } from '../../transport/src/interface';
import { LANTransport } from '../../transport/src/lan-transport';
import { MultiTransport } from '../../transport/src/multi-transport';
import { VirtualTransport, VirtualNetwork } from '../../transport/src/virtual-transport';

import { V2Bridge } from './v2-bridge';

import {
  MeshId, TaskId, SessionKey, Hash256,
  TaskType, Runtime, Priority, VerifyMode, SecurityLevel, EncryptionAlgo,
  ChunkStatus,
  MessageType,
  CMPConfig, DEFAULT_CONFIG, resolveConfig,
  EventBus,
  PeerTable,
  DiscoveryLayer,
  DeviceProfiler,
  CapabilityMap,
  CapabilityExchange,
  NegotiationEngine,
  BidHandler,
  IncentiveLedger,
  encodeMessage, decodeMessage, encodeJSON, decodeJSON,
  generateSigningKeyPair,
  randomBytes,
  encrypt, decrypt, hash256,
  sign, verify,
  toHex, shortId,
  Logger, LogLevel,
} from './';

import type {
  CMPEvents, PeerEntry, MeshResources, ComputeRequest,
  NegotiationResult, AssignmentRecord, ScoredCandidate,
  ChunkDataWire, ChunkResultWire, HeartbeatWire, DepartureNoticeWire, CheckpointStoreWire,
  ComputationCertificate, CertificateVerification, DeviceAttestation,
} from './';

import {
  WASMSandbox,
  CodeCache,
  DataSplitter,
  TaskDistributor,
  ExecutionEngine,
  ResultAssembler,
  packCodePayload,
  detectRuntime,
  executeMultiRuntime,
} from '../../runtime/src';

import type { DecompositionPlan, RuntimeType } from '../../runtime/src';

import { MCLEngine } from './mcl/engine';
import type { TaskCompletionData } from './mcl/engine';

const log = new Logger('CMPNode');

// ── Public API Types ──

export interface ComputeOptions {
  /** Task decomposition strategy */
  taskType?: TaskType;
  /** WASM runtime required on executors */
  runtime?: Runtime;
  /** Minimum cores needed across mesh */
  minCores?: number;
  /** Minimum memory needed across mesh (MB) */
  minMemoryMb?: number;
  /** Whether GPU is required */
  gpuRequired?: boolean;
  /** Maximum time to complete (ms) */
  deadline?: number;
  /** Task priority */
  priority?: Priority;
  /** Verification mode */
  verifyMode?: VerifyMode;
  /** Data sensitivity level */
  sensitivity?: SecurityLevel;
  /** Entry point function name in WASM module */
  entryPoint?: string;
  /** Number of chunks (0 = auto) */
  chunkHint?: number;
  /** Generate a Computation Certificate (requires REDUNDANT verification) */
  certify?: boolean;
}

export interface ComputeResult {
  taskId: TaskId;
  /** Assembled output data */
  data: Uint8Array;
  /** Total time from submit to assembly (ms) */
  totalTimeMs: number;
  /** Number of chunks executed */
  chunksExecuted: number;
  /** Number of unique devices used */
  devicesUsed: number;
  /** Verification result */
  verified: boolean;
  /** Whether computation fell back to local execution */
  localFallback: boolean;
  /** Computation Certificate (if certify: true was set) */
  certificate?: ComputationCertificate;
}

export interface MeshStatus {
  meshId: string;
  running: boolean;
  peers: number;
  activePeers: PeerEntry[];
  resources: MeshResources;
  credits: number;
  reputation: number;
  uptime: number;
}

export interface PeerInfo {
  meshId: string;
  shortId: string;
  state: string;
  tier?: number;
  latencyMs: number;
  reputationScore: number;
  transports: string[];
  cores?: number;
  memoryMb?: number;
}

export interface CMPNodeConfig extends Partial<CMPConfig> {
  /** Override transport (for testing with VirtualTransport) */
  _transport?: ITransport;
  /** Log level */
  logLevel?: LogLevel;
}

// ── Main Class ──

export class CMPNode {
  private config: CMPConfig;
  private transport: ITransport;
  private bus: EventBus;
  private peerTable: PeerTable;
  private discovery: DiscoveryLayer;
  private profiler: DeviceProfiler;
  private capMap: CapabilityMap;
  private capExchange: CapabilityExchange;
  private negotiation: NegotiationEngine;
  private bidHandler: BidHandler;
  private codeCache: CodeCache;
  private executionEngine: ExecutionEngine;
  private distributor: TaskDistributor;
  private splitter: DataSplitter;
  private ledger: IncentiveLedger;
  private lanTransport?: LANTransport;
  private signingKP!: { publicKey: Uint8Array; secretKey: Uint8Array };

  private running = false;
  private startTime = 0;
  /** Periodic reputation decay timer (runs every hour) */
  private decayTimer?: ReturnType<typeof setInterval>;
  /** Generated certificates: certId → certificate */
  private certificates = new Map<string, ComputationCertificate>();
  /** Mesh Cognition Layer engine (v1.2) */
  private mclEngine: MCLEngine;

  /** Optional Lifeform transport handler (v1.4) */
  private lifeformHandler: any | null = null;

  /** V2 Bridge: Layers 11-13 (v2.0) */
  private v2bridge: V2Bridge | null = null;

  /**
   * Pending remote results: taskHex → { resolve, assembler, timeout, resultCount }
   * Used to collect CHUNK_RESULT messages from executors.
   */
  private pendingTasks = new Map<string, {
    assembler: ResultAssembler;
    plan: DecompositionPlan;
    sessionKey: SessionKey;
    wasmModule: Uint8Array;
    entryPoint: string;
    resolve: (completion: any) => void;
    reject: (err: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    resultsReceived: number;
    expectedResults: number;
    /** Per-chunk heartbeat tracking: chunkHex → { lastBeat, missedBeats, executorAddress, dead } */
    chunkMonitors: Map<string, {
      lastBeat: number;
      missedBeats: number;
      executorAddress: string;
      dead: boolean;
    }>;
    /** Heartbeat check interval */
    heartbeatTimer?: ReturnType<typeof setInterval>;
    /** Credits to pay per chunk (from agreed bid price) */
    creditsPerChunk: number;
    /** Checkpoint snapshots received from executors: chunkHex → { data, stepsCompleted } */
    checkpoints?: Map<string, { data: Uint8Array; stepsCompleted: number }>;
    /** Original input data (for certificate generation) */
    inputData?: Uint8Array;
    /** Whether to generate a Computation Certificate on completion */
    certify?: boolean;
  }>();

  constructor(config: CMPNodeConfig = {}) {
    if (config.logLevel !== undefined) {
      Logger.setLevel(config.logLevel);
    }

    this.config = resolveConfig(config);
    this.bus = new EventBus();
    this.peerTable = new PeerTable(this.bus, this.config.peerStaleMs, this.config.peerDeadMs);

    // Transport
    if (config._transport) {
      this.transport = config._transport;
    } else {
      const multi = new MultiTransport();
      if (this.config.transports.includes('lan')) {
        const lan = new LANTransport();
        this.lanTransport = lan;
        multi.register(lan);
      }
      this.transport = multi;
    }

    // Layer 1: Discovery
    this.discovery = new DiscoveryLayer(this.transport, this.bus, this.peerTable, this.config);

    // Layer 2: Capability
    this.profiler = new DeviceProfiler({ maxResourceShare: this.config.maxResourceShare });
    this.capMap = new CapabilityMap(this.bus);
    this.capExchange = new CapabilityExchange(
      this.discovery.getMeshId(),
      this.transport,
      this.bus,
      this.peerTable,
      this.capMap,
      this.profiler,
      (meshId) => this.discovery.resolveAddress(meshId)
    );

    // Layer 3: Negotiation (needs execution deps, so build those first)
    // Layers 4-6: Distribution, Execution, Assembly
    this.codeCache = new CodeCache(100);
    this.executionEngine = new ExecutionEngine(
      this.discovery.getMeshId(),
      this.codeCache,
      { maxConcurrent: this.config.maxConcurrentTasks }
    );
    this.distributor = new TaskDistributor();
    this.splitter = new DataSplitter();

    const signingKP = generateSigningKeyPair();
    this.signingKP = signingKP;

    this.ledger = new IncentiveLedger({
      bootstrapCredits: this.config.bootstrapCredits,
      decayRate: this.config.reputationDecayRate,
      minReputation: this.config.minReputationToParticipate,
      signingKey: signingKP.secretKey,
    });

    this.negotiation = new NegotiationEngine(
      this.discovery.getMeshId(),
      signingKP,
      this.transport,
      this.bus,
      this.peerTable,
      this.capMap,
      this.discovery,
      this.ledger,
      {
        bidWindowMs: this.config.bidWindowMs,
        minBids: this.config.minBids,
        maxBids: this.config.maxBids,
        scoringWeights: this.config.scoringWeights,
      }
    );
    this.bidHandler = new BidHandler(
      this.discovery.getMeshId(),
      this.transport,
      this.bus,
      this.profiler,
      this.discovery,
      this.executionEngine,
      this.codeCache,
      this.ledger,
      {
        acceptingTasks: this.config.acceptingTasks,
        maxConcurrentTasks: this.config.maxConcurrentTasks,
        minBatteryPct: this.config.minBatteryPct,
        maxBidResourceShare: this.config.maxResourceShare,
      }
    );

    log.info(`CMPNode created: ${shortId(this.discovery.getMeshId())}`);

    // Layer 8: Mesh Cognition (v1.2)
    this.mclEngine = new MCLEngine({
      meshId: this.discovery.getMeshId(),
      signingSecretKey: signingKP.secretKey,
      signingPublicKey: signingKP.publicKey,
      transport: this.transport,
      bus: this.bus,
      config: this.config.mcl,
    });

    // Layers 11-13: Consciousness, Spacetime, Wormholes (v2.0)
    this.v2bridge = new V2Bridge(this);
  }

  // ══════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════

  /**
   * Start the CMP node: begin discovery, capability exchange,
   * and accept incoming tasks.
   */
  async start(): Promise<void> {
    if (this.running) return;

    await this.transport.start();
    await this.discovery.start();
    await this.capExchange.start();
    await this.negotiation.start();
    await this.bidHandler.start();

    // Listen for incoming CHUNK_RESULT messages (requester side)
    this.transport.on('message', (event: TransportEvent) => {
      this.handleTransportMessage(event);
    });

    // Executor side: earn credits when we complete chunks for others
    this.bus.on('chunk:executed', (data) => {
      if (data.status === ChunkStatus.SUCCESS) {
        const myHex = this.meshIdHex();
        const earned = data.creditsEarned || 1;
        this.ledger.earnCredits(myHex, 'mesh', earned, toHex(data.taskId), toHex(data.chunkId));
        this.ledger.recordCompletion(myHex, true);
        log.debug(`Earned ${earned} CCU for executing chunk ${shortId(data.chunkId)}`);
        this.bus.emit('credit:earned', { amount: earned, taskId: data.taskId });
      } else {
        this.ledger.recordFailure(this.meshIdHex());
      }
    });

    this.running = true;
    this.startTime = Date.now();

    // Start Mesh Cognition Layer (v1.2)
    if (this.config.mcl.merDbPath) {
      await this.mclEngine.initPersistence(this.config.mcl.merDbPath);
    }
    this.mclEngine.start();

    // Start v2.0 layers
    if (this.v2bridge) this.v2bridge.start();

    // Initialize own ledger account and apply decay to any existing accounts
    this.ledger.getAccount(this.meshIdHex());
    this.ledger.applyDecay();

    // Apply reputation decay every hour to penalize inactive devices
    this.decayTimer = setInterval(() => {
      this.ledger.applyDecay();
    }, 60 * 60 * 1000);

    log.info(`CMPNode started: ${this.meshIdHex()}`, {
      transports: this.config.transports,
      accepting: this.config.acceptingTasks,
    });

    this.bus.emit('node:started', { meshId: this.discovery.getMeshId() });
  }

  /**
   * Stop the CMP node gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Broadcast DEPARTURE_NOTICE so peers can reassign our chunks
    try {
      const activeChunks: { taskId: number[]; chunkId: number[] }[] = [];

      // MCL: handoff MERs before departure (v1.2)
      const mclMers = this.mclEngine.stop();
      if (mclMers.length > 0) {
        log.info(`MCL: ${mclMers.length} MERs available for handoff on departure`);
      }
      // Gather any chunks we're currently executing (from bid handler)
      const notice: DepartureNoticeWire = {
        meshId: Array.from(this.discovery.getMeshId()),
        activeChunks,
        timestamp: Date.now(),
      };
      const msg = encodeMessage(MessageType.DEPARTURE_NOTICE, encodeJSON(notice));
      await this.transport.broadcast(msg);
      log.info('Departure notice broadcast');
    } catch {
      // Best-effort — transport may already be failing
    }

    await this.bidHandler.stop();
    await this.negotiation.stop();

    // Stop v2.0 layers
    if (this.v2bridge) this.v2bridge.stop();
    await this.capExchange.stop();
    await this.discovery.stop();
    await this.transport.stop();

    this.peerTable.destroy();
    this.profiler.destroy();
    this.bus.clear();
    this.capMap.clear();
    this.codeCache.clear();

    // Cancel any pending remote tasks
    for (const [taskHex, pending] of this.pendingTasks) {
      clearTimeout(pending.timeout);
      if (pending.heartbeatTimer) clearInterval(pending.heartbeatTimer);
      pending.reject(new Error('CMPNode stopped'));
    }
    this.pendingTasks.clear();

    // Stop periodic reputation decay
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = undefined;
    }

    log.info('CMPNode stopped');
    this.bus.emit('node:stopped', {});
  }

  // ══════════════════════════════════════════
  // Compute API
  // ══════════════════════════════════════════

  /**
   * Submit a computation task to the mesh.
   *
   * SECURITY: This method includes a defense-in-depth gate that detects
   * non-WASM code (Python, JS, etc.) and forces local execution. Only
   * WASM modules with valid \0asm magic bytes are distributed to remote
   * peers. This prevents arbitrary code execution on other devices even
   * if the caller bypasses the run() API's safety checks.
   *
   * @param wasmModule - WASM module bytes to execute
   * @param inputData - Input data to process
   * @param options - Compute options (deadline, priority, etc.)
   * @returns Result with assembled output data
   */
  async compute(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: ComputeOptions = {}
  ): Promise<ComputeResult> {
    if (!this.running) throw new Error('CMPNode not running');

    const startTime = Date.now();
    const entryPoint = options.entryPoint || 'process';
    const deadline = options.deadline || 5000;

    // ── SECURITY GATE: Block non-WASM code from mesh distribution ──
    // This is defense-in-depth. The run() method already routes non-WASM
    // to local execution, but compute() is a public API that could be
    // called directly. If someone passes non-WASM code (detected by the
    // absence of WASM magic bytes \0asm), force local execution.
    const runtimeCheck = detectRuntime(wasmModule);
    if (runtimeCheck !== null) {
      log.warn(
        `SECURITY: Blocked ${runtimeCheck.runtime} code from mesh distribution. ` +
        `Non-WASM runtimes have no sandbox isolation and MUST NOT execute on remote peers. ` +
        `Falling back to local execution.`
      );
      return this.executeLocalMultiRuntime(
        runtimeCheck.runtime,
        runtimeCheck.code,
        inputData,
        deadline
      );
    }

    // Cache the WASM module
    const moduleHash = this.codeCache.store(wasmModule);

    // Build compute request
    const request: ComputeRequest = {
      taskType: options.taskType ?? TaskType.MAP_REDUCE,
      runtimeRequired: options.runtime ?? Runtime.WASM,
      payloadSizeKb: Math.ceil(inputData.length / 1024),
      computeBudget: {
        minCores: options.minCores ?? 1,
        minMemoryMb: options.minMemoryMb ?? 256,
        gpuRequired: options.gpuRequired ?? false,
        deadlineMs: deadline,
      },
      priority: options.priority ?? Priority.NORMAL,
      security: {
        verifyMode: options.certify ? VerifyMode.REDUNDANT : (options.verifyMode ?? VerifyMode.CHECKSUM),
        encryption: EncryptionAlgo.AES_256_GCM,
        dataSensitivity: options.sensitivity ?? SecurityLevel.PRIVATE,
      },
      chunkHint: options.chunkHint ?? 0,
    };

    // Phase 1: Negotiate
    log.info(`Computing: ${inputData.length} bytes, deadline ${deadline}ms`);
    const negotiationResult = await this.negotiation.submitTask(request);

    // No peers? Fall back to local execution
    if (negotiationResult.assignments.length === 0) {
      log.info('No mesh peers available, executing locally');
      return this.executeLocally(wasmModule, inputData, entryPoint, startTime);
    }

    // Spend credits for this task (sum of agreed bid prices)
    const totalCredits = negotiationResult.assignments.reduce((sum, a) => {
      return sum + a.creditsAgreed;
    }, 0);
    const myHex = this.meshIdHex();
    if (!this.ledger.spendCredits(myHex, totalCredits, toHex(negotiationResult.taskId))) {
      log.warn(`Insufficient credits (${this.ledger.getBalance(myHex)} CCU), executing locally`);
      return this.executeLocally(wasmModule, inputData, entryPoint, startTime);
    }
    log.debug(`Spent ${totalCredits} CCU for task ${shortId(negotiationResult.taskId)}`);

    // Phase 2: Distribute
    const codeRef = {
      runtime: Runtime.WASM,
      moduleHash,
      entryPoint,
    };

    // Build the task request for the distributor
    const taskRequest = {
      taskId: negotiationResult.taskId,
      requesterId: this.discovery.getMeshId(),
      taskType: request.taskType,
      runtimeRequired: request.runtimeRequired,
      payloadSizeKb: request.payloadSizeKb,
      computeBudget: request.computeBudget,
      security: {
        encryption: EncryptionAlgo.AES_256_GCM,
        verifyMode: request.security?.verifyMode ?? VerifyMode.CHECKSUM,
        dataSensitivity: request.security?.dataSensitivity ?? SecurityLevel.PRIVATE,
      },
      chunkHint: request.chunkHint ?? 0,
      priority: request.priority ?? Priority.NORMAL,
      creditsOffered: 10,
      signature: new Uint8Array(64),
    };

    const plan = this.distributor.plan(
      taskRequest,
      negotiationResult.assignments,
      inputData,
      codeRef
    );

    log.info(`Distributed: ${plan.chunks.length} chunks across ${negotiationResult.assignments.length} devices`);

    // Phase 3: Send CHUNK_DATA to remote executors and wait for CHUNK_RESULT
    const sessionKey = randomBytes(32);
    const assembler = new ResultAssembler(plan, sessionKey);
    const taskHex = toHex(negotiationResult.taskId);

    // Build a promise that resolves when all chunk results arrive (or timeout)
    const remoteResult = await new Promise<ComputeResult>((resolve, reject) => {
      // Register this task in pendingTasks so handleChunkResult can find it
      const timeoutHandle = setTimeout(() => {
        const pending = this.pendingTasks.get(taskHex);
        if (pending) {
          if (pending.heartbeatTimer) clearInterval(pending.heartbeatTimer);
          this.pendingTasks.delete(taskHex);
          log.warn(`Task ${shortId(negotiationResult.taskId)} timed out waiting for remote results ` +
            `(${pending.resultsReceived}/${pending.expectedResults} received), falling back to local`);
          // Fall back to local execution
          this.executeLocally(wasmModule, inputData, entryPoint, startTime).then(resolve).catch(reject);
        }
      }, deadline + 5000); // Give extra 5s grace beyond the task deadline

      // Build per-chunk heartbeat monitors
      const chunkMonitors = new Map<string, {
        lastBeat: number; missedBeats: number; executorAddress: string; dead: boolean;
      }>();
      const now = Date.now();
      for (let i = 0; i < plan.chunks.length; i++) {
        const chunkHex = toHex(plan.chunks[i].chunkId);
        const assignment = negotiationResult.assignments[i % negotiationResult.assignments.length];
        chunkMonitors.set(chunkHex, {
          lastBeat: now,
          missedBeats: 0,
          executorAddress: assignment.peerAddress,
          dead: false,
        });
      }

      // Start heartbeat check timer
      const heartbeatTimer = setInterval(() => {
        this.checkHeartbeats(taskHex);
      }, this.config.heartbeatIntervalMs);

      this.pendingTasks.set(taskHex, {
        assembler,
        plan,
        sessionKey,
        wasmModule,
        entryPoint,
        resolve,
        reject,
        timeout: timeoutHandle,
        resultsReceived: 0,
        expectedResults: plan.chunks.length,
        chunkMonitors,
        heartbeatTimer,
        creditsPerChunk: Math.max(1, Math.ceil(totalCredits / plan.chunks.length)),
        inputData,
        certify: options.certify,
      });

      // Send CHUNK_DATA to each assigned executor
      this.sendChunkDataToExecutors(
        plan,
        negotiationResult,
        wasmModule,
        moduleHash,
        sessionKey,
        entryPoint,
        deadline
      ).catch((err) => {
        log.warn(`Failed to send chunk data: ${err.message}`);
        clearInterval(heartbeatTimer);
        this.pendingTasks.delete(taskHex);
        clearTimeout(timeoutHandle);
        // Fall back to local execution if we can't even send the chunks
        this.executeLocally(wasmModule, inputData, entryPoint, startTime).then(resolve).catch(reject);
      });
    });

    return remoteResult;
  }

  // ══════════════════════════════════════════
  // Run API — execute ANY language (mesh or local)
  // ══════════════════════════════════════════

  /**
   * Execute code in any language.
   *
   * SECURITY MODEL:
   *   - WASM: distributes across mesh (sandboxed — zero filesystem/network/sensor access)
   *   - All other languages: execute LOCAL ONLY on this device
   *
   * Non-WASM runtimes (Python, Ruby, Shell, etc.) run via subprocess with full
   * process permissions. They are safe to run locally (your own code on your own
   * device) but MUST NOT be sent to remote peers, where they would be arbitrary
   * code execution attacks. This method enforces that boundary automatically.
   *
   * Supports 14 languages: JavaScript, Python, Ruby, PHP, Go, Rust, C, C++,
   * Java, Perl, Lua, R, Shell, and WASM.
   *
   * For JavaScript: pass a function directly (auto-serialized).
   * For other languages: pass source code as a string with { language: 'python' }.
   *
   * The code must define a process(data) function that takes input and returns output.
   *
   * @param fn - Function (JS only) or source code string (any language)
   * @param inputData - Data to pass to the function
   * @param options - language, deadline, chunkHint
   *
   * @example JavaScript (pass a function):
   * ```typescript
   * const result = await node.run(
   *   (data) => {
   *     const nums = JSON.parse(data.toString());
   *     return { sum: nums.reduce((a, b) => a + b, 0) };
   *   },
   *   Buffer.from(JSON.stringify([10, 20, 30]))
   * );
   * ```
   *
   * @example Python:
   * ```typescript
   * const result = await node.run(`
   * def process(data):
   *     import json
   *     nums = json.loads(data)
   *     return json.dumps({"sum": sum(nums)})
   * `, inputData, { language: 'python' });
   * ```
   *
   * @example Ruby:
   * ```typescript
   * const result = await node.run(`
   * def process(data)
   *   nums = JSON.parse(data)
   *   { sum: nums.sum }.to_json
   * end
   * `, inputData, { language: 'ruby' });
   * ```
   *
   * @example PHP:
   * ```typescript
   * const result = await node.run(`
   * function process($data) {
   *     $nums = json_decode($data, true);
   *     return json_encode(["sum" => array_sum($nums)]);
   * }
   * `, inputData, { language: 'php' });
   * ```
   */
  async run(
    fn: ((data: Buffer) => any) | string,
    inputData: Uint8Array,
    options: {
      language?: string;
      deadline?: number;
      chunkHint?: number;
    } = {}
  ): Promise<ComputeResult> {
    const language = options.language || 'javascript';

    let codeString: string;
    if (typeof fn === 'function') {
      // Serialize the JS function
      const fnStr = fn.toString();
      codeString = `const __userFn = ${fnStr};\nfunction process(data) { return __userFn(data); }`;
    } else {
      codeString = fn;
    }

    const codeBytes = new TextEncoder().encode(codeString);

    // ── SECURITY: Non-WASM languages execute LOCAL ONLY ──
    // Subprocess-based runtimes (Python, Ruby, Shell, etc.) have no sandbox
    // isolation — arbitrary code runs with full process permissions. Sending
    // non-WASM code to remote peers would let a malicious task requester
    // execute arbitrary commands on other people's devices.
    //
    // WASM is the only runtime safe for remote execution (memory-isolated,
    // zero filesystem/network/sensor access via the WASMSandbox).
    //
    // Non-WASM code runs on the requester's own machine only, which is safe:
    // you're running your own code on your own device.
    if (language !== 'wasm') {
      log.info(`Local-only execution: ${language} is not sandboxed, refusing to distribute to mesh`);
      return this.executeLocalMultiRuntime(language, codeBytes, inputData, options.deadline || 15000);
    }

    // WASM: safe to distribute across mesh
    const packed = packCodePayload(language as any, codeBytes);

    return this.compute(packed, inputData, {
      entryPoint: 'process',
      deadline: options.deadline || 15000,
      chunkHint: options.chunkHint || 1,
    });
  }

  /**
   * Send CHUNK_DATA messages to assigned executors.
   */
  private async sendChunkDataToExecutors(
    plan: DecompositionPlan,
    negotiationResult: NegotiationResult,
    wasmModule: Uint8Array,
    moduleHash: Hash256,
    sessionKey: SessionKey,
    entryPoint: string,
    deadline: number
  ): Promise<void> {
    for (let i = 0; i < plan.chunks.length; i++) {
      const chunk = plan.chunks[i];
      const assignment = negotiationResult.assignments[i % negotiationResult.assignments.length];

      // Encrypt the chunk payload with session key
      const encryptedPayload = plan.inputChunks[i] && plan.inputChunks[i].length > 0
        ? encrypt(plan.inputChunks[i], sessionKey)
        : new Uint8Array(0);

      // Build wire format
      const wire: ChunkDataWire = {
        taskId: Array.from(chunk.taskId),
        chunkId: Array.from(chunk.chunkId),
        sequence: chunk.sequence,
        totalChunks: chunk.totalChunks,
        wasmModule: Array.from(wasmModule),
        entryPoint,
        moduleHash: Array.from(moduleHash),
        sessionKey: Array.from(sessionKey),
        encryptedPayload: Array.from(encryptedPayload),
        timeoutMs: deadline,
        expectedOutput: {
          format: chunk.expectedOutput.format,
          maxSizeKb: chunk.expectedOutput.maxSizeKb,
        },
      };

      const msg = encodeMessage(MessageType.CHUNK_DATA, encodeJSON(wire));

      try {
        await this.transport.sendTo(assignment.peerAddress, msg);
        log.info(`CHUNK_DATA sent to ${assignment.peerAddress}: chunk ${shortId(chunk.chunkId)} ` +
          `(${wasmModule.length}B wasm + ${encryptedPayload.length}B payload)`);
      } catch (err: any) {
        log.warn(`Failed to send CHUNK_DATA to ${assignment.peerAddress}: ${err.message}`);
      }
    }
  }

  /**
   * Execute locally when no mesh peers are available.
   */
  private async executeLocally(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    entryPoint: string,
    startTime: number
  ): Promise<ComputeResult> {
    const { output, status } = await this.executionEngine.executeRaw(
      wasmModule, entryPoint, inputData, 30000
    );

    return {
      taskId: randomBytes(16),
      data: output,
      totalTimeMs: Date.now() - startTime,
      chunksExecuted: 1,
      devicesUsed: 1,
      verified: status === ChunkStatus.SUCCESS,
      localFallback: true,
    };
  }

  /**
   * Execute non-WASM code locally on this device only.
   *
   * SECURITY: This method exists because subprocess-based runtimes (Python,
   * Ruby, Shell, C, Go, etc.) run with full process permissions — no sandbox.
   * They are safe to run locally (it's your own code on your own device) but
   * MUST NEVER be sent to remote peers, where they would be arbitrary code
   * execution attacks.
   *
   * Only WASM code is distributed across the mesh (via compute()).
   */
  private async executeLocalMultiRuntime(
    language: string,
    code: Uint8Array,
    inputData: Uint8Array,
    timeoutMs: number
  ): Promise<ComputeResult> {
    const startTime = Date.now();

    try {
      const output = executeMultiRuntime(language, code, inputData, timeoutMs);

      return {
        taskId: randomBytes(16),
        data: output,
        totalTimeMs: Date.now() - startTime,
        chunksExecuted: 1,
        devicesUsed: 1,
        verified: true,
        localFallback: true,
      };
    } catch (err: any) {
      log.warn(`Local ${language} execution failed: ${err.message}`);
      throw err;
    }
  }

  // ══════════════════════════════════════════
  // Status & Info
  // ══════════════════════════════════════════

  /**
   * Get current mesh status.
   */
  getStatus(): MeshStatus {
    const activePeers = this.peerTable.getActive();
    return {
      meshId: this.meshIdHex(),
      running: this.running,
      peers: activePeers.length,
      activePeers,
      resources: this.capMap.getMeshResources(),
      credits: this.ledger.getBalance(this.meshIdHex()),
      reputation: this.ledger.getReputation(this.meshIdHex()),
      uptime: this.running ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Get list of connected peers with details.
   */
  getPeers(): PeerInfo[] {
    return this.peerTable.getActive().map((p) => {
      const cap = this.capMap.get(p.meshId);
      return {
        meshId: toHex(p.meshId),
        shortId: shortId(p.meshId),
        state: p.state,
        tier: p.tier,
        latencyMs: p.latencyMs,
        reputationScore: p.reputationScore,
        transports: p.transports,
        cores: cap?.cpu.coresAvailable,
        memoryMb: cap?.memory.availableMb,
      };
    });
  }

  /**
   * Get this node's mesh ID as hex string.
   */
  meshIdHex(): string {
    return toHex(this.discovery.getMeshId());
  }

  /**
   * Get this node's short ID (first 8 hex chars).
   */
  shortMeshId(): string {
    return shortId(this.discovery.getMeshId());
  }

  /**
   * Get the raw mesh ID bytes.
   */
  getMeshId(): MeshId {
    return this.discovery.getMeshId();
  }

  /**
   * Check if node is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the event bus for subscribing to mesh events.
   */
  events(): EventBus {
    return this.bus;
  }

  /**
   * Set the Lifeform transport handler (v1.4).
   * Routes messages 0xC0-0xE0 to this handler.
   */
  setLifeformHandler(handler: any): void {
    this.lifeformHandler = handler;
  }

  /**
   * Get the transport for direct access (used by LifeformTransportHandler).
   */
  getTransport(): ITransport {
    return this.transport;
  }

  /**
   * Get the V2 Bridge (Layers 11-13: Consciousness, Spacetime, Wormholes).
   */
  getV2Bridge(): V2Bridge | null {
    return this.v2bridge;
  }

  /**
   * Get the peer table for peer resolution.
   */
  getPeerTable(): PeerTable {
    return this.peerTable;
  }

  /**
   * Get the incentive ledger for credit/reputation tracking.
   */
  getLedger(): IncentiveLedger {
    return this.ledger;
  }

  /**
   * Set whether this node accepts tasks from others.
   */
  setAcceptingTasks(accepting: boolean): void {
    this.bidHandler.setAcceptingTasks(accepting);
  }

  // ══════════════════════════════════════════
  // MCL API (v1.2)
  // ══════════════════════════════════════════

  /**
   * Get MCL status: MER count, task types, origins, pollination stats.
   */
  getMCLStatus(): {
    enabled: boolean;
    merCount: number;
    taskTypes: number;
    origins: number;
    pollinationStats: any;
  } {
    return this.mclEngine.getStatus();
  }

  /**
   * Get the MCL engine for advanced usage.
   */
  getMCLEngine(): MCLEngine {
    return this.mclEngine;
  }

  /**
   * Manually connect to a peer by IP address.
   * Used when multicast/broadcast is blocked (e.g., mobile hotspots).
   * Sends a direct UDP beacon to the IP, triggering normal discovery flow.
   */
  connectTo(ip: string): void {
    if (!this.running) throw new Error('CMPNode not running');
    if (this.lanTransport) {
      log.info(`Manual connect: sending beacon to ${ip}`);
      // Send multiple beacons to increase reliability
      this.lanTransport.sendBeaconTo(ip);
      setTimeout(() => this.lanTransport?.sendBeaconTo(ip), 500);
      setTimeout(() => this.lanTransport?.sendBeaconTo(ip), 1500);
    } else {
      log.warn('No LAN transport available for manual connect');
    }
  }

  // ══════════════════════════════════════════
  // Certification API (Layer 7)
  // ══════════════════════════════════════════

  /**
   * Compute with automatic Computation Certificate generation.
   * Forces REDUNDANT verification so multiple devices attest the result.
   *
   * Returns a ComputeResult with a `certificate` field containing
   * a standalone, verifiable proof that multiple independent devices
   * ran identical code and agreed on the output.
   *
   * @param wasmModule - WASM module bytes
   * @param inputData - Input data bytes
   * @param options - Same as compute(), certify is auto-set to true
   */
  async computeCertified(
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    options: ComputeOptions = {}
  ): Promise<ComputeResult> {
    return this.compute(wasmModule, inputData, {
      ...options,
      certify: true,
      verifyMode: VerifyMode.REDUNDANT,
    });
  }

  /**
   * Verify a Computation Certificate.
   * Checks all device signatures, consensus, and structural validity.
   * Requires only the certificate — no external services needed.
   */
  verifyCert(cert: ComputationCertificate): CertificateVerification {
    return verifyCertificate(cert);
  }

  /**
   * Export a certificate as portable JSON string.
   * All binary fields are hex-encoded for readability.
   */
  exportCert(cert: ComputationCertificate): string {
    return exportCertificateJSON(cert);
  }

  /**
   * Import a certificate from JSON string.
   */
  importCert(json: string): ComputationCertificate {
    return importCertificateJSON(json);
  }

  /**
   * Get a previously generated certificate by ID.
   */
  getCertificate(certId: string): ComputationCertificate | undefined {
    return this.certificates.get(certId);
  }

  /**
   * Get all generated certificates.
   */
  getAllCertificates(): ComputationCertificate[] {
    return [...this.certificates.values()];
  }

  /**
   * Generate a certificate from completed task results.
   * Called internally when certify: true is set on a task.
   */
  private generateTaskCertificate(
    pending: any,
    completion: any,
    wasmModule: Uint8Array,
    inputData: Uint8Array,
    entryPoint: string
  ): ComputationCertificate {
    // Collect all device results from the assembler
    const allResults = pending.assembler.getAllResults();

    // Build attestation inputs from each device's result
    const attestationInputs: AttestationInput[] = [];

    for (const [_chunkHex, results] of allResults) {
      for (const result of results) {
        if (result.status !== ChunkStatus.SUCCESS) continue;

        // Get the peer's public key from peer table
        const peer = this.peerTable.get(result.executorId);
        const publicKey = peer?.publicKey || new Uint8Array(32);

        // Get capability info for architecture
        const cap = this.capMap.get(result.executorId);

        attestationInputs.push({
          meshId: result.executorId,
          // Use requester's public key since requester signs as proxy attester.
          // In a future version, executors would sign their own attestations
          // and send them back with the CHUNK_RESULT.
          publicKey: this.signingKP.publicKey,
          secretKey: this.signingKP.secretKey,
          architecture: cap ? ['ARM64', 'x86_64', 'RISC-V', 'WASM'][cap.cpu.architecture] || 'unknown' : 'unknown',
          cores: cap?.cpu.coresAvailable || 0,
          memoryMb: cap?.memory.availableMb || 0,
          result,
          // Use hash of the final assembled (decrypted) output, not the
          // encrypted chunk payload. All attestations agree on the same
          // final result — that's what the certificate proves.
          outputHash: hash256(completion.result),
        });
      }
    }

    const certRequest: CertificateRequest = {
      wasmModule,
      entryPoint,
      inputData,
      outputData: completion.result,
      strategy: completion.verificationType || 'REDUNDANT',
      verificationMode: 'REDUNDANT',
      totalChunks: completion.chunksExecuted,
      totalTimeMs: completion.totalTimeMs,
      requesterId: this.discovery.getMeshId(),
      requesterSecretKey: this.signingKP.secretKey,
      attestations: attestationInputs,
    };

    const cert = generateCertificate(certRequest);

    // Store the certificate
    this.certificates.set(cert.certId, cert);

    this.bus.emit('certificate:generated', {
      certId: cert.certId,
      deviceCount: cert.deviceCount,
      consensus: cert.consensus,
    });

    log.info(`Computation Certificate generated: ${cert.certId}`, {
      devices: cert.deviceCount,
      consensus: `${(cert.consensus * 100).toFixed(0)}%`,
      architectures: cert.uniqueArchitectures,
    });

    return cert;
  }

  // ── Internal: Remote Result Handling ──

  /**
   * Handle incoming transport messages on the requester side.
   * Routes CHUNK_RESULT, HEARTBEAT, and DEPARTURE_NOTICE messages.
   */
  private handleTransportMessage(event: TransportEvent): void {
    if (!event.data) return;

    const msg = decodeMessage(event.data);
    if (!msg) return;

    switch (msg.type) {
      case MessageType.CHUNK_RESULT:
        this.handleChunkResult(msg.payload);
        break;
      case MessageType.HEARTBEAT:
        this.handleHeartbeat(msg.payload);
        break;
      case MessageType.DEPARTURE_NOTICE:
        this.handleDeparture(msg.payload);
        break;
      case MessageType.CHECKPOINT_STORE:
        this.handleCheckpointStore(msg.payload);
        break;
      default:
        // Lifeform message routing (v1.4) — types 0xC0-0xE0
        if (msg.type >= 0xC0 && msg.type <= 0xE0 && this.lifeformHandler) {
          this.lifeformHandler.handleIncoming(msg.type, msg.payload, event.peerAddress);
          break;
        }
        // v2.0 message routing (Layers 11-13) — types 0xE1-0xF1
        if (msg.type >= 0xE1 && msg.type <= 0xF1 && this.v2bridge) {
          this.v2bridge.handleMessage(msg.type, msg.payload);
          break;
        }
        // MCL message routing (v1.2)
        this.mclEngine.handleMessage(msg.type, msg.payload, event.peerAddress);
        break;
    }
  }

  /**
   * Process a CHUNK_RESULT from a remote executor.
   * Feeds the result into the pending task's ResultAssembler.
   * When all chunks are assembled, resolves the compute() promise.
   */
  private handleChunkResult(payload: Uint8Array): void {
    const wire = decodeJSON<ChunkResultWire>(payload);
    if (!wire) {
      log.warn('Failed to decode CHUNK_RESULT payload');
      return;
    }

    const taskId = new Uint8Array(wire.taskId);
    const chunkId = new Uint8Array(wire.chunkId);
    const taskHex = toHex(taskId);
    const chunkHex = toHex(chunkId);

    log.info(`CHUNK_RESULT received: chunk ${shortId(chunkId)} for task ${shortId(taskId)}`, {
      status: ChunkStatus[wire.status],
      executionTimeMs: wire.executionTimeMs,
      payloadSize: wire.encryptedPayload.length,
    });

    const pending = this.pendingTasks.get(taskHex);
    if (!pending) {
      log.warn(`No pending task for CHUNK_RESULT ${shortId(taskId)} — may have timed out`);
      return;
    }

    // Mark chunk as done in heartbeat monitor (stop tracking it)
    const monitor = pending.chunkMonitors.get(chunkHex);
    if (monitor) {
      monitor.dead = true; // Prevent dead-detection on completed chunks
      pending.chunkMonitors.delete(chunkHex);
    }

    pending.resultsReceived++;

    // Handle FAILED chunks immediately — don't wait for timeout
    if (wire.status === ChunkStatus.FAILED) {
      // Try to extract error message from encrypted payload
      let errorMsg = 'Remote execution failed (no details)';
      if (wire.encryptedPayload.length > 0) {
        try {
          const decrypted = decrypt(new Uint8Array(wire.encryptedPayload), pending.sessionKey);
          errorMsg = new TextDecoder().decode(decrypted);
        } catch {
          // Payload wasn't a valid encrypted error message
        }
      }

      log.warn(`Chunk ${shortId(chunkId)} FAILED: ${errorMsg}`);
      this.ledger.recordFailure(toHex(new Uint8Array(wire.executorId)));

      // If all chunks have reported (all failed), reject immediately
      if (pending.resultsReceived >= pending.expectedResults) {
        clearTimeout(pending.timeout);
        if (pending.heartbeatTimer) clearInterval(pending.heartbeatTimer);
        this.pendingTasks.delete(taskHex);

        // Reject with the error message so the caller sees it
        pending.reject(new Error(errorMsg));
        return;
      }

      // If some chunks still pending, let them complete (partial failure)
      return;
    }

    // Convert wire format back to CMPResult
    const result = {
      chunkId,
      taskId,
      executorId: new Uint8Array(wire.executorId),
      status: wire.status as ChunkStatus,
      payload: new Uint8Array(wire.encryptedPayload),
      executionTimeMs: wire.executionTimeMs,
      resourceUsed: wire.resourceUsed,
      proof: new Uint8Array(wire.proof),
      signature: new Uint8Array(64),
    };

    // Feed to assembler
    const completion = pending.assembler.collectResult(result);

    this.bus.emit('result:received', {
      chunkId,
      executorId: result.executorId,
    });

    // Update ledger: earn credits for executor, track reputation
    const executorHex = toHex(result.executorId);
    const myHex = this.meshIdHex();
    const taskIdStr = toHex(taskId);
    const chunkIdStr = chunkHex;
    const creditsEarned = pending.creditsPerChunk;

    if (result.status === ChunkStatus.SUCCESS) {
      // Pay the executor what was agreed in the bid
      this.ledger.earnCredits(executorHex, myHex, creditsEarned, taskIdStr, chunkIdStr);
      this.ledger.recordCompletion(executorHex, true);

      // Fix 7: Resource honesty — compare reported execution time against deadline
      // If executor claims it took way longer than the deadline, it's dishonest
      const chunk = pending.plan.chunks.find(c => toHex(c.chunkId) === chunkHex);
      if (chunk && result.executionTimeMs > 0) {
        const timeRatio = result.executionTimeMs / chunk.timeoutMs;
        // Honest if execution finished within 2x the timeout (generous margin)
        this.ledger.recordResourceHonesty(executorHex, timeRatio <= 2.0);
      }
    } else {
      // Failed — record failure, no payment
      this.ledger.recordFailure(executorHex);
    }

    if (completion) {
      // All chunks assembled — clean up and resolve
      clearTimeout(pending.timeout);
      if (pending.heartbeatTimer) clearInterval(pending.heartbeatTimer);
      this.pendingTasks.delete(taskHex);

      log.info(`Task ${shortId(taskId)} COMPLETE via remote execution`, {
        chunksExecuted: completion.chunksExecuted,
        devicesUsed: completion.devicesUsed,
        totalTimeMs: completion.totalTimeMs,
        verified: completion.verificationResult.valid,
      });

      this.bus.emit('task:complete', {
        taskId,
        timeMs: completion.totalTimeMs,
        devicesUsed: completion.devicesUsed,
      });

      // Generate Computation Certificate if requested
      let certificate: ComputationCertificate | undefined;
      if (pending.certify && pending.inputData) {
        try {
          certificate = this.generateTaskCertificate(
            pending, completion, pending.wasmModule, pending.inputData, pending.entryPoint
          );
        } catch (certErr: any) {
          log.warn(`Certificate generation failed: ${certErr.message}`);
        }
      }

      // MCL: Generate MER from task completion (v1.2)
      let mclExperienceGenerated = false;
      if (this.mclEngine.isActive()) {
        const mer = this.mclEngine.onTaskComplete({
          taskType: 0, // TaskType from pending task (default: INFERENCE)
          deviceCount: completion.devicesUsed,
          strategyUsed: 0, // DATA_PARALLEL default
          chunkCount: completion.chunksExecuted,
          avgChunkSizeKb: Math.ceil((pending.inputData?.length || 1024) / 1024 / Math.max(1, completion.chunksExecuted)),
          totalTimeMs: completion.totalTimeMs,
          distributionOverheadMs: 0,
          executionEfficiency: Math.round(completion.verificationResult.valid ? 85 : 50),
          faultEvents: 0,
          reassignmentCount: 0,
          verified: completion.verificationResult.valid,
        });
        mclExperienceGenerated = mer !== null;
      }

      pending.resolve({
        taskId: completion.taskId,
        data: completion.result,
        totalTimeMs: completion.totalTimeMs,
        chunksExecuted: completion.chunksExecuted,
        devicesUsed: completion.devicesUsed,
        verified: completion.verificationResult.valid,
        localFallback: false,
        certificate,
      });
    } else {
      log.debug(`Task ${shortId(taskId)}: ${pending.resultsReceived}/${pending.expectedResults} results received`);
    }
  }

  // ── Heartbeat Monitoring ──

  /**
   * Process a HEARTBEAT from an executor proving it's alive.
   * Resets the missed-beat counter for that chunk.
   */
  private handleHeartbeat(payload: Uint8Array): void {
    const wire = decodeJSON<HeartbeatWire>(payload);
    if (!wire) return;

    const taskId = new Uint8Array(wire.taskId);
    const chunkId = new Uint8Array(wire.chunkId);
    const taskHex = toHex(taskId);
    const chunkHex = toHex(chunkId);

    const pending = this.pendingTasks.get(taskHex);
    if (!pending) return;

    const monitor = pending.chunkMonitors.get(chunkHex);
    if (!monitor || monitor.dead) return;

    // Reset heartbeat tracking
    monitor.lastBeat = Date.now();
    monitor.missedBeats = 0;

    this.bus.emit('heartbeat:received', { meshId: new Uint8Array(wire.executorId), taskId });

    log.debug(`Heartbeat from ${shortId(new Uint8Array(wire.executorId))} for chunk ${shortId(chunkId)}`);
  }

  /**
   * Process a DEPARTURE_NOTICE — a peer is shutting down gracefully.
   * Immediately mark all chunks from that executor as dead and fall back locally.
   */
  private handleDeparture(payload: Uint8Array): void {
    const wire = decodeJSON<DepartureNoticeWire>(payload);
    if (!wire) return;

    const departingId = new Uint8Array(wire.meshId);
    const departingHex = toHex(departingId);

    log.info(`Departure notice from ${shortId(departingId)}`);
    this.bus.emit('departure:received', { meshId: departingId });

    // Find all pending chunks assigned to the departing executor and reassign
    for (const [taskHex, pending] of this.pendingTasks) {
      for (const [chunkHex, monitor] of pending.chunkMonitors) {
        if (monitor.dead) continue;

        // Check if this chunk was assigned to the departing peer
        const chunkIndex = pending.plan.chunks.findIndex(c => toHex(c.chunkId) === chunkHex);
        const chunk = chunkIndex >= 0 ? pending.plan.chunks[chunkIndex] : undefined;
        if (chunk && toHex(chunk.assigneeId) === departingHex) {
          log.warn(`Executor ${shortId(departingId)} departed, reassigning chunk ${shortId(chunk.chunkId)}`);
          monitor.dead = true;
          pending.chunkMonitors.delete(chunkHex);

          this.bus.emit('executor:dead', {
            meshId: departingId,
            taskId: chunk.taskId,
          });

          // Graceful departure — no reputation penalty, just reassign
          this.ledger.recordAvailability(departingHex, false);

          this.reassignDeadChunk(taskHex, chunk, pending, chunkIndex);
        }
      }
    }
  }

  /**
   * Process a CHECKPOINT_STORE from an executor.
   * Stores the checkpoint snapshot so it can be forwarded to a replacement
   * executor if the current one dies (via reassignDeadChunk).
   */
  private handleCheckpointStore(payload: Uint8Array): void {
    const wire = decodeJSON<CheckpointStoreWire>(payload);
    if (!wire) return;

    const taskHex = toHex(new Uint8Array(wire.taskId));
    const chunkHex = toHex(new Uint8Array(wire.chunkId));

    const pending = this.pendingTasks.get(taskHex);
    if (!pending) return;

    // Store checkpoint (overwrite previous — only keep latest)
    if (!pending.checkpoints) pending.checkpoints = new Map();
    pending.checkpoints.set(chunkHex, {
      data: new Uint8Array(wire.encryptedCheckpoint),
      stepsCompleted: wire.stepsCompleted,
    });

    log.debug(`Checkpoint stored: chunk ${chunkHex.substring(0, 8)} step ${wire.stepsCompleted}`);
    this.bus.emit('checkpoint:stored', {
      chunkId: new Uint8Array(wire.chunkId),
      taskId: new Uint8Array(wire.taskId),
      stepsCompleted: wire.stepsCompleted,
    });
  }

  /**
   * Periodic heartbeat check — called every heartbeatIntervalMs.
   * Increments missed-beat counters and triggers local fallback for dead executors.
   */
  private checkHeartbeats(taskHex: string): void {
    const pending = this.pendingTasks.get(taskHex);
    if (!pending) return;

    const now = Date.now();
    const interval = this.config.heartbeatIntervalMs;

    for (const [chunkHex, monitor] of pending.chunkMonitors) {
      if (monitor.dead) continue;

      const elapsed = now - monitor.lastBeat;
      const newMissed = Math.floor(elapsed / interval);

      if (newMissed > monitor.missedBeats) {
        monitor.missedBeats = newMissed;

        // Find the chunk and its index
        const chunkIndex = pending.plan.chunks.findIndex(c => toHex(c.chunkId) === chunkHex);
        const chunk = chunkIndex >= 0 ? pending.plan.chunks[chunkIndex] : undefined;
        const chunkShort = chunk ? shortId(chunk.chunkId) : chunkHex.substring(0, 8);

        if (monitor.missedBeats >= this.config.deadThreshold) {
          // Dead — try reassignment to another peer, then local fallback
          log.warn(`Executor dead for chunk ${chunkShort}: ${monitor.missedBeats} missed heartbeats`);
          monitor.dead = true;
          pending.chunkMonitors.delete(chunkHex);

          if (chunk) {
            this.bus.emit('executor:dead', {
              meshId: chunk.assigneeId,
              taskId: chunk.taskId,
            });

            // Record failure for the dead executor
            this.ledger.recordFailure(toHex(chunk.assigneeId));
            this.ledger.recordAvailability(toHex(chunk.assigneeId), false);

            this.reassignDeadChunk(taskHex, chunk, pending, chunkIndex);
          }
        } else if (monitor.missedBeats >= this.config.suspectThreshold) {
          // Suspected — warn but keep waiting
          log.warn(`Executor suspected for chunk ${chunkShort}: ${monitor.missedBeats} missed heartbeats`);

          if (chunk) {
            this.bus.emit('executor:suspected', {
              meshId: chunk.assigneeId,
              missedBeats: monitor.missedBeats,
            });
          }
        }
      }
    }
  }

  /**
   * Reassign a dead chunk: try another mesh peer first, fall back to local.
   *
   * Flow per spec Section 6.2:
   *   1. Mark chunk as ORPHANED
   *   2. Find another active peer (exclude the dead executor)
   *   3. Send CHUNK_DATA to the new peer with URGENT priority
   *   4. If no peer available or send fails, execute locally
   */
  private async reassignDeadChunk(
    taskHex: string,
    chunk: any,
    pending: any,
    chunkIndex: number
  ): Promise<void> {
    const chunkHex = toHex(chunk.chunkId);
    const deadAssigneeHex = toHex(chunk.assigneeId);

    // Find active peers excluding the dead executor
    const activePeers = this.peerTable.getActive().filter(
      p => toHex(p.meshId) !== deadAssigneeHex && toHex(p.meshId) !== this.meshIdHex()
    );

    if (activePeers.length > 0) {
      // Pick the best peer (first active = most recently seen)
      const newPeer = activePeers[0];
      const newAddress = this.discovery.resolveAddress(newPeer.meshId);

      if (newAddress) {
        log.info(`Reassigning chunk ${shortId(chunk.chunkId)} to ${shortId(newPeer.meshId)}`);

        try {
          // Build CHUNK_DATA for the new executor
          const inputData = pending.plan.inputChunks[chunkIndex];
          const encryptedPayload = inputData && inputData.length > 0
            ? encrypt(inputData, pending.sessionKey)
            : new Uint8Array(0);

          const moduleHash = this.codeCache.store(pending.wasmModule);

          // Check if we have a checkpoint for this chunk
          const checkpoint = pending.checkpoints?.get(chunkHex);
          if (checkpoint) {
            log.info(`Including checkpoint (step ${checkpoint.stepsCompleted}) in reassignment`);
          }

          const wire: ChunkDataWire = {
            taskId: Array.from(chunk.taskId),
            chunkId: Array.from(chunk.chunkId),
            sequence: chunk.sequence,
            totalChunks: chunk.totalChunks,
            wasmModule: Array.from(pending.wasmModule),
            entryPoint: pending.entryPoint,
            moduleHash: Array.from(moduleHash),
            sessionKey: Array.from(pending.sessionKey),
            encryptedPayload: Array.from(encryptedPayload),
            timeoutMs: chunk.timeoutMs,
            expectedOutput: {
              format: chunk.expectedOutput.format,
              maxSizeKb: chunk.expectedOutput.maxSizeKb,
            },
            checkpoint: checkpoint ? Array.from(checkpoint.data) : undefined,
            checkpointSteps: checkpoint?.stepsCompleted,
          };

          const msg = encodeMessage(MessageType.CHUNK_DATA, encodeJSON(wire));
          await this.transport.sendTo(newAddress, msg);

          // Update the chunk's assignee
          chunk.assigneeId = newPeer.meshId;

          // Set up heartbeat monitoring for the new executor
          pending.chunkMonitors.set(chunkHex, {
            lastBeat: Date.now(),
            missedBeats: 0,
            executorAddress: newAddress,
            dead: false,
          });

          log.info(`Chunk ${shortId(chunk.chunkId)} reassigned to ${shortId(newPeer.meshId)} at ${newAddress}`);

          this.bus.emit('chunk:reassigned', {
            chunkId: chunk.chunkId,
            newAssignee: newPeer.meshId,
          });

          return; // Reassignment succeeded
        } catch (err: any) {
          log.warn(`Reassignment to ${shortId(newPeer.meshId)} failed: ${err.message}`);
          // Fall through to local execution
        }
      }
    }

    // No peers available or reassignment failed — execute locally
    log.info(`No peers available for reassignment, executing chunk ${shortId(chunk.chunkId)} locally`);
    await this.executeDeadChunkLocally(taskHex, chunk, pending);
  }

  /**
   * Execute a dead chunk locally as fallback.
   * Feeds the result into the pending task's assembler.
   */
  private async executeDeadChunkLocally(
    taskHex: string,
    chunk: { chunkId: Uint8Array; taskId: Uint8Array; sequence: number; totalChunks: number; codeRef: any; expectedOutput: any; timeoutMs: number },
    pending: {
      assembler: ResultAssembler;
      plan: DecompositionPlan;
      sessionKey: SessionKey;
      wasmModule: Uint8Array;
      entryPoint: string;
      resolve: (completion: any) => void;
      reject: (err: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
      heartbeatTimer?: ReturnType<typeof setInterval>;
      resultsReceived: number;
      expectedResults: number;
      chunkMonitors: Map<string, any>;
    }
  ): Promise<void> {
    const chunkIndex = pending.plan.chunks.findIndex(c => toHex(c.chunkId) === toHex(chunk.chunkId));
    if (chunkIndex === -1) return;

    log.info(`Executing dead chunk ${shortId(chunk.chunkId)} locally as fallback`);

    try {
      // Get the input data for this chunk
      const inputData = pending.plan.inputChunks[chunkIndex];
      if (!inputData || inputData.length === 0) {
        log.warn(`No input data for chunk ${shortId(chunk.chunkId)}`);
        return;
      }

      // Encrypt input with session key (same as remote would)
      const encryptedPayload = encrypt(inputData, pending.sessionKey);

      // Build a full CMPChunk for ExecutionEngine
      const fullChunk = {
        ...pending.plan.chunks[chunkIndex],
        payload: encryptedPayload,
      };

      const result = await this.executionEngine.executeChunk(
        fullChunk,
        pending.sessionKey,
        pending.wasmModule
      );

      log.info(`Local fallback for chunk ${shortId(chunk.chunkId)}: ${ChunkStatus[result.status]}`);

      // Feed to assembler
      const completion = pending.assembler.collectResult(result);
      pending.resultsReceived++;

      this.bus.emit('chunk:reassigned', {
        chunkId: chunk.chunkId,
        newAssignee: this.discovery.getMeshId(),
      });

      if (completion) {
        clearTimeout(pending.timeout);
        if (pending.heartbeatTimer) clearInterval(pending.heartbeatTimer);
        this.pendingTasks.delete(taskHex);

        log.info(`Task ${shortId(chunk.taskId)} COMPLETE (with local fallback)`, {
          chunksExecuted: completion.chunksExecuted,
          devicesUsed: completion.devicesUsed,
          totalTimeMs: completion.totalTimeMs,
        });

        this.bus.emit('task:complete', {
          taskId: chunk.taskId,
          timeMs: completion.totalTimeMs,
          devicesUsed: completion.devicesUsed,
        });

        pending.resolve({
          taskId: completion.taskId,
          data: completion.result,
          totalTimeMs: completion.totalTimeMs,
          chunksExecuted: completion.chunksExecuted,
          devicesUsed: completion.devicesUsed,
          verified: completion.verificationResult.valid,
          localFallback: false, // Partial fallback, not full
        });
      }
    } catch (err: any) {
      log.warn(`Local fallback execution failed for chunk ${shortId(chunk.chunkId)}: ${err.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Certification Layer (Layer 7) — Inlined to avoid import issues
// ══════════════════════════════════════════════════════════════

export interface AttestationInput {
  meshId: Uint8Array;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  architecture: string;
  cores: number;
  memoryMb: number;
  result: { executionTimeMs: number; resourceUsed: { memoryPeakMb: number; cpuMs: number; gpuMs: number }; status: number; payload: Uint8Array; chunkId: Uint8Array; taskId: Uint8Array; executorId: Uint8Array; proof: Uint8Array; signature: Uint8Array };
  outputHash: Uint8Array;
}

export interface CertificateRequest {
  wasmModule: Uint8Array;
  entryPoint: string;
  inputData: Uint8Array;
  outputData: Uint8Array;
  strategy: string;
  verificationMode: string;
  totalChunks: number;
  totalTimeMs: number;
  requesterId: Uint8Array;
  requesterSecretKey: Uint8Array;
  attestations: AttestationInput[];
}

function buildCanonicalPayload(
  certId: string,
  codeHash: Uint8Array,
  inputHash: Uint8Array,
  outputHash: Uint8Array,
  executionTimeMs: number
): Uint8Array {
  const text = `CMP-CERT:${certId}:${toHex(codeHash)}:${toHex(inputHash)}:${toHex(outputHash)}:${executionTimeMs}`;
  return hash256(new TextEncoder().encode(text));
}

function hashCertificate(cert: ComputationCertificate): Uint8Array {
  const parts = [
    cert.certId,
    toHex(cert.codeHash),
    toHex(cert.inputHash),
    toHex(cert.outputHash),
    cert.deviceCount.toString(),
    cert.consensus.toString(),
    ...cert.attestations.map(a => toHex(a.signature)),
  ];
  return hash256(new TextEncoder().encode(parts.join(':')));
}

function certFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function generateCertificate(req: CertificateRequest): ComputationCertificate {
  const certId = `cmp-cert-${Date.now()}-${toHex(hash256(new Uint8Array([
    ...req.requesterId, ...hash256(req.wasmModule).slice(0, 8),
  ]))).substring(0, 12)}`;

  const codeHash = hash256(req.wasmModule);
  const inputHash = hash256(req.inputData);
  const outputHash = hash256(req.outputData);

  const attestations: DeviceAttestation[] = [];

  for (const att of req.attestations) {
    const canonicalPayload = buildCanonicalPayload(
      certId, codeHash, inputHash, att.outputHash, att.result.executionTimeMs
    );
    const signature = sign(canonicalPayload, att.secretKey);

    attestations.push({
      meshId: att.meshId,
      publicKey: att.publicKey,
      architecture: att.architecture,
      cores: att.cores,
      memoryMb: att.memoryMb,
      executionTimeMs: att.result.executionTimeMs,
      memoryPeakMb: att.result.resourceUsed.memoryPeakMb,
      outputHash: att.outputHash,
      completedAt: Date.now(),
      signature,
    });
  }

  const outputHashHex = toHex(outputHash);
  const agreeingDevices = attestations.filter(a => toHex(a.outputHash) === outputHashHex).length;
  const consensus = attestations.length > 0 ? agreeingDevices / attestations.length : 0;
  const archSet = new Set(attestations.map(a => a.architecture));

  let signaturesValid = true;
  for (const att of attestations) {
    const canonical = buildCanonicalPayload(certId, codeHash, inputHash, att.outputHash, att.executionTimeMs);
    if (!verify(canonical, att.signature, att.publicKey)) {
      signaturesValid = false;
    }
  }

  const cert: ComputationCertificate = {
    version: '1.0',
    certId,
    codeHash,
    entryPoint: req.entryPoint,
    inputHash,
    outputHash,
    outputData: req.outputData,
    strategy: req.strategy,
    verificationMode: req.verificationMode,
    totalChunks: req.totalChunks,
    totalTimeMs: req.totalTimeMs,
    deviceCount: attestations.length,
    attestations,
    consensus,
    uniqueArchitectures: archSet.size,
    signaturesValid,
    issuedAt: Date.now(),
    requesterId: req.requesterId,
    protocolVersion: '1.0',
    requesterSignature: new Uint8Array(64),
  };

  cert.requesterSignature = sign(hashCertificate(cert), req.requesterSecretKey);
  return cert;
}

export function verifyCertificate(cert: ComputationCertificate): CertificateVerification {
  const issues: string[] = [];
  let validSignatures = 0;

  if (cert.version !== '1.0') {
    issues.push(`Unknown certificate version: ${cert.version}`);
  }

  if (!cert.attestations || cert.attestations.length === 0) {
    return {
      valid: false, validSignatures: 0, totalSignatures: 0,
      consensusValid: false, consensusRatio: 0, uniqueArchitectures: 0,
      summary: 'Invalid: no device attestations', issues,
    };
  }

  for (let i = 0; i < cert.attestations.length; i++) {
    const att = cert.attestations[i];
    const canonical = buildCanonicalPayload(cert.certId, cert.codeHash, cert.inputHash, att.outputHash, att.executionTimeMs);
    if (verify(canonical, att.signature, att.publicKey)) {
      validSignatures++;
    } else {
      issues.push(`Invalid signature from device ${i + 1} (${toHex(att.meshId).substring(0, 8)})`);
    }
  }

  const certOutputHex = toHex(cert.outputHash);
  let agreeCount = 0;
  for (const att of cert.attestations) {
    if (toHex(att.outputHash) === certOutputHex) agreeCount++;
    else issues.push(`Device ${toHex(att.meshId).substring(0, 8)} produced different output`);
  }
  const consensusRatio = cert.attestations.length > 0 ? agreeCount / cert.attestations.length : 0;
  const consensusValid = consensusRatio > 0.5;

  if (cert.outputData && cert.outputData.length > 0) {
    if (toHex(hash256(cert.outputData)) !== certOutputHex) {
      issues.push('Output data does not match output hash');
    }
  }

  const archSet = new Set(cert.attestations.map(a => a.architecture));
  const times = cert.attestations.map(a => a.executionTimeMs);
  if (times.length > 1 && times.every(t => t === times[0])) {
    issues.push('All devices report identical execution times — may indicate coordinated forgery');
  }

  const keySet = new Set(cert.attestations.map(a => toHex(a.publicKey)));
  if (keySet.size < cert.attestations.length) {
    issues.push(`Duplicate public keys detected: ${cert.attestations.length - keySet.size} duplicates`);
  }

  const valid = validSignatures === cert.attestations.length && consensusValid && issues.length === 0;
  const summary = valid
    ? `Valid: ${cert.deviceCount} devices, ${(consensusRatio * 100).toFixed(0)}% consensus, ${archSet.size} architecture${archSet.size > 1 ? 's' : ''}, all signatures verified`
    : `Invalid: ${issues.length} issue${issues.length > 1 ? 's' : ''} found`;

  return { valid, validSignatures, totalSignatures: cert.attestations.length, consensusValid, consensusRatio, uniqueArchitectures: archSet.size, summary, issues };
}

export function exportCertificateJSON(cert: ComputationCertificate): string {
  return JSON.stringify({
    version: cert.version, certId: cert.certId,
    codeHash: toHex(cert.codeHash), entryPoint: cert.entryPoint,
    inputHash: toHex(cert.inputHash), outputHash: toHex(cert.outputHash),
    outputData: cert.outputData ? toHex(cert.outputData) : undefined,
    strategy: cert.strategy, verificationMode: cert.verificationMode,
    totalChunks: cert.totalChunks, totalTimeMs: cert.totalTimeMs,
    deviceCount: cert.deviceCount,
    attestations: cert.attestations.map(a => ({
      meshId: toHex(a.meshId), publicKey: toHex(a.publicKey),
      architecture: a.architecture, cores: a.cores, memoryMb: a.memoryMb,
      executionTimeMs: a.executionTimeMs, memoryPeakMb: a.memoryPeakMb,
      outputHash: toHex(a.outputHash), completedAt: a.completedAt,
      signature: toHex(a.signature),
    })),
    consensus: cert.consensus, uniqueArchitectures: cert.uniqueArchitectures,
    signaturesValid: cert.signaturesValid, issuedAt: cert.issuedAt,
    requesterId: toHex(cert.requesterId), protocolVersion: cert.protocolVersion,
    requesterSignature: toHex(cert.requesterSignature),
  }, null, 2);
}

export function importCertificateJSON(json: string): ComputationCertificate {
  const o = JSON.parse(json);
  return {
    version: o.version, certId: o.certId,
    codeHash: certFromHex(o.codeHash), entryPoint: o.entryPoint,
    inputHash: certFromHex(o.inputHash), outputHash: certFromHex(o.outputHash),
    outputData: o.outputData ? certFromHex(o.outputData) : undefined,
    strategy: o.strategy, verificationMode: o.verificationMode,
    totalChunks: o.totalChunks, totalTimeMs: o.totalTimeMs,
    deviceCount: o.deviceCount,
    attestations: o.attestations.map((a: any) => ({
      meshId: certFromHex(a.meshId), publicKey: certFromHex(a.publicKey),
      architecture: a.architecture, cores: a.cores, memoryMb: a.memoryMb,
      executionTimeMs: a.executionTimeMs, memoryPeakMb: a.memoryPeakMb,
      outputHash: certFromHex(a.outputHash), completedAt: a.completedAt,
      signature: certFromHex(a.signature),
    })),
    consensus: o.consensus, uniqueArchitectures: o.uniqueArchitectures,
    signaturesValid: o.signaturesValid, issuedAt: o.issuedAt,
    requesterId: certFromHex(o.requesterId), protocolVersion: o.protocolVersion,
    requesterSignature: certFromHex(o.requesterSignature),
  };
}