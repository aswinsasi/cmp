/**
 * CMP v1.5 — Credit-Based Flow Control
 *
 * Prevents a fast sender from overwhelming a slow receiver.
 * Each peer is given N message credits. Sending a message costs 1 credit.
 * When credits reach 0, sends are queued. The receiver sends REPLENISH
 * messages to restore credits after processing.
 *
 * Flow Control Protocol:
 *   - On peer discovery: grant INITIAL_CREDITS (default 32) credits
 *   - On sendTo: if peer has credits → send immediately, deduct 1 credit
 *                if peer has 0 credits → queue the message
 *   - On receiving REPLENISH: add credits, flush queued messages
 *   - Auto-replenish: receiver sends REPLENISH after processing N messages
 *
 * Credit Replenish Message Format:
 *   First byte: 0xFF (flow control marker)
 *   Bytes 1-4:  uint32 big-endian — credits to replenish
 *
 * This wraps any ITransport and sits between AuthenticatedTransport
 * and the raw transport (or can wrap AuthenticatedTransport itself).
 *
 * @module auth/flow-control
 * @author Agent Viscro
 */

import { ITransport, TransportEvent, TransportEventHandler } from '../../../transport/src/interface';

/** Flow control message marker byte */
const FC_MARKER = 0xFF;

/** Flow control message size: 1 marker + 4 credits */
const FC_MESSAGE_SIZE = 5;

/** Default credits per peer */
const DEFAULT_INITIAL_CREDITS = 32;

/** Credits to replenish when sending a REPLENISH message */
const DEFAULT_REPLENISH_AMOUNT = 16;

/** Process this many messages before sending REPLENISH */
const DEFAULT_REPLENISH_THRESHOLD = 16;

// ─── Config ───

export interface FlowControlConfig {
  /** Initial credits granted to each peer (default: 32) */
  initialCredits: number;
  /** Credits to add when sending REPLENISH (default: 16) */
  replenishAmount: number;
  /** Send REPLENISH after processing this many messages from a peer (default: 16) */
  replenishThreshold: number;
  /** Maximum queued messages per peer before dropping (default: 256) */
  maxQueuePerPeer: number;
}

const DEFAULT_CONFIG: FlowControlConfig = {
  initialCredits: DEFAULT_INITIAL_CREDITS,
  replenishAmount: DEFAULT_REPLENISH_AMOUNT,
  replenishThreshold: DEFAULT_REPLENISH_THRESHOLD,
  maxQueuePerPeer: 256,
};

// ─── Per-Peer State ───

interface PeerFlowState {
  /** Credits remaining for sending TO this peer */
  sendCredits: number;
  /** Messages received from this peer since last REPLENISH */
  receivedSinceReplenish: number;
  /** Queued messages waiting for credits */
  sendQueue: Uint8Array[];
  /** Total messages sent */
  totalSent: number;
  /** Total messages received */
  totalReceived: number;
  /** Total messages queued (waiting for credits) */
  totalQueued: number;
  /** Total messages dropped (queue overflow) */
  totalDropped: number;
}

// ─── Stats ───

export interface FlowControlStats {
  /** Total peers being tracked */
  trackedPeers: number;
  /** Total messages sent across all peers */
  totalSent: number;
  /** Total messages received across all peers */
  totalReceived: number;
  /** Total messages currently queued across all peers */
  totalQueued: number;
  /** Total messages dropped across all peers */
  totalDropped: number;
  /** Total REPLENISH messages sent */
  replenishSent: number;
  /** Total REPLENISH messages received */
  replenishReceived: number;
}

// ─── Flow-Controlled Transport ───

export class FlowControlledTransport implements ITransport {
  readonly name: string;
  readonly maxPayloadBytes: number;
  readonly estimatedBandwidthMbps: number;

  private inner: ITransport;
  private config: FlowControlConfig;
  private peers = new Map<string, PeerFlowState>();
  private handlers = new Map<string, Set<TransportEventHandler>>();

  private replenishSent = 0;
  private replenishReceived = 0;

  constructor(inner: ITransport, config?: Partial<FlowControlConfig>) {
    this.inner = inner;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.name = `fc(${inner.name})`;
    this.maxPayloadBytes = inner.maxPayloadBytes;
    this.estimatedBandwidthMbps = inner.estimatedBandwidthMbps;

    // Subscribe to inner transport events
    this.inner.on('message', (event) => this.handleIncomingMessage(event));
    this.inner.on('peer_discovered', (event) => {
      this.ensurePeerState(event.peerAddress || 'unknown');
      this.emit(event);
    });
    this.inner.on('peer_lost', (event) => {
      if (event.peerAddress) this.peers.delete(event.peerAddress);
      this.emit(event);
    });
    this.inner.on('error', (event) => this.emit(event));
  }

  // ── Lifecycle ──

  async start(): Promise<void> {
    return this.inner.start();
  }

  async stop(): Promise<void> {
    return this.inner.stop();
  }

  isRunning(): boolean {
    return this.inner.isRunning();
  }

  // ── Discovery (pass-through) ──

  async startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void> {
    return this.inner.startBeaconing(beaconData, intervalMs);
  }

  async stopBeaconing(): Promise<void> {
    return this.inner.stopBeaconing();
  }

  async startScanning(): Promise<void> {
    return this.inner.startScanning();
  }

  async stopScanning(): Promise<void> {
    return this.inner.stopScanning();
  }

  // ── Data Transfer (flow-controlled) ──

  async sendTo(peerAddress: string, data: Uint8Array): Promise<void> {
    const state = this.ensurePeerState(peerAddress);

    if (state.sendCredits > 0) {
      // Have credits — send immediately
      state.sendCredits--;
      state.totalSent++;
      return this.inner.sendTo(peerAddress, data);
    }

    // No credits — queue
    if (state.sendQueue.length >= this.config.maxQueuePerPeer) {
      // Queue overflow — drop oldest
      state.sendQueue.shift();
      state.totalDropped++;
    }

    state.sendQueue.push(data);
    state.totalQueued++;
  }

  async broadcast(data: Uint8Array): Promise<void> {
    // Broadcast bypasses flow control (beacons, announcements)
    // Individual peers will send REPLENISH as needed
    return this.inner.broadcast(data);
  }

  // ── Events ──

  on(event: string, handler: TransportEventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: TransportEventHandler): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(event);
    }
  }

  // ── Public Accessors ──

  /** Get flow control stats */
  getStats(): FlowControlStats {
    let totalSent = 0, totalReceived = 0, totalQueued = 0, totalDropped = 0;
    for (const [, state] of this.peers) {
      totalSent += state.totalSent;
      totalReceived += state.totalReceived;
      totalQueued += state.sendQueue.length;
      totalDropped += state.totalDropped;
    }
    return {
      trackedPeers: this.peers.size,
      totalSent,
      totalReceived,
      totalQueued,
      totalDropped,
      replenishSent: this.replenishSent,
      replenishReceived: this.replenishReceived,
    };
  }

  /** Get credits remaining for a specific peer */
  getPeerCredits(peerAddress: string): number {
    const state = this.peers.get(peerAddress);
    return state ? state.sendCredits : 0;
  }

  /** Get queued message count for a specific peer */
  getPeerQueueSize(peerAddress: string): number {
    const state = this.peers.get(peerAddress);
    return state ? state.sendQueue.length : 0;
  }

  /** Manually grant credits to a peer (for testing or manual flow) */
  grantCredits(peerAddress: string, credits: number): void {
    const state = this.ensurePeerState(peerAddress);
    state.sendCredits += credits;
    this.flushQueue(peerAddress, state);
  }

  /** Get the inner transport */
  getInnerTransport(): ITransport {
    return this.inner;
  }

  // ── Internals ──

  private ensurePeerState(address: string): PeerFlowState {
    let state = this.peers.get(address);
    if (!state) {
      state = {
        sendCredits: this.config.initialCredits,
        receivedSinceReplenish: 0,
        sendQueue: [],
        totalSent: 0,
        totalReceived: 0,
        totalQueued: 0,
        totalDropped: 0,
      };
      this.peers.set(address, state);
    }
    return state;
  }

  private handleIncomingMessage(event: TransportEvent): void {
    if (!event.data || event.data.length === 0) return;

    // Check if this is a flow control message
    if (event.data.length === FC_MESSAGE_SIZE && event.data[0] === FC_MARKER) {
      this.handleReplenish(event);
      return;
    }

    // Regular message — count and maybe send REPLENISH
    const address = event.peerAddress || 'unknown';
    const state = this.ensurePeerState(address);
    state.totalReceived++;
    state.receivedSinceReplenish++;

    // Auto-replenish: after processing N messages, tell sender they have more credits
    if (state.receivedSinceReplenish >= this.config.replenishThreshold) {
      this.sendReplenish(address, this.config.replenishAmount);
      state.receivedSinceReplenish = 0;
    }

    // Forward to caller
    this.emit(event);
  }

  private handleReplenish(event: TransportEvent): void {
    if (!event.data || event.data.length < FC_MESSAGE_SIZE) return;

    const view = new DataView(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const credits = view.getUint32(1, false);

    const address = event.peerAddress || 'unknown';
    const state = this.ensurePeerState(address);
    state.sendCredits += credits;
    this.replenishReceived++;

    // Flush queued messages now that we have credits
    this.flushQueue(address, state);
  }

  private async sendReplenish(peerAddress: string, credits: number): Promise<void> {
    const msg = new Uint8Array(FC_MESSAGE_SIZE);
    msg[0] = FC_MARKER;
    const view = new DataView(msg.buffer);
    view.setUint32(1, credits, false);

    try {
      // Send directly on inner transport — replenish messages bypass flow control
      await this.inner.sendTo(peerAddress, msg);
      this.replenishSent++;
    } catch {
      // Failed to send replenish — peer may be disconnected
    }
  }

  private async flushQueue(address: string, state: PeerFlowState): Promise<void> {
    while (state.sendCredits > 0 && state.sendQueue.length > 0) {
      const msg = state.sendQueue.shift()!;
      state.sendCredits--;
      state.totalSent++;
      try {
        await this.inner.sendTo(address, msg);
      } catch {
        // Send failed — don't re-queue, it's already counted as sent
      }
    }
  }

  private emit(event: TransportEvent): void {
    for (const key of [event.type, 'all']) {
      const set = this.handlers.get(key);
      if (set) {
        for (const h of set) {
          try { h(event); } catch {}
        }
      }
    }
  }
}
