/**
 * CMP MCL Engine
 * The integration layer between the Mesh Cognition Layer and CMPNode.
 *
 * MCLEngine is initialized by CMPNode and called at key lifecycle points:
 *   - onStart(): begin MCL message handling
 *   - onStop(): MER handoff before departure
 *   - onTaskComplete(): generate MER from task results
 *   - onMeshJoined(): offer MERs to new mesh (pollination)
 *   - getHint(): generate strategy hint before task submission
 *   - handleMessage(): route MCL protocol messages
 *
 * This design keeps cmp-node.ts changes minimal (~30 lines)
 * while providing full MCL functionality.
 *
 * @module mcl/engine
 * @author Agent Viscro
 */

import {
  toHex, shortId, Logger, randomBytes,
  hash256, sign,
  MessageType,
  encodeMessage, decodeMessage, encodeJSON, decodeJSON,
} from '../';

import type { ITransport, TransportEvent } from '../../../../transport/src/interface';
import type { MeshId, TaskId } from '../types/primitives';
import type { TaskType } from '../types/task';
import type {
  CMP_MER, CMP_STRATEGY_HINT, CMP_MCL_PROFILE,
  MCLConfig, MER_OFFER_Wire, MER_REQUEST_Wire, MER_TRANSFER_Wire,
  DecompositionStrategy,
} from '../types/mcl';
import { DEFAULT_MCL_CONFIG } from '../types/mcl';

import { MERStore } from './dmm';
import type { IMERPersistence } from './persistence';
import { createMER, verifyMER } from './mer';
import type { MERCreateParams } from './mer';
import { Pollinator } from './pollinator';
import { generateHint, applyHint } from './hints';
import { buildMCLProfile, profileHasExperience } from './profile';
import { EventBus } from '../mesh/event-bus';

const log = new Logger('MCLEngine');

/**
 * Task completion data needed to generate a MER.
 */
export interface TaskCompletionData {
  taskType: TaskType;
  deviceCount: number;
  strategyUsed: number;
  chunkCount: number;
  avgChunkSizeKb: number;
  totalTimeMs: number;
  distributionOverheadMs: number;
  executionEfficiency: number;
  faultEvents: number;
  reassignmentCount: number;
  verified: boolean;
}

/**
 * MCLEngine — integration layer for Mesh Cognition in CMPNode.
 */
export class MCLEngine {
  private store: MERStore;
  private pollinator: Pollinator;
  private config: MCLConfig;
  private meshId: MeshId;
  private signingSecretKey: Uint8Array;
  private signingPublicKey: Uint8Array;
  private transport: ITransport;
  private bus: EventBus;
  private running = false;

  /** Mesh capability signature (LSH hash of aggregate capabilities) */
  private meshSignature: Uint8Array = new Uint8Array(8);
  /** Environment hash (fuzzy location/time pattern) */
  private environmentHash: Uint8Array = randomBytes(8);
  /** Origin mesh hash (changes per mesh session) */
  private originMeshHash: Uint8Array = randomBytes(8);

  constructor(opts: {
    meshId: MeshId;
    signingSecretKey: Uint8Array;
    signingPublicKey: Uint8Array;
    transport: ITransport;
    bus: EventBus;
    config?: Partial<MCLConfig>;
    persistence?: IMERPersistence;
  }) {
    this.meshId = opts.meshId;
    this.signingSecretKey = opts.signingSecretKey;
    this.signingPublicKey = opts.signingPublicKey;
    this.transport = opts.transport;
    this.bus = opts.bus;
    this.config = { ...DEFAULT_MCL_CONFIG, ...opts.config };

    this.store = new MERStore({
      maxMers: this.config.maxMers,
      maxPerOrigin: this.config.maxPerOrigin,
      persistence: opts.persistence,
    });
    this.pollinator = new Pollinator(this.store, this.config);

    // Generate unique origin hash for this mesh session
    this.originMeshHash = hash256(this.meshId).slice(0, 8);
  }

  // ══════════════════════════════════════════
  // Lifecycle (called by CMPNode)
  // ══════════════════════════════════════════

  /**
   * Start MCL engine. Called by CMPNode.start().
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Load persisted MERs from SQLite
    this.store.loadFromPersistence();

    // Purge expired MERs on startup
    this.store.purgeExpired();

    log.info(`MCL Engine started: ${this.store.size} MERs loaded, ` +
      `${this.store.taskTypeCount} task types, ${this.store.originCount} origins`);

    this.bus.emit('mcl:started', { merCount: this.store.size });
  }

  /**
   * Initialize SQLite persistence for MER storage.
   * Must be called before start() if persistence is desired.
   * Async because sql.js requires async WASM initialization.
   *
   * @param dbPath - Path to SQLite database file
   */
  async initPersistence(dbPath: string): Promise<void> {
    try {
      const { SQLiteMERPersistence } = require('./persistence');
      const persistence = new SQLiteMERPersistence(dbPath);
      await persistence.init();
      this.store.setPersistence(persistence);
      log.info(`SQLite persistence initialized: ${dbPath}`);
    } catch (err: any) {
      log.warn(`SQLite persistence failed, falling back to in-memory: ${err.message}`);
    }
  }

  /**
   * Stop MCL engine. Called by CMPNode.stop().
   * Returns MERs that should be transferred to remaining peers before departure.
   */
  stop(): CMP_MER[] {
    if (!this.running) return [];
    this.running = false;

    // Return all MERs for handoff to remaining mesh peers
    const mers = this.store.getAll();
    log.info(`MCL Engine stopping: ${mers.length} MERs available for handoff`);
    return mers;
  }

  // ══════════════════════════════════════════
  // Task Integration (called by CMPNode)
  // ══════════════════════════════════════════

  /**
   * Generate a strategy hint before task submission.
   * Called by CMPNode.compute() before negotiation.
   *
   * @param taskType - Task type being submitted
   * @param currentDeviceCount - Number of active mesh peers
   * @returns Strategy hint, or null if insufficient experience
   */
  getHint(
    taskType: TaskType,
    currentDeviceCount: number
  ): CMP_STRATEGY_HINT | null {
    if (!this.running || !this.config.enabled) return null;

    const hint = generateHint(
      this.store,
      taskType,
      this.meshSignature,
      currentDeviceCount,
      this.config.minHintConfidence
    );

    if (hint) {
      this.bus.emit('mcl:hint_generated', {
        taskType,
        confidence: hint.confidence,
        chunkCount: hint.recommendedChunkCount,
        generation: hint.merGeneration,
      });
    }

    return hint;
  }

  /**
   * Apply a strategy hint to task distribution parameters.
   *
   * @param originalChunkHint - Original chunk hint from compute options
   * @param deviceCount - Number of assigned devices
   * @param hint - Strategy hint (from getHint)
   * @returns Adjusted parameters
   */
  applyHintToDistribution(
    originalChunkHint: number,
    deviceCount: number,
    hint: CMP_STRATEGY_HINT | null
  ): { chunkCount: number; chunkSizeKb: number | null; applied: boolean } {
    return applyHint(originalChunkHint, deviceCount, hint, this.config.minHintConfidence);
  }

  /**
   * Generate a MER after successful task completion.
   * Called by CMPNode when ResultAssembler produces a TaskCompletion.
   *
   * Only generates MERs for verified tasks (REDUNDANT or ZK_PROOF).
   *
   * @param data - Task completion data
   * @returns Generated MER, or null if conditions not met
   */
  onTaskComplete(data: TaskCompletionData): CMP_MER | null {
    if (!this.running || !this.config.enabled) return null;

    // Only generate MERs from verified executions
    if (!data.verified) {
      log.debug('Task not verified, skipping MER generation');
      return null;
    }

    // Calculate overhead percentage
    const overheadPct = data.totalTimeMs > 0
      ? Math.round((data.distributionOverheadMs / data.totalTimeMs) * 100)
      : 0;

    const params: MERCreateParams = {
      taskType: data.taskType,
      meshSignature: this.meshSignature,
      deviceCount: data.deviceCount,
      strategyUsed: data.strategyUsed as DecompositionStrategy,
      chunkCount: data.chunkCount,
      avgChunkSizeKb: data.avgChunkSizeKb,
      performance: {
        totalTimeMs: data.totalTimeMs,
        distributionOverheadPct: Math.min(100, overheadPct),
        executionEfficiency: Math.min(100, Math.max(0, data.executionEfficiency)),
        faultEvents: data.faultEvents,
        reassignmentCount: data.reassignmentCount,
      },
      learnedHints: {
        optimalChunkSizeKb: data.avgChunkSizeKb,
        optimalDeviceCount: data.deviceCount,
        bestTierMapping: new Uint8Array([0, 1, 2, 2, 1]), // default mapping
        bottleneckFlags: 0,
      },
      environmentHash: this.environmentHash,
      originMeshHash: this.originMeshHash,
    };

    const mer = createMER(params, this.signingSecretKey);

    if (this.store.store(mer)) {
      log.info(`MER generated: ${shortId(mer.merId)} task=${data.taskType} ` +
        `eff=${data.executionEfficiency}% conf=${mer.confidence}`);

      this.bus.emit('mcl:mer_generated', {
        merId: mer.merId,
        taskType: data.taskType,
        confidence: mer.confidence,
        generation: mer.generation,
      });

      return mer;
    }

    return null;
  }

  // ══════════════════════════════════════════
  // Pollination (called by CMPNode)
  // ══════════════════════════════════════════

  /**
   * Build a MER_OFFER when joining a new mesh.
   * Called after handshake + capability exchange completes.
   */
  buildPollination(): MER_OFFER_Wire | null {
    if (!this.running || !this.config.enabled) return null;
    return this.pollinator.buildOffer(this.meshId);
  }

  /**
   * Process a received MER_OFFER from a joining peer.
   * Returns a MER_REQUEST if we want any of the offered MERs.
   */
  processOffer(offer: MER_OFFER_Wire): MER_REQUEST_Wire | null {
    return this.pollinator.processOffer(offer, this.meshId);
  }

  /**
   * Build a MER_TRANSFER in response to a MER_REQUEST.
   */
  buildTransfer(request: MER_REQUEST_Wire): MER_TRANSFER_Wire {
    return this.pollinator.buildTransfer(request, this.meshId, this.signingSecretKey);
  }

  /**
   * Process a received MER_TRANSFER — validate and store MERs.
   */
  processTransfer(transfer: MER_TRANSFER_Wire, senderPublicKey: Uint8Array): number {
    return this.pollinator.processTransfer(transfer, senderPublicKey);
  }

  // ══════════════════════════════════════════
  // MCL Message Handling
  // ══════════════════════════════════════════

  /**
   * Handle incoming MCL protocol messages.
   * Called by CMPNode's transport message handler.
   *
   * @returns true if the message was handled (MCL type), false otherwise
   */
  handleMessage(type: MessageType, payload: Uint8Array, peerAddress?: string): boolean {
    if (!this.running || !this.config.enabled) return false;

    switch (type) {
      case MessageType.MER_OFFER:
        this.handleMEROffer(payload, peerAddress);
        return true;
      case MessageType.MER_REQUEST:
        this.handleMERRequest(payload, peerAddress);
        return true;
      case MessageType.MER_TRANSFER:
        this.handleMERTransfer(payload, peerAddress);
        return true;
      case MessageType.MER_STORE:
        this.handleMERStore(payload);
        return true;
      case MessageType.MER_QUERY:
        // MER_QUERY is handled locally, not over the wire
        return true;
      default:
        return false;
    }
  }

  private handleMEROffer(payload: Uint8Array, peerAddress?: string): void {
    const wire = decodeJSON<MER_OFFER_Wire>(payload);
    if (!wire) return;

    log.info(`MER_OFFER from ${peerAddress || 'unknown'}: ${wire.summaries.length} MERs offered`);

    const request = this.processOffer(wire);
    if (!request || !peerAddress) return;

    // Send MER_REQUEST back
    const msg = encodeMessage(MessageType.MER_REQUEST, encodeJSON(request));
    this.transport.sendTo(peerAddress, msg).catch(err => {
      log.warn(`Failed to send MER_REQUEST: ${err.message}`);
    });
  }

  private handleMERRequest(payload: Uint8Array, peerAddress?: string): void {
    const wire = decodeJSON<MER_REQUEST_Wire>(payload);
    if (!wire || !peerAddress) return;

    log.info(`MER_REQUEST from ${peerAddress}: ${wire.merIds.length} MERs requested`);

    const transfer = this.buildTransfer(wire);

    const msg = encodeMessage(MessageType.MER_TRANSFER, encodeJSON(transfer));
    this.transport.sendTo(peerAddress, msg).catch(err => {
      log.warn(`Failed to send MER_TRANSFER: ${err.message}`);
    });
  }

  private handleMERTransfer(payload: Uint8Array, _peerAddress?: string): void {
    const wire = decodeJSON<MER_TRANSFER_Wire>(payload);
    if (!wire) return;

    // Use signing public key for verification (simplified — in production,
    // we'd look up the sender's key from the peer table)
    const stored = this.processTransfer(wire, this.signingPublicKey);
    log.info(`MER_TRANSFER processed: ${stored} MERs stored`);
  }

  private handleMERStore(payload: Uint8Array): void {
    // Direct MER store from DHT replication (within same mesh)
    const wire = decodeJSON<any>(payload);
    if (!wire || !wire.merData) return;

    const { merFromWire } = require('./mer');
    const mer = merFromWire(wire.merData);
    if (this.store.store(mer)) {
      log.debug(`MER_STORE: stored ${toHex(mer.merId).substring(0, 8)}`);
    }
  }

  // ══════════════════════════════════════════
  // Profile & Status
  // ══════════════════════════════════════════

  /**
   * Build MCL profile for capability exchange.
   */
  getMCLProfile(): CMP_MCL_PROFILE {
    return buildMCLProfile(this.store.getAll());
  }

  /**
   * Update mesh signature when capability map changes.
   * Called by CMPNode when capabilities are refreshed.
   */
  updateMeshSignature(capabilityHash: Uint8Array): void {
    this.meshSignature = capabilityHash.slice(0, 8);
  }

  /**
   * Get MCL status for display/debugging.
   */
  getStatus(): {
    enabled: boolean;
    merCount: number;
    taskTypes: number;
    origins: number;
    pollinationStats: any;
  } {
    return {
      enabled: this.config.enabled,
      merCount: this.store.size,
      taskTypes: this.store.taskTypeCount,
      origins: this.store.originCount,
      pollinationStats: this.pollinator.getStats(),
    };
  }

  /**
   * Get the MER store (for testing/advanced usage).
   */
  getStore(): MERStore {
    return this.store;
  }

  /**
   * Get the pollinator (for testing/advanced usage).
   */
  getPollinator(): Pollinator {
    return this.pollinator;
  }

  /**
   * Check if MCL is enabled and running.
   */
  isActive(): boolean {
    return this.running && this.config.enabled;
  }
}
