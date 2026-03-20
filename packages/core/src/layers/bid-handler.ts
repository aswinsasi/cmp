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

import { ITransport, TransportEvent } from '../../transport/src/interface';
import {
  CMPTaskRequest,
  TaskType,
  ComputeBudget,
  Priority,
} from '../types/task';
import { CMPBid } from '../types/negotiation';
import {
  CMPCapability,
  PowerSource,
  ThermalState,
  Runtime,
} from '../types/capability';
import { MeshId } from '../types/primitives';
import { MessageType } from '../types/beacon';
import { EventBus } from '../mesh/event-bus';
import { DeviceProfiler } from './profiler';
import { DiscoveryLayer } from './discovery';
import { encodeMessage, decodeMessage, encodeJSON, decodeJSON } from './serializer';
import { randomBytes } from '../crypto';
import { toHex, shortId } from '../utils/helpers';
import { Logger } from '../utils/logger';

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
}

const DEFAULT_BID_CONFIG: BidHandlerConfig = {
  acceptingTasks: true,
  maxConcurrentTasks: 3,
  minBatteryPct: 15,
  maxBidResourceShare: 0.7,
};

export class BidHandler {
  private config: BidHandlerConfig;
  private transport: ITransport;
  private bus: EventBus;
  private profiler: DeviceProfiler;
  private discovery: DiscoveryLayer;
  private meshId: MeshId;
  private running = false;

  /** Currently active tasks being executed */
  private activeTasks = 0;

  /** Track tasks we've already bid on to avoid duplicates */
  private bidHistory = new Map<string, number>(); // taskHex → timestamp

  /** Bid history cleanup interval */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** Stats */
  private stats = {
    tasksReceived: 0,
    bidsSubmitted: 0,
    bidsSkipped: 0,
  };

  constructor(
    meshId: MeshId,
    transport: ITransport,
    bus: EventBus,
    profiler: DeviceProfiler,
    discovery: DiscoveryLayer,
    config?: Partial<BidHandlerConfig>
  ) {
    this.meshId = meshId;
    this.transport = transport;
    this.bus = bus;
    this.profiler = profiler;
    this.discovery = discovery;
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

    // Don't bid twice on the same task
    if (this.bidHistory.has(taskHex)) return;

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
    this.bidHistory.set(taskHex, Date.now());
    this.stats.bidsSubmitted++;
  }

  // ── Bid Evaluation ──

  private async evaluateAndBid(request: CMPTaskRequest): Promise<CMPBid | null> {
    // Gate 1: Are we accepting tasks?
    if (!this.config.acceptingTasks) {
      log.debug(`Skipping bid: not accepting tasks`);
      return null;
    }

    // Gate 2: Do we have capacity?
    if (this.activeTasks >= this.config.maxConcurrentTasks) {
      log.debug(`Skipping bid: at capacity (${this.activeTasks}/${this.config.maxConcurrentTasks})`);
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
      log.debug(`Skipping bid: low battery (${profile.power.batteryPct}%)`);
      return null;
    }

    // Gate 5: Thermal check
    if (profile.power.thermalState === ThermalState.THROTTLED) {
      log.debug('Skipping bid: device throttled');
      return null;
    }

    // Gate 6: Runtime support
    if (!profile.runtimes.includes(request.runtimeRequired)) {
      log.debug(`Skipping bid: runtime ${request.runtimeRequired} not supported`);
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
      log.debug(`Skipping bid: cannot meet deadline (${estimatedMs}ms > ${request.computeBudget.deadlineMs}ms)`);
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

    log.debug(`Bidding on task ${shortId(request.taskId)}`, {
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
      log.debug(`Bid sent to ${requesterAddress}`);
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
}
