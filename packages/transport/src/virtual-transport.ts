/**
 * CMP Virtual Transport
 * In-memory transport for testing and mesh simulation.
 * All VirtualTransport instances sharing the same VirtualNetwork
 * can discover and communicate with each other.
 *
 * @module transport/virtual-transport
 * @author Agent Viscro
 */

import { ITransport, TransportEvent, TransportEventHandler } from './interface';

/**
 * Shared virtual network that connects VirtualTransport instances.
 */
export class VirtualNetwork {
  private nodes = new Map<string, VirtualTransport>();
  /** Simulated latency in ms (0 = instant) */
  latencyMs = 0;
  /** Packet loss rate (0.0 - 1.0) */
  packetLossRate = 0;

  register(id: string, transport: VirtualTransport): void {
    this.nodes.set(id, transport);
  }

  unregister(id: string): void {
    this.nodes.delete(id);
  }

  getNodes(): string[] {
    return [...this.nodes.keys()];
  }

  /**
   * Deliver a message from one node to another.
   */
  async deliver(fromId: string, toId: string, data: Uint8Array): Promise<void> {
    if (Math.random() < this.packetLossRate) return; // Simulate packet loss

    const target = this.nodes.get(toId);
    if (!target) return;

    const event: TransportEvent = {
      type: 'message',
      peerAddress: fromId,
      data,
      transport: 'virtual',
      timestamp: Date.now(),
    };

    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }

    target.receiveEvent(event);
  }

  /**
   * Broadcast a message from one node to all others.
   */
  async broadcastFrom(fromId: string, data: Uint8Array): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id] of this.nodes) {
      if (id !== fromId) {
        promises.push(this.deliver(fromId, id, data));
      }
    }
    await Promise.allSettled(promises);
  }

  /**
   * Broadcast a beacon from one node (triggers peer_discovered on others).
   */
  async beaconFrom(fromId: string, data: Uint8Array): Promise<void> {
    if (Math.random() < this.packetLossRate) return;

    for (const [id, transport] of this.nodes) {
      if (id !== fromId) {
        const event: TransportEvent = {
          type: 'peer_discovered',
          peerAddress: fromId,
          data,
          transport: 'virtual',
          timestamp: Date.now(),
        };

        if (this.latencyMs > 0) {
          setTimeout(() => transport.receiveEvent(event), this.latencyMs);
        } else {
          transport.receiveEvent(event);
        }
      }
    }
  }
}

/**
 * Virtual transport instance - one per simulated node.
 */
export class VirtualTransport implements ITransport {
  readonly name = 'virtual';
  readonly maxPayloadBytes = 1048576; // 1MB
  readonly estimatedBandwidthMbps = 10000; // Unlimited (in-memory)

  private running = false;
  private handlers = new Map<string, Set<TransportEventHandler>>();
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private beaconData: Uint8Array | null = null;

  constructor(
    private nodeId: string,
    private network: VirtualNetwork
  ) {
    network.register(nodeId, this);
  }

  // ── Lifecycle ──

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.stopBeaconing();
    this.network.unregister(this.nodeId);
    this.handlers.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Discovery ──

  async startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void> {
    this.beaconData = beaconData;
    await this.network.beaconFrom(this.nodeId, beaconData);
    this.beaconTimer = setInterval(() => {
      if (this.beaconData) {
        this.network.beaconFrom(this.nodeId, this.beaconData);
      }
    }, intervalMs);
  }

  async stopBeaconing(): Promise<void> {
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    this.beaconData = null;
  }

  async startScanning(): Promise<void> {
    // Virtual scanning is always active
  }

  async stopScanning(): Promise<void> {
    // No-op
  }

  // ── Data Transfer ──

  async sendTo(peerAddress: string, data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');
    await this.network.deliver(this.nodeId, peerAddress, data);
  }

  async broadcast(data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');
    await this.network.broadcastFrom(this.nodeId, data);
  }

  // ── Events ──

  on(event: string, handler: TransportEventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: TransportEventHandler): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * Called by VirtualNetwork to deliver events.
   * @internal
   */
  receiveEvent(event: TransportEvent): void {
    if (!this.running) return;

    const set = this.handlers.get(event.type);
    if (set) {
      for (const handler of set) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[VirtualTransport:${this.nodeId}] Handler error:`, err);
        }
      }
    }

    const allSet = this.handlers.get('all');
    if (allSet) {
      for (const handler of allSet) {
        try {
          handler(event);
        } catch {}
      }
    }
  }
}
