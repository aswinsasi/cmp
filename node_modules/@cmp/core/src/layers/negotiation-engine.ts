/**
 * CMP Negotiation Engine
 * Layer 3: Handles the full request → bid → assign cycle.
 *
 * Requester flow:
 *   1. Build CMPTaskRequest from user's compute options
 *   2. Broadcast to mesh
 *   3. Collect bids within bid window
 *   4. Score and rank bids using weighted scoring
 *   5. Select winners, create assignments
 *   6. Send assignments, wait for ACKs
 *   7. Return assignments for distribution layer
 *
 * @module layers/negotiation
 * @author Agent Viscro
 */

import { ITransport } from '../../../transport/src/interface';
import {
  CMPTaskRequest,
  TaskType,
  TaskSecurity,
  ComputeBudget,
  Priority,
  EncryptionAlgo,
  VerifyMode,
  SecurityLevel,
} from '../types/task';
import {
  Runtime, Architecture, GPUType, GPUFeature, PowerSource, ThermalState,
  CMPCapability,
} from '../types/capability';
import {
  CMPBid,
  CMPAssignment,
  CMPAssignmentAck,
  ScoredBid,
  NegotiationConfig,
  DEFAULT_NEGOTIATION_CONFIG,
} from '../types/negotiation';
import { MeshId, TaskId, Signature } from '../types/primitives';
import { MessageType } from '../types/beacon';
import { EventBus } from '../mesh/event-bus';
import { PeerTable } from '../mesh/peer-table';
import { CapabilityMap, ScoredCandidate } from './capability-map';
import { DiscoveryLayer } from './discovery';
import { encodeMessage, decodeMessage, encodeJSON, decodeJSON } from './serializer';
import { randomBytes, sign as cryptoSign, generateSigningKeyPair, KeyPair } from '../crypto';
import { toHex, shortId, deferred } from '../utils/helpers';
import { Logger } from '../utils/logger';
import { IncentiveLedger } from '../incentive/ledger';
import { REPUTATION_LOW_PRIORITY } from '../types/incentive';

const log = new Logger('Negotiation');

/**
 * Options for submitting a compute task.
 */
export interface ComputeRequest {
  taskType: TaskType;
  runtimeRequired: Runtime;
  payloadSizeKb: number;
  computeBudget: ComputeBudget;
  security?: Partial<TaskSecurity>;
  chunkHint?: number;
  priority?: Priority;
  creditsOffered?: number;
}

/**
 * Result of the negotiation phase.
 */
export interface NegotiationResult {
  taskId: TaskId;
  assignments: AssignmentRecord[];
  totalBidsReceived: number;
  negotiationTimeMs: number;
}

/**
 * Record of an assignment with resolved address for transport.
 */
export interface AssignmentRecord {
  assignment: CMPAssignment;
  peerAddress: string;
  capability: ScoredCandidate;
  /** Credits agreed for this assignment (from winning bid) */
  creditsAgreed: number;
}

export class NegotiationEngine {
  private config: NegotiationConfig;
  private transport: ITransport;
  private bus: EventBus;
  private peerTable: PeerTable;
  private capMap: CapabilityMap;
  private discovery: DiscoveryLayer;
  private signingKeyPair: KeyPair;
  private meshId: MeshId;
  private ledger: IncentiveLedger;
  private running = false;

  /** Pending bid collections: taskId hex → bid array */
  private pendingBids = new Map<string, CMPBid[]>();

  /** Active task negotiations for tracking */
  private activeNegotiations = new Map<string, { resolve: Function; timer?: ReturnType<typeof setTimeout> }>();

  constructor(
    meshId: MeshId,
    signingKeyPair: KeyPair,
    transport: ITransport,
    bus: EventBus,
    peerTable: PeerTable,
    capMap: CapabilityMap,
    discovery: DiscoveryLayer,
    ledger: IncentiveLedger,
    config?: Partial<NegotiationConfig>
  ) {
    this.meshId = meshId;
    this.signingKeyPair = signingKeyPair;
    this.transport = transport;
    this.bus = bus;
    this.peerTable = peerTable;
    this.capMap = capMap;
    this.discovery = discovery;
    this.ledger = ledger;
    this.config = { ...DEFAULT_NEGOTIATION_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Listen for incoming bids
    this.transport.on('message', (event) => {
      if (!event.data) return;
      const msg = decodeMessage(event.data);
      if (!msg) return;

      switch (msg.type) {
        case MessageType.BID:
          this.handleIncomingBid(msg.payload, event.peerAddress);
          break;
        case MessageType.ASSIGNMENT_ACK:
          this.handleAssignmentAck(msg.payload);
          break;
      }
    });

    this.running = true;
    log.info('Negotiation engine started');
  }

  async stop(): Promise<void> {
    this.running = false;
    // Reject all pending negotiations
    for (const [taskHex, neg] of this.activeNegotiations) {
      if (neg.timer) clearTimeout(neg.timer);
    }
    this.activeNegotiations.clear();
    this.pendingBids.clear();
  }

  /**
   * Submit a task to the mesh and negotiate with peers.
   * Returns assignments if successful, or empty array if no peers available.
   */
  async submitTask(request: ComputeRequest): Promise<NegotiationResult> {
    const startTime = Date.now();

    // 1. Check if mesh can fulfill the request
    if (!this.capMap.canFulfill(request.computeBudget)) {
      log.warn('Mesh cannot fulfill compute budget', {
        needed: request.computeBudget,
        available: this.capMap.getMeshResources(),
      });
    }

    // 2. Build task request
    const taskId = randomBytes(16);
    const taskRequest = this.buildTaskRequest(taskId, request);

    log.info(`Submitting task ${shortId(taskId)}`, {
      type: TaskType[request.taskType],
      cores: request.computeBudget.minCores,
      memMb: request.computeBudget.minMemoryMb,
      deadline: request.computeBudget.deadlineMs,
      priority: Priority[request.priority ?? Priority.NORMAL],
    });

    // 3. Set up bid collection BEFORE sending (bids may arrive during send)
    const taskHex = toHex(taskId);
    this.pendingBids.set(taskHex, []);

    // 4. Send task request to EACH known peer individually
    //    (more reliable than broadcast — TCP connections may be stale)
    const encoded = encodeJSON(this.serializeTaskRequest(taskRequest));
    const msg = encodeMessage(MessageType.TASK_REQUEST, encoded);

    const activePeers = this.peerTable.getActive();
    log.info(`Sending task request to ${activePeers.length} active peers`);

    for (const peer of activePeers) {
      const addr = this.discovery.resolveAddress(peer.meshId);
      if (addr) {
        try {
          await this.transport.sendTo(addr, msg);
          log.info(`Task request sent to ${shortId(peer.meshId)} at ${addr}`);
        } catch (err: any) {
          log.warn(`Failed to send task request to ${shortId(peer.meshId)}: ${err.message}`);
        }
      } else {
        log.warn(`Cannot resolve address for peer ${shortId(peer.meshId)}`);
      }
    }

    // Also try broadcast as fallback (only if no direct peers found)
    if (activePeers.length === 0) {
      try {
        await this.transport.broadcast(msg);
      } catch {}
    }

    this.bus.emit('task:request_received', {
      taskId,
      requesterId: this.meshId,
    });

    // 5. Collect bids within window
    const bids = await this.collectBids(taskHex, this.config.bidWindowMs);

    log.info(`Collected ${bids.length} bids for task ${shortId(taskId)}`);

    if (bids.length === 0) {
      this.pendingBids.delete(taskHex);
      return {
        taskId,
        assignments: [],
        totalBidsReceived: 0,
        negotiationTimeMs: Date.now() - startTime,
      };
    }

    // 6. Score and rank bids
    const scored = this.scoreBids(bids, request.computeBudget);

    // 7. Select winners
    const winners = this.selectWinners(scored, request);

    log.info(`Selected ${winners.length} winners for task ${shortId(taskId)}`);

    // 8. Create and send assignments
    const assignments = await this.createAndSendAssignments(taskId, winners);

    // 9. Emit event
    this.bus.emit('task:assigned', {
      taskId,
      assignees: assignments.map((a) => a.assignment.bidderId),
    });

    return {
      taskId,
      assignments,
      totalBidsReceived: bids.length,
      negotiationTimeMs: Date.now() - startTime,
    };
  }

  // ── Task Request Building ──

  private buildTaskRequest(taskId: TaskId, req: ComputeRequest): CMPTaskRequest {
    const security: TaskSecurity = {
      encryption: req.security?.encryption ?? EncryptionAlgo.AES_256_GCM,
      verifyMode: req.security?.verifyMode ?? VerifyMode.CHECKSUM,
      dataSensitivity: req.security?.dataSensitivity ?? SecurityLevel.PRIVATE,
    };

    return {
      taskId,
      requesterId: this.meshId,
      taskType: req.taskType,
      runtimeRequired: req.runtimeRequired,
      payloadSizeKb: req.payloadSizeKb,
      computeBudget: req.computeBudget,
      security,
      chunkHint: req.chunkHint ?? 0,
      priority: req.priority ?? Priority.NORMAL,
      creditsOffered: req.creditsOffered ?? this.estimateCredits(req),
      signature: new Uint8Array(64), // Filled below
    };
  }

  private serializeTaskRequest(req: CMPTaskRequest): any {
    return {
      taskId: Array.from(req.taskId),
      requesterId: Array.from(req.requesterId),
      taskType: req.taskType,
      runtimeRequired: req.runtimeRequired,
      payloadSizeKb: req.payloadSizeKb,
      computeBudget: req.computeBudget,
      security: req.security,
      chunkHint: req.chunkHint,
      priority: req.priority,
      creditsOffered: req.creditsOffered,
    };
  }

  // ── Bid Collection ──

  private collectBids(taskHex: string, windowMs: number): Promise<CMPBid[]> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const bids = this.pendingBids.get(taskHex) || [];
        this.pendingBids.delete(taskHex);
        this.activeNegotiations.delete(taskHex);
        resolve(bids);
      }, windowMs);

      this.activeNegotiations.set(taskHex, {
        resolve: (bids: CMPBid[]) => {
          clearTimeout(timer);
          this.pendingBids.delete(taskHex);
          this.activeNegotiations.delete(taskHex);
          resolve(bids);
        },
        timer,
      });
    });
  }

  private handleIncomingBid(payload: Uint8Array, peerAddress?: string): void {
    const data = decodeJSON<any>(payload);
    if (!data) {
      log.warn('Failed to decode bid payload');
      return;
    }

    const bid: CMPBid = {
      taskId: new Uint8Array(data.taskId),
      bidderId: new Uint8Array(data.bidderId),
      offeredResources: data.offeredResources,
      estimatedTimeMs: data.estimatedTimeMs,
      confidence: data.confidence,
      creditsRequested: data.creditsRequested,
      signature: new Uint8Array(64),
    };

    // Register bidder's address if we don't already know them
    // (critical for hotspot where discovery is one-directional)
    if (peerAddress) {
      const existing = this.discovery.resolveAddress(bid.bidderId);
      if (!existing) {
        log.info(`Registering unknown bidder ${shortId(bid.bidderId)} at ${peerAddress}`);
        this.discovery.registerAddress(bid.bidderId, peerAddress);
      }
    }

    const taskHex = toHex(bid.taskId);
    const bids = this.pendingBids.get(taskHex);

    log.info(`Bid received from ${shortId(bid.bidderId)} for task ${taskHex.substring(0,8)}`, {
      hasPendingEntry: bids !== undefined,
      pendingKeys: [...this.pendingBids.keys()].map(k => k.substring(0,8)),
      estimatedMs: bid.estimatedTimeMs,
      confidence: bid.confidence,
    });

    if (!bids) return; // Not our task or window closed

    bids.push(bid);

    log.debug(`Bid received from ${shortId(bid.bidderId)} for task ${shortId(bid.taskId)}`, {
      estimatedMs: bid.estimatedTimeMs,
      confidence: bid.confidence,
      credits: bid.creditsRequested,
    });

    this.bus.emit('task:bid_received', {
      taskId: bid.taskId,
      bidderId: bid.bidderId,
      score: 0, // Scored later
    });

    // Early resolution if we have enough bids (minBids = 1 for fast response)
    if (bids.length >= this.config.minBids) {
      // Give a small grace period (200ms) for additional bids, then resolve
      const neg = this.activeNegotiations.get(taskHex);
      if (neg) {
        setTimeout(() => {
          const currentBids = this.pendingBids.get(taskHex);
          if (currentBids) neg.resolve(currentBids);
        }, 200);
      }
    }
  }

  // ── Bid Scoring ──

  private scoreBids(bids: CMPBid[], budget: ComputeBudget): ScoredBid[] {
    const w = this.config.scoringWeights;

    return bids
      .map((bid) => {
        // Get peer capability from map
        const cap = this.capMap.get(bid.bidderId);

        if (!cap) {
          // Unknown peer (e.g., hotspot - discovery was one-directional)
          // Score based on bid's self-reported data + confidence
          const timeFit = budget.deadlineMs > 0
            ? Math.max(0, 1 - bid.estimatedTimeMs / budget.deadlineMs)
            : 0.5;
          const defaultScore = 0.3 + (timeFit * 0.2) + (bid.confidence * 0.1);
          log.info(`Scoring unknown bidder ${shortId(bid.bidderId)}: ${defaultScore.toFixed(3)} (no capability data)`);
          return { bid, score: defaultScore };
        }

        // Resource match (40%)
        const coreFit = Math.min(1, (cap.cpu.coresAvailable) / Math.max(1, budget.minCores));
        const memFit = Math.min(1, cap.memory.availableMb / Math.max(1, budget.minMemoryMb));
        const resourceScore = ((coreFit + memFit) / 2) * w.resourceMatch;

        // Estimated time (25%) — lower is better
        const timeFit = budget.deadlineMs > 0
          ? Math.max(0, 1 - bid.estimatedTimeMs / budget.deadlineMs)
          : 0.5;
        const timeScore = timeFit * w.estimatedTime;

        // Reputation (20%)
        const repScore = (cap.reputationScore / 10000) * w.reputation;

        // Power stability (15%)
        let powerScore: number;
        if (cap.power.source === 1) { // PLUGGED
          powerScore = 1.0;
        } else {
          powerScore = cap.power.batteryPct / 100;
        }
        if (cap.power.thermalState === 1) powerScore *= 0.7; // WARM
        powerScore *= w.powerStability;

        // Confidence bonus (up to 5% extra)
        const confidenceBonus = bid.confidence * 0.05;

        const totalScore = resourceScore + timeScore + repScore + powerScore + confidenceBonus;

        return { bid, score: totalScore };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ── Winner Selection ──

  private selectWinners(scored: ScoredBid[], request: ComputeRequest): ScoredBid[] {
    if (scored.length === 0) return [];

    // Determine how many devices we need
    const chunkCount = request.chunkHint || this.estimateChunkCount(request);
    const redundancy = request.security?.verifyMode === VerifyMode.REDUNDANT ? 2 : 1;
    const needed = Math.min(scored.length, chunkCount * redundancy);

    // Filter out zero-score bids and low-reputation bidders
    const valid = scored.filter((s) => {
      if (s.score <= 0) return false;

      // Check requester's own ledger for this bidder's reputation
      const bidderHex = toHex(s.bid.bidderId);
      if (this.ledger.hasAccount(bidderHex)) {
        const rep = this.ledger.getReputation(bidderHex);
        if (!this.ledger.canParticipate(bidderHex)) {
          log.info(`Excluding bidder ${shortId(s.bid.bidderId)}: reputation ${rep} below minimum`);
          return false;
        }
        // Deprioritize low-reputation bidders (reduce score by 50%)
        if (rep < REPUTATION_LOW_PRIORITY) {
          s.score *= 0.5;
          log.debug(`Deprioritized bidder ${shortId(s.bid.bidderId)}: reputation ${rep} below ${REPUTATION_LOW_PRIORITY}`);
        }
      }
      return true;
    });

    // Re-sort after any score adjustments
    valid.sort((a, b) => b.score - a.score);

    // Select top N
    const winners = valid.slice(0, Math.max(1, needed));

    log.debug(`Winner selection: ${winners.length} of ${scored.length} bids`, {
      chunkCount,
      redundancy,
      topScore: winners[0]?.score.toFixed(3),
      bottomScore: winners[winners.length - 1]?.score.toFixed(3),
    });

    return winners;
  }

  private estimateChunkCount(request: ComputeRequest): number {
    // Heuristic: 1 chunk per candidate, min 2, max 10
    const candidates = this.capMap.findCandidates(request.computeBudget);
    return Math.max(2, Math.min(10, candidates.length));
  }

  // ── Assignment Creation ──

  private async createAndSendAssignments(
    taskId: TaskId,
    winners: ScoredBid[]
  ): Promise<AssignmentRecord[]> {
    const records: AssignmentRecord[] = [];

    for (let i = 0; i < winners.length; i++) {
      const winner = winners[i];
      const bidderId = winner.bid.bidderId;

      // Resolve peer address
      const peerAddress = this.discovery.resolveAddress(bidderId);
      if (!peerAddress) {
        log.warn(`Cannot resolve address for winner ${shortId(bidderId)}, skipping`);
        continue;
      }

      // Get peer capability (may be null for hotspot peers)
      const cap = this.capMap.get(bidderId);

      const assignment: CMPAssignment = {
        taskId,
        bidderId,
        chunks: [randomBytes(16)],
        sessionKey: randomBytes(32),
        deadline: BigInt(Date.now() + 30000),
        signature: new Uint8Array(64),
      };

      // Send assignment
      const encoded = encodeJSON({
        taskId: Array.from(taskId),
        bidderId: Array.from(bidderId),
        chunks: assignment.chunks.map((c) => Array.from(c)),
        deadline: assignment.deadline.toString(),
      });
      const msg = encodeMessage(MessageType.ASSIGNMENT, encoded);

      try {
        await this.transport.sendTo(peerAddress, msg);

        // Build capability placeholder if not in map
        const defaultCap = (cap || {
          meshId: bidderId,
          cpu: { architecture: Architecture.X86_64, coresAvailable: 2, clockMhz: 2000, loadPercent: 50 },
          memory: { availableMb: 1024, bandwidthGbps: 1 },
          gpu: { type: GPUType.NONE, computeUnits: 0, vramMb: 0, supports: new Set<GPUFeature>() },
          storage: { scratchMb: 512, readMbps: 100, writeMbps: 100 },
          network: { meshBandwidthMbps: 100, latencyMs: 10 },
          power: { source: PowerSource.PLUGGED, batteryPct: 100, thermalState: ThermalState.NOMINAL },
          runtimes: [Runtime.WASM],
          reputationScore: 5000,
          availabilitySec: 3600,
        }) as CMPCapability;

        const candidate: ScoredCandidate = {
          meshId: bidderId,
          capability: defaultCap,
          tier: 0 as any,
          score: winner.score,
        };

        records.push({ assignment, peerAddress, capability: candidate, creditsAgreed: winner.bid.creditsRequested });

        log.info(`Assigned to ${shortId(bidderId)} (score: ${winner.score.toFixed(3)}, credits: ${winner.bid.creditsRequested} CCU)`);
      } catch (err: any) {
        log.warn(`Failed to send assignment to ${shortId(bidderId)}: ${err.message}`);
      }
    }

    return records;
  }

  private handleAssignmentAck(payload: Uint8Array): void {
    const data = decodeJSON<any>(payload);
    if (!data) return;

    log.debug(`Assignment ACK from ${shortId(new Uint8Array(data.bidderId))}`, {
      accepted: data.accepted,
    });
  }

  // ── Credit Estimation ──

  private estimateCredits(req: ComputeRequest): number {
    // CCU = CPU-core-seconds at 1GHz equivalent
    const estimatedSeconds = req.computeBudget.deadlineMs / 1000;
    const cores = req.computeBudget.minCores;
    return Math.ceil(estimatedSeconds * cores * 1.2); // 20% buffer
  }
}