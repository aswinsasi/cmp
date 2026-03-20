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

import { ITransport } from '../../transport/src/interface';
import { LANTransport } from '../../transport/src/lan-transport';
import { MultiTransport } from '../../transport/src/multi-transport';
import { VirtualTransport, VirtualNetwork } from '../../transport/src/virtual-transport';

import {
  MeshId, TaskId, SessionKey, Hash256,
  TaskType, Runtime, Priority, VerifyMode, SecurityLevel, EncryptionAlgo,
  ChunkStatus,
  CMPConfig, DEFAULT_CONFIG, resolveConfig,
  EventBus,
  PeerTable,
  DiscoveryLayer,
  DeviceProfiler,
  CapabilityMap,
  CapabilityExchange,
  NegotiationEngine,
  BidHandler,
  generateSigningKeyPair,
  randomBytes,
  encrypt, decrypt, hash256,
  toHex, shortId,
  Logger, LogLevel,
} from './';

import type {
  CMPEvents, PeerEntry, MeshResources, ComputeRequest,
  NegotiationResult, AssignmentRecord, ScoredCandidate,
} from './';

import {
  WASMSandbox,
  CodeCache,
  DataSplitter,
  TaskDistributor,
  ExecutionEngine,
  ResultAssembler,
} from '../../runtime/src';

import type { DecompositionPlan } from '../../runtime/src';

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
  private lanTransport?: LANTransport;

  private running = false;
  private startTime = 0;

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

    // Layer 3: Negotiation
    const signingKP = generateSigningKeyPair();
    this.negotiation = new NegotiationEngine(
      this.discovery.getMeshId(),
      signingKP,
      this.transport,
      this.bus,
      this.peerTable,
      this.capMap,
      this.discovery,
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
      {
        acceptingTasks: this.config.acceptingTasks,
        maxConcurrentTasks: this.config.maxConcurrentTasks,
        minBatteryPct: this.config.minBatteryPct,
        maxBidResourceShare: this.config.maxResourceShare,
      }
    );

    // Layers 4-6: Distribution, Execution, Assembly
    this.codeCache = new CodeCache(100);
    this.executionEngine = new ExecutionEngine(
      this.discovery.getMeshId(),
      this.codeCache,
      { maxConcurrent: this.config.maxConcurrentTasks }
    );
    this.distributor = new TaskDistributor();
    this.splitter = new DataSplitter();

    log.info(`CMPNode created: ${shortId(this.discovery.getMeshId())}`);
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

    // Wire up chunk execution for incoming assignments
    this.bus.on('chunk:received', (data) => {
      this.handleIncomingChunk(data.chunkId, data.taskId);
    });

    this.running = true;
    this.startTime = Date.now();

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

    await this.bidHandler.stop();
    await this.negotiation.stop();
    await this.capExchange.stop();
    await this.discovery.stop();
    await this.transport.stop();

    this.peerTable.destroy();
    this.profiler.destroy();
    this.bus.clear();
    this.capMap.clear();
    this.codeCache.clear();

    log.info('CMPNode stopped');
    this.bus.emit('node:stopped', {});
  }

  // ══════════════════════════════════════════
  // Compute API
  // ══════════════════════════════════════════

  /**
   * Submit a computation task to the mesh.
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
        verifyMode: options.verifyMode ?? VerifyMode.CHECKSUM,
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

    // Phase 3: Execute (in a real mesh, chunks would be sent to executors)
    // For now, simulate by executing chunks locally using the sandbox
    const sessionKey = randomBytes(32);
    const assembler = new ResultAssembler(plan, sessionKey);

    for (let i = 0; i < plan.chunks.length; i++) {
      const chunk = plan.chunks[i];
      // Encrypt the chunk payload with session key
      const encryptedPayload = plan.inputChunks[i] && plan.inputChunks[i].length > 0
        ? encrypt(plan.inputChunks[i], sessionKey)
        : new Uint8Array(0);

      const chunkWithPayload = { ...chunk, payload: encryptedPayload };

      const result = await this.executionEngine.executeChunk(
        chunkWithPayload,
        sessionKey,
        wasmModule
      );

      const completion = assembler.collectResult(result);
      if (completion) {
        return {
          taskId: completion.taskId,
          data: completion.result,
          totalTimeMs: Date.now() - startTime,
          chunksExecuted: completion.chunksExecuted,
          devicesUsed: completion.devicesUsed,
          verified: completion.verificationResult.valid,
          localFallback: false,
        };
      }
    }

    // If we get here, not all chunks succeeded
    log.warn('Not all chunks completed, falling back to local execution');
    return this.executeLocally(wasmModule, inputData, entryPoint, startTime);
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
      credits: this.config.bootstrapCredits, // TODO: integrate ledger
      reputation: 5000, // TODO: integrate reputation tracker
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
   * Set whether this node accepts tasks from others.
   */
  setAcceptingTasks(accepting: boolean): void {
    this.bidHandler.setAcceptingTasks(accepting);
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

  // ── Internal ──

  private handleIncomingChunk(chunkId: Uint8Array, taskId: Uint8Array): void {
    log.debug(`Incoming chunk ${shortId(chunkId)} for task ${shortId(taskId)}`);
    // In full implementation, this would:
    // 1. Look up the chunk from the requester
    // 2. Download the WASM module if not cached
    // 3. Execute in sandbox
    // 4. Send result back
    // For now, this is handled by the BidHandler → ExecutionEngine pipeline
  }
}
