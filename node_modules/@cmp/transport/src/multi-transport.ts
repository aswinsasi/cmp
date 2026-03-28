/**
 * CMP Multi-Transport Aggregator
 * Manages multiple transport implementations and provides unified
 * discovery and data transfer. Automatically selects the best
 * transport for each peer based on bandwidth and payload size.
 *
 * @module transport/multi-transport
 * @author Agent Viscro
 */

import { ITransport, TransportEvent, TransportEventHandler } from './interface';

interface PeerTransportInfo {
  address: string;
  transports: Map<string, ITransport>;
  preferredTransport?: ITransport;
}

export class MultiTransport implements ITransport {
  readonly name = 'multi';
  readonly maxPayloadBytes = 1048576;
  readonly estimatedBandwidthMbps = 0; // Varies by transport

  private transports: ITransport[] = [];
  private running = false;
  private handlers = new Map<string, Set<TransportEventHandler>>();

  /** peer address -> transport info */
  private peerMap = new Map<string, PeerTransportInfo>();

  /**
   * Register a transport implementation.
   */
  register(transport: ITransport): void {
    this.transports.push(transport);

    // Forward events from child transports
    transport.on('peer_discovered', (event) => {
      this.handlePeerDiscovered(event, transport);
    });

    transport.on('message', (event) => {
      // Tag the transport and re-emit
      this.emit({ ...event, transport: transport.name });
    });

    transport.on('peer_lost', (event) => {
      if (event.peerAddress) {
        this.handlePeerLost(event.peerAddress, transport);
      }
      this.emit(event);
    });

    transport.on('error', (event) => {
      this.emit(event);
    });
  }

  // ── Lifecycle ──

  async start(): Promise<void> {
    if (this.running) return;
    await Promise.all(this.transports.map((t) => t.start()));
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all(this.transports.map((t) => t.stop()));
    this.peerMap.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Discovery ──

  async startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void> {
    await Promise.all(
      this.transports.map((t) => t.startBeaconing(beaconData, intervalMs))
    );
  }

  async stopBeaconing(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.stopBeaconing()));
  }

  async startScanning(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.startScanning()));
  }

  async stopScanning(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.stopScanning()));
  }

  // ── Data Transfer ──

  async sendTo(peerAddress: string, data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');

    const transport = this.selectTransport(peerAddress, data.length);
    if (!transport) {
      throw new Error(`No transport available for peer: ${peerAddress}`);
    }

    await transport.sendTo(peerAddress, data);
  }

  async broadcast(data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');

    // Broadcast on all transports
    await Promise.allSettled(
      this.transports.map((t) => t.broadcast(data))
    );
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
    if (set) set.delete(handler);
  }

  // ── Internals ──

  private emit(event: TransportEvent): void {
    const set = this.handlers.get(event.type);
    if (set) {
      for (const handler of set) {
        try {
          handler(event);
        } catch {}
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

  private handlePeerDiscovered(event: TransportEvent, transport: ITransport): void {
    const addr = event.peerAddress;
    if (!addr) return;

    let info = this.peerMap.get(addr);
    if (!info) {
      info = { address: addr, transports: new Map() };
      this.peerMap.set(addr, info);
    }

    info.transports.set(transport.name, transport);
    info.preferredTransport = this.rankTransports(info);

    // Re-emit the discovery event
    this.emit(event);
  }

  private handlePeerLost(address: string, transport: ITransport): void {
    const info = this.peerMap.get(address);
    if (!info) return;

    info.transports.delete(transport.name);
    if (info.transports.size === 0) {
      this.peerMap.delete(address);
    } else {
      info.preferredTransport = this.rankTransports(info);
    }
  }

  /**
   * Select the best transport for a given peer and payload size.
   * Priority: LAN > Wi-Fi Direct > BLE (for large payloads)
   */
  private selectTransport(
    peerAddress: string,
    payloadSize: number
  ): ITransport | null {
    const info = this.peerMap.get(peerAddress);
    if (!info || info.transports.size === 0) {
      // Try the first registered transport that supports the size
      return (
        this.transports.find((t) => t.maxPayloadBytes >= payloadSize) || null
      );
    }

    // Filter by payload size capability
    const capable = [...info.transports.values()].filter(
      (t) => t.maxPayloadBytes >= payloadSize
    );

    if (capable.length === 0) return null;

    // Sort by bandwidth (highest first)
    capable.sort(
      (a, b) => b.estimatedBandwidthMbps - a.estimatedBandwidthMbps
    );

    return capable[0];
  }

  /**
   * Rank available transports for a peer and return the best one.
   */
  private rankTransports(info: PeerTransportInfo): ITransport {
    const all = [...info.transports.values()];
    all.sort(
      (a, b) => b.estimatedBandwidthMbps - a.estimatedBandwidthMbps
    );
    return all[0];
  }

  /**
   * Get count of registered transports.
   */
  get transportCount(): number {
    return this.transports.length;
  }

  /**
   * Get all known peer addresses.
   */
  getKnownPeers(): string[] {
    return [...this.peerMap.keys()];
  }
}
