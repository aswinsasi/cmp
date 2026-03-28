/**
 * CMP Bid Handler
 * Executor side of the negotiation: receives task requests from the mesh,
 * evaluates whether to bid, and submits bids.
 *
 * Decision process:
 *   1. Receive TASK_REQUEST broadcast
 *   2. Check: am I accepting tasks? enough battery? not throttled?
 *   3. Check: do I support the required runtime?
 *   4. Check: do I have enough resources?
 *   5. Estimate completion time
 *   6. Calculate price in credits
 *   7. Create and send bid
 *
 * @module layers/bid-handler
 * @author Agent Viscro
 */

import { ITransport, TransportEvent } from '../../../transport/src/interface';
import {
  CMPTaskRequest,
  CMPChunk,
  TaskType,
  ComputeBudget,
  Priority,
  OutputFormat,
} from '../types/task';
import { CMPBid } from '../types/negotiation';
import { ChunkStatus } from '../types/result';
import {
  CMPCapability,
  PowerSource,
  ThermalState,
  Runtime,
} from '../types/capability';
import { MeshId, TaskId } from '../types/primitives';
import { MessageType } from '../types/beacon';
import { EventBus } from '../mesh/event-bus';
import { DeviceProfiler } from './profiler';
import { DiscoveryLayer } from './discovery';
import { encodeMessage, decodeMessage, encodeJSON, decodeJSON } from './serializer';
import type { ChunkDataWire, ChunkResultWire, HeartbeatWire, CheckpointStoreWire } from './serializer';
import { randomBytes, encrypt, decrypt, hash256 } from '../crypto';
import { toHex, shortId } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { IncentiveLedger } from '../incentive/ledger';

import { WASMSandbox } from '../../../runtime/src/wasm-sandbox';
import { CodeCache } from '../../../runtime/src/code-cache';
import { ExecutionEngine } from '../../../runtime/src/execution-engine';
import { detectRuntime } from '../../../runtime/src/multi-runtime';

const log = new Logger('BidHandler');

export interface BidHandlerConfig {
  /** Whether to accept incoming task requests */
  acceptingTasks: boolean;
  /** Maximum concurrent tasks to execute */
  maxConcurrentTasks: number;
  /** Minimum battery percentage to accept tasks */
  minBatteryPct: number;
  /** Maximum fraction of resources to offer in a single bid */
  maxBidResourceShare: number;
  /** Heartbeat interval during execution (ms) */
  heartbeatIntervalMs: number;
  /** Checkpoint interval for step-based WASM modules (ms) */
  checkpointIntervalMs: number;
}

const DEFAULT_BID_CONFIG: BidHandlerConfig = {
  acceptingTasks: true,
  maxConcurrentTasks: 3,
  minBatteryPct: 15,
  maxBidResourceShare: 0.7,
  heartbeatIntervalMs: 2000,
  checkpointIntervalMs: 10000,
};

export class BidHandler {
  private config: BidHandlerConfig;
  private transport: ITransport;
  private bus: EventBus;
  private profiler: DeviceProfiler;
  private discovery: DiscoveryLayer;
  private meshId: MeshId;
  private running = false;

  /** Execution engine for running received chunks */
  private executionEngine: ExecutionEngine;
  private codeCache: CodeCache;
  private ledger: IncentiveLedger;

  /** Currently active tasks being executed */
  private activeTasks = 0;

  /** Track tasks we've already bid on to avoid duplicates */
  private bidHistory = new Map<string, number>(); // taskHex → timestamp

  /** Track credits we bid per task so we can report earnings accurately */
  private taskCredits = new Map<string, number>(); // taskHex → creditsRequested

  /** Bid history cleanup interval */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** Stats */
  private stats = {
    tasksReceived: 0,
    bidsSubmitted: 0,
    bidsSkipped: 0,
    chunksExecuted: 0,
    chunksFailed: 0,
  };

  constructor(
    meshId: MeshId,
    transport: ITransport,
    bus: EventBus,
    profiler: DeviceProfiler,
    discovery: DiscoveryLayer,
    executionEngine: ExecutionEngine,
    codeCache: CodeCache,
    ledger: IncentiveLedger,
    config?: Partial<BidHandlerConfig>
  ) {
    this.meshId = meshId;
    this.transport = transport;
    this.bus = bus;
    this.profiler = profiler;
    this.discovery = discovery;
    this.executionEngine = executionEngine;
    this.codeCache = codeCache;
    this.ledger = ledger;
    this.config = { ...DEFAULT_BID_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Listen for incoming task requests
    this.transport.on('message', (event) => {
      this.onMessage(event);
    });

    // Cleanup old bid history every 60s
    this.cleanupTimer = setInterval(() => {
      this.cleanupBidHistory();
    }, 60000);

    this.running = true;
    log.info('Bid handler started', {
      accepting: this.config.acceptingTasks,
      maxConcurrent: this.config.maxConcurrentTasks,
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.bidHistory.clear();
  }

  /**
   * Notify that a task execution has started (reduces available slots).
   */
  taskStarted(): void {
    this.activeTasks++;
  }

  /**
   * Notify that a task execution has finished (frees a slot).
   */
  taskFinished(): void {
    this.activeTasks = Math.max(0, this.activeTasks - 1);
  }

  /**
   * Get handler statistics.
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Set whether this node is accepting tasks.
   */
  setAcceptingTasks(accepting: boolean): void {
    this.config.acceptingTasks = accepting;
    log.info(`Accepting tasks: ${accepting}`);
  }

  // ── Message Handling ──

  private onMessage(event: TransportEvent): void {
    if (!this.running || !event.data) return;

    const msg = decodeMessage(event.data);
    if (!msg) return;

    switch (msg.type) {
      case MessageType.TASK_REQUEST:
        this.handleTaskRequest(msg.payload, event.peerAddress).catch((err) => {
          log.warn(`Error handling task request: ${err.message}`);
        });
        break;
      case MessageType.ASSIGNMENT:
        this.handleAssignment(msg.payload, event.peerAddress);
        break;
      case MessageType.CHUNK_DATA:
        this.handleChunkData(msg.payload, event.peerAddress).catch((err) => {
          log.warn(`Error handling chunk data: ${err.message}`);
        });
        break;
    }
  }

  private async handleTaskRequest(payload: Uint8Array, peerAddress?: string): Promise<void> {
    const data = decodeJSON<any>(payload);
    if (!data) return;

    this.stats.tasksReceived++;

    const taskId = new Uint8Array(data.taskId);
    const requesterId = new Uint8Array(data.requesterId);
    const taskHex = toHex(taskId);

    // Don't bid on our own tasks
    if (toHex(requesterId) === toHex(this.meshId)) return;

    // Don't bid twice on the same task (set early to prevent race conditions)
    if (this.bidHistory.has(taskHex)) return;
    this.bidHistory.set(taskHex, Date.now());

    log.info(`Task request received from ${shortId(requesterId)}: ${shortId(taskId)}`, {
      type: data.taskType,
      priority: data.priority,
    });

    // Build task request object
    const request: CMPTaskRequest = {
      taskId,
      requesterId,
      taskType: data.taskType,
      runtimeRequired: data.runtimeRequired,
      payloadSizeKb: data.payloadSizeKb,
      computeBudget: data.computeBudget,
      security: data.security,
      chunkHint: data.chunkHint,
      priority: data.priority,
      creditsOffered: data.creditsOffered,
      signature: new Uint8Array(64),
    };

    // Evaluate and maybe bid
    const bid = await this.evaluateAndBid(request);
    if (!bid) {
      this.stats.bidsSkipped++;
      return;
    }

    // Resolve requester address
    const requesterAddress = peerAddress || this.discovery.resolveAddress(requesterId);
    if (!requesterAddress) {
      log.warn(`Cannot resolve address for requester ${shortId(requesterId)}`);
      return;
    }

    // Send bid
    await this.sendBid(bid, requesterAddress);
    this.stats.bidsSubmitted++;

    // Remember what we bid so we can report accurate earnings on chunk completion
    this.taskCredits.set(taskHex, bid.creditsRequested);
  }

  // ── Bid Evaluation ──

  private async evaluateAndBid(request: CMPTaskRequest): Promise<CMPBid | null> {
    // Gate 0: Reputation check — are we allowed to participate?
    const myHex = toHex(this.meshId);
    if (!this.ledger.canParticipate(myHex)) {
      const rep = this.ledger.getReputation(myHex);
      log.warn(`Skipping bid: reputation too low (${rep}). Execute small tasks to recover.`);
      return null;
    }

    // Gate 1: Are we accepting tasks?
    if (!this.config.acceptingTasks) {
      log.info(`Skipping bid: not accepting tasks`);
      return null;
    }

    // Gate 2: Do we have capacity?
    if (this.activeTasks >= this.config.maxConcurrentTasks) {
      log.info(`Skipping bid: at capacity (${this.activeTasks}/${this.config.maxConcurrentTasks})`);
      return null;
    }

    // Gate 3: Get current profile
    const profile = this.profiler.getLastProfile();
    if (!profile) {
      log.debug('Skipping bid: no profile available');
      return null;
    }

    // Gate 4: Battery check
    if (
      profile.power.source === PowerSource.BATTERY &&
      profile.power.batteryPct < this.config.minBatteryPct
    ) {
      log.info(`Skipping bid: low battery (${profile.power.batteryPct}%)`);
      return null;
    }

    // Gate 5: Thermal check
    if (profile.power.thermalState === ThermalState.THROTTLED) {
      log.debug('Skipping bid: device throttled');
      return null;
    }

    // Gate 6: Runtime support
    if (!profile.runtimes.includes(request.runtimeRequired)) {
      log.info(`Skipping bid: runtime ${request.runtimeRequired} not supported`);
      return null;
    }

    // Gate 7: Resource adequacy
    const offer = this.calculateOffer(profile, request.computeBudget);
    if (!offer) {
      log.debug('Skipping bid: insufficient resources');
      return null;
    }

    // Gate 8: Deadline feasibility
    const estimatedMs = this.estimateTime(profile, request);
    if (estimatedMs > request.computeBudget.deadlineMs) {
      log.info(`Skipping bid: cannot meet deadline (${estimatedMs}ms > ${request.computeBudget.deadlineMs}ms)`);
      return null;
    }

    // All gates passed — build bid
    const confidence = this.calculateConfidence(profile);
    const creditsRequested = this.calculatePrice(profile, estimatedMs, request);

    const bid: CMPBid = {
      taskId: request.taskId,
      bidderId: this.meshId,
      offeredResources: offer,
      estimatedTimeMs: estimatedMs,
      confidence,
      creditsRequested,
      signature: new Uint8Array(64),
    };

    log.info(`Bidding on task ${shortId(request.taskId)}`, {
      estimatedMs,
      confidence: confidence.toFixed(2),
      credits: creditsRequested,
    });

    return bid;
  }

  /**
   * Calculate what resources we can offer for this task.
   * Returns null if we can't meet minimum requirements.
   */
  private calculateOffer(
    profile: CMPCapability,
    budget: ComputeBudget
  ): Partial<CMPCapability> | null {
    // Calculate shareable resources
    const shareCores = Math.max(
      1,
      Math.floor(profile.cpu.coresAvailable * this.config.maxBidResourceShare)
    );
    const shareMemMb = Math.floor(
      profile.memory.availableMb * this.config.maxBidResourceShare
    );

    // Check per-device minimums
    const perDeviceMinMem = Math.ceil(
      budget.minMemoryMb / Math.max(1, budget.minCores)
    );

    if (shareMemMb < perDeviceMinMem) return null;

    // GPU check
    if (budget.gpuRequired && profile.gpu.type === 0) return null; // GPUType.NONE

    return {
      cpu: {
        ...profile.cpu,
        coresAvailable: shareCores,
      },
      memory: {
        ...profile.memory,
        availableMb: shareMemMb,
      },
      gpu: profile.gpu,
    } as Partial<CMPCapability>;
  }

  /**
   * Estimate how long this device would take to complete the task.
   */
  private estimateTime(profile: CMPCapability, request: CMPTaskRequest): number {
    // Simple heuristic based on payload size and compute power
    const payloadBytes = request.payloadSizeKb * 1024;
    const computePower = profile.cpu.coresAvailable * (profile.cpu.clockMhz || 1000);

    // Base time: payload processing at ~100 bytes per MHz-core-ms
    const baseMs = payloadBytes / (computePower * 0.1);

    // Task type multiplier
    let typeMultiplier = 1.0;
    switch (request.taskType) {
      case TaskType.INFERENCE:
        typeMultiplier = 2.0; // AI tasks are heavier
        break;
      case TaskType.MAP_REDUCE:
        typeMultiplier = 1.5;
        break;
      case TaskType.PIPELINE:
        typeMultiplier = 1.8;
        break;
      default:
        typeMultiplier = 1.0;
    }

    // Load penalty
    const loadPenalty = 1 + profile.cpu.loadPercent / 100;

    const estimated = baseMs * typeMultiplier * loadPenalty;

    // Minimum 50ms, maximum deadline
    return Math.max(50, Math.min(request.computeBudget.deadlineMs, Math.ceil(estimated)));
  }

  /**
   * Calculate self-assessed confidence (0.0 - 1.0).
   */
  private calculateConfidence(profile: CMPCapability): number {
    let confidence = 0.5; // Base

    // Power bonus
    if (profile.power.source === PowerSource.PLUGGED) {
      confidence += 0.2;
    } else if (profile.power.batteryPct > 50) {
      confidence += 0.1;
    }

    // Thermal state
    if (profile.power.thermalState === ThermalState.NOMINAL) {
      confidence += 0.1;
    } else if (profile.power.thermalState === ThermalState.WARM) {
      confidence -= 0.1;
    }

    // Low load
    if (profile.cpu.loadPercent < 30) {
      confidence += 0.1;
    }

    // Reputation factor
    confidence += (profile.reputationScore / 10000) * 0.1;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Calculate price in CCU for this task.
   */
  private calculatePrice(
    profile: CMPCapability,
    estimatedMs: number,
    request: CMPTaskRequest
  ): number {
    // Base: CPU-core-seconds used
    const cores = Math.min(
      profile.cpu.coresAvailable,
      request.computeBudget.minCores
    );
    const seconds = estimatedMs / 1000;
    const baseCCU = cores * seconds;

    // Priority multiplier
    let priorityMul = 1.0;
    switch (request.priority) {
      case Priority.LOW:
        priorityMul = 0.8;
        break;
      case Priority.HIGH:
        priorityMul = 1.5;
        break;
      case Priority.CRITICAL:
        priorityMul = 2.0;
        break;
    }

    return Math.max(1, Math.ceil(baseCCU * priorityMul));
  }

  // ── Bid Sending ──

  private async sendBid(bid: CMPBid, requesterAddress: string): Promise<void> {
    const data = {
      taskId: Array.from(bid.taskId),
      bidderId: Array.from(bid.bidderId),
      offeredResources: bid.offeredResources,
      estimatedTimeMs: bid.estimatedTimeMs,
      confidence: bid.confidence,
      creditsRequested: bid.creditsRequested,
    };

    const encoded = encodeJSON(data);
    const msg = encodeMessage(MessageType.BID, encoded);

    try {
      await this.transport.sendTo(requesterAddress, msg);
      log.info(`Bid sent to ${requesterAddress}`);
    } catch (err: any) {
      log.warn(`Failed to send bid: ${err.message}`);
    }
  }

  // ── Assignment Handling ──

  private handleAssignment(payload: Uint8Array, peerAddress?: string): void {
    const data = decodeJSON<any>(payload);
    if (!data) return;

    const taskId = new Uint8Array(data.taskId);
    const bidderId = new Uint8Array(data.bidderId);

    // Only process assignments for us
    if (toHex(bidderId) !== toHex(this.meshId)) return;

    log.info(`Assignment received for task ${shortId(taskId)}`);

    // Send ACK
    if (peerAddress) {
      this.sendAssignmentAck(taskId, peerAddress, true);
    }

    // Mark task as active
    this.taskStarted();

    // Emit event for execution layer to pick up
    this.bus.emit('chunk:received', {
      chunkId: data.chunks?.[0] ? new Uint8Array(data.chunks[0]) : randomBytes(16),
      taskId,
    });
  }

  private async sendAssignmentAck(
    taskId: TaskId,
    requesterAddress: string,
    accepted: boolean
  ): Promise<void> {
    const data = {
      taskId: Array.from(taskId),
      bidderId: Array.from(this.meshId),
      accepted,
    };

    const msg = encodeMessage(MessageType.ASSIGNMENT_ACK, encodeJSON(data));
    try {
      await this.transport.sendTo(requesterAddress, msg);
    } catch {}
  }

  // ── Cleanup ──

  private cleanupBidHistory(): void {
    const now = Date.now();
    const maxAge = 120000; // 2 minutes
    for (const [taskHex, timestamp] of this.bidHistory) {
      if (now - timestamp > maxAge) {
        this.bidHistory.delete(taskHex);
      }
    }
  }

  // ── Remote Chunk Execution ──

  /**
   * Handle incoming CHUNK_DATA: the requester is sending us actual work.
   *
   * SECURITY: Only WASM modules are accepted for execution. Non-WASM code
   * (Python, Shell, etc.) is rejected immediately with FAILED status.
   * This is the last line of defense against arbitrary code execution —
   * even if a malicious peer crafts a CHUNK_DATA message with subprocess
   * code, this handler will refuse to run it.
   *
   * For WASM: load into sandbox, decrypt payload, execute, encrypt result, send back.
   */
  private async handleChunkData(payload: Uint8Array, peerAddress?: string): Promise<void> {
    const wire = decodeJSON<ChunkDataWire>(payload);
    if (!wire) {
      log.warn('Failed to decode CHUNK_DATA payload');
      return;
    }

    const taskId = new Uint8Array(wire.taskId);
    const chunkId = new Uint8Array(wire.chunkId);
    const sessionKey = new Uint8Array(wire.sessionKey);
    const wasmModule = new Uint8Array(wire.wasmModule);
    const encryptedInput = new Uint8Array(wire.encryptedPayload);
    const moduleHash = new Uint8Array(wire.moduleHash);

    log.info(`CHUNK_DATA received: chunk ${shortId(chunkId)} for task ${shortId(taskId)}`, {
      wasmSize: wasmModule.length,
      payloadSize: encryptedInput.length,
      entryPoint: wire.entryPoint,
    });

    if (!peerAddress) {
      log.warn('No peer address for CHUNK_DATA, cannot send result back');
      this.taskFinished();
      return;
    }

    const startTime = Date.now();
    let status: ChunkStatus = ChunkStatus.SUCCESS;
    let outputPayload = new Uint8Array(0);
    let cpuMs = 0;
    let memoryPeakMb = 0;

    // Build a CMPChunk for the ExecutionEngine
    const chunk: CMPChunk = {
      chunkId,
      taskId,
      sequence: wire.sequence,
      totalChunks: wire.totalChunks,
      assigneeId: this.meshId,
      payload: encryptedInput,
      codeRef: {
        runtime: Runtime.WASM,
        moduleHash,
        entryPoint: wire.entryPoint,
      },
      dependencies: [],
      expectedOutput: {
        format: (wire.expectedOutput?.format ?? OutputFormat.RAW_BYTES) as OutputFormat,
        maxSizeKb: wire.expectedOutput?.maxSizeKb ?? 1024,
      },
      redundancy: 1,
      timeoutMs: wire.timeoutMs || 30000,
    };

    // Start heartbeat — tells the requester we're alive and working
    const heartbeatTimer = setInterval(() => {
      this.sendHeartbeat(taskId, chunkId, peerAddress!);
    }, this.config.heartbeatIntervalMs);

    try {
      // ── SECURITY: Reject non-WASM code from remote requesters ──
      // Subprocess-based runtimes (Python, Ruby, Shell, etc.) execute with
      // full process permissions — no filesystem, network, or sensor isolation.
      // A malicious requester could send Python code that reads private keys,
      // exfiltrates data, or destroys the device.
      //
      // Only WASM code is accepted for remote execution because the WASMSandbox
      // provides real isolation: zero network, zero filesystem, zero sensors,
      // memory caps, and memory zeroing on destroy.
      //
      // This is defense-in-depth: the requester's run() and compute() methods
      // already prevent non-WASM distribution, but a crafted CHUNK_DATA from a
      // malicious peer could bypass those checks. This gate stops it here.
      const detected = detectRuntime(wasmModule);

      if (detected) {
        const errMsg = `SECURITY: Rejected ${detected.runtime} code from remote peer. ` +
          `Only WASM is accepted for remote execution. ` +
          `Non-WASM runtimes have no sandbox isolation.`;
        log.warn(errMsg);

        status = ChunkStatus.FAILED;
        cpuMs = Date.now() - startTime;
        const errBytes = new TextEncoder().encode(errMsg);
        outputPayload = encrypt(errBytes as any, sessionKey) as any;
      } else {
        // Standard WASM execution path — safe, sandboxed
        this.codeCache.store(wasmModule);

        // Check if module supports step-based checkpointing
        const sandbox = new WASMSandbox({ maxCpuMs: wire.timeoutMs || 30000 });
        await sandbox.loadModule(wasmModule);

        if (sandbox.supportsCheckpoint()) {
          // ── Step-based execution with checkpointing ──
          log.info(`Chunk ${shortId(chunkId)} supports checkpointing, using step-based execution`);

          // Decrypt input
          let inputData: Uint8Array;
          if (encryptedInput.length > 0) {
            inputData = decrypt(encryptedInput, sessionKey);
          } else {
            inputData = new Uint8Array(0);
          }

          // Restore from checkpoint if one was provided (reassignment scenario)
          let stepsCompleted = 0;
          if (wire.checkpoint && wire.checkpoint.length > 0) {
            try {
              const checkpointData = decrypt(new Uint8Array(wire.checkpoint), sessionKey);
              sandbox.restoreMemory(checkpointData);
              stepsCompleted = wire.checkpointSteps || 0;
              log.info(`Restored checkpoint: ${stepsCompleted} steps already completed`);
              this.bus.emit('checkpoint:restored', { chunkId, taskId, stepsCompleted });
              // After restore, pass empty input — module continues from memory state
              inputData = new Uint8Array(0);
            } catch (err: any) {
              log.warn(`Checkpoint restore failed, starting fresh: ${err.message}`);
            }
          }

          // Step loop with periodic checkpointing
          let lastCheckpointTime = Date.now();
          let done = false;

          while (!done) {
            const stepResult = await sandbox.executeStep(inputData);
            stepsCompleted++;
            done = stepResult.done;

            if (done && stepResult.output) {
              outputPayload = encrypt(stepResult.output, sessionKey) as any;
              status = ChunkStatus.SUCCESS;
              cpuMs = Date.now() - startTime;
              memoryPeakMb = sandbox.getMemoryUsageMb();
            } else if (!done) {
              // After first step, subsequent steps get empty input
              inputData = new Uint8Array(0);

              // Checkpoint if enough time has passed
              const now = Date.now();
              if (now - lastCheckpointTime >= this.config.checkpointIntervalMs) {
                lastCheckpointTime = now;
                try {
                  const snapshot = sandbox.snapshotMemory();
                  const encryptedSnapshot = encrypt(snapshot, sessionKey) as any;

                  const cpWire: CheckpointStoreWire = {
                    taskId: Array.from(taskId),
                    chunkId: Array.from(chunkId),
                    executorId: Array.from(this.meshId),
                    encryptedCheckpoint: Array.from(encryptedSnapshot),
                    stepsCompleted,
                    timestamp: now,
                  };

                  const cpMsg = encodeMessage(MessageType.CHECKPOINT_STORE, encodeJSON(cpWire));
                  this.transport.sendTo(peerAddress!, cpMsg).catch(() => {});

                  log.debug(`Checkpoint sent: step ${stepsCompleted} for chunk ${shortId(chunkId)}`);
                  this.bus.emit('checkpoint:stored', { chunkId, taskId, stepsCompleted });
                } catch (cpErr: any) {
                  log.debug(`Checkpoint snapshot failed: ${cpErr.message}`);
                }
              }
            }
          }

          sandbox.destroy();

          log.info(`Chunk ${shortId(chunkId)} executed (step-based): ${ChunkStatus[status]}`, {
            outputSize: outputPayload.length,
            stepsCompleted,
            cpuMs,
            memoryPeakMb,
          });
        } else {
          // Non-checkpointable WASM — use standard execution engine
          sandbox.destroy(); // We created a sandbox just to check, clean it up

          const result = await this.executionEngine.executeChunk(
            chunk,
            sessionKey,
            wasmModule
          );

          status = result.status;
          outputPayload = new Uint8Array(result.payload);
          cpuMs = result.resourceUsed.cpuMs;
          memoryPeakMb = result.resourceUsed.memoryPeakMb;

          log.info(`Chunk ${shortId(chunkId)} executed: ${ChunkStatus[status]}`, {
            outputSize: outputPayload.length,
            cpuMs,
            memoryPeakMb,
          });
        }
      }
    } catch (err: any) {
      status = ChunkStatus.FAILED;
      log.warn(`Chunk execution failed: ${err.message}`);
      cpuMs = Date.now() - startTime;
      // Encode error message as the payload so requester can display it
      const errMsg = new TextEncoder().encode(err.message);
      outputPayload = encrypt(errMsg as any, sessionKey) as any;
    } finally {
      // Stop heartbeat regardless of success/failure
      clearInterval(heartbeatTimer);
    }

    // Build and send CHUNK_RESULT back to requester
    const resultWire: ChunkResultWire = {
      taskId: Array.from(taskId),
      chunkId: Array.from(chunkId),
      executorId: Array.from(this.meshId),
      status,
      encryptedPayload: Array.from(outputPayload),
      executionTimeMs: cpuMs,
      resourceUsed: { cpuMs, memoryPeakMb, gpuMs: 0 },
      proof: Array.from(hash256(outputPayload)),
    };

    const msg = encodeMessage(MessageType.CHUNK_RESULT, encodeJSON(resultWire));

    try {
      await this.transport.sendTo(peerAddress, msg);
      this.stats.chunksExecuted++;
      log.info(`CHUNK_RESULT sent to ${peerAddress} for chunk ${shortId(chunkId)}`);
    } catch (err: any) {
      this.stats.chunksFailed++;
      log.warn(`Failed to send CHUNK_RESULT: ${err.message}`);
    }

    // Free the task slot
    this.taskFinished();

    // Look up what we bid for this task
    const taskHex2 = toHex(taskId);
    const creditsEarned = this.taskCredits.get(taskHex2) || 1;
    this.taskCredits.delete(taskHex2); // Clean up

    this.bus.emit('chunk:executed', {
      chunkId,
      taskId,
      status,
      executionTimeMs: cpuMs,
      creditsEarned,
    });
  }

  /**
   * Send a heartbeat to the requester proving we're alive during execution.
   */
  private sendHeartbeat(taskId: Uint8Array, chunkId: Uint8Array, requesterAddress: string): void {
    const wire: HeartbeatWire = {
      taskId: Array.from(taskId),
      chunkId: Array.from(chunkId),
      executorId: Array.from(this.meshId),
      timestamp: Date.now(),
    };

    const msg = encodeMessage(MessageType.HEARTBEAT, encodeJSON(wire));

    this.transport.sendTo(requesterAddress, msg).catch((err: any) => {
      log.debug(`Failed to send heartbeat: ${err.message}`);
    });
  }
}