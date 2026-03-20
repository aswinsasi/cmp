/**
 * CMP Capability Exchange Layer
 * Layer 2: After handshake completes, peers exchange full capability
 * profiles. This layer manages the exchange, periodic refresh,
 * and feeds the CapabilityMap.
 *
 * Flow:
 *   1. peer:handshake_complete event fires
 *   2. Send our capability profile to the new peer
 *   3. Receive their profile → store in CapabilityMap
 *   4. Every CAPABILITY_REFRESH_MS, re-profile and re-send if changed
 *
 * @module layers/capability-exchange
 * @author Agent Viscro
 */

import { ITransport, TransportEvent } from '../../transport/src/interface';
import { CMPCapability, CAPABILITY_REFRESH_MS } from '../types/capability';
import { MeshId } from '../types/primitives';
import { MessageType } from '../types/beacon';
import { EventBus } from '../mesh/event-bus';
import { PeerTable, PeerEntry } from '../mesh/peer-table';
import { CapabilityMap } from './capability-map';
import { DeviceProfiler } from './profiler';
import {
  encodeMessage,
  decodeMessage,
  encodeCapability,
  decodeCapability,
} from './serializer';
import { toHex, shortId } from '../utils/helpers';
import { Logger } from '../utils/logger';

const log = new Logger('CapExchange');

export class CapabilityExchange {
  private profiler: DeviceProfiler;
  private capMap: CapabilityMap;
  private peerTable: PeerTable;
  private bus: EventBus;
  private transport: ITransport;
  private meshId: MeshId;
  private running = false;

  /** Addresses resolved from discovery layer */
  private resolveAddress: (meshId: MeshId) => string | undefined;

  /** Track which peers we've exchanged with */
  private exchanged = new Set<string>();

  /** Periodic refresh timer */
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(
    meshId: MeshId,
    transport: ITransport,
    bus: EventBus,
    peerTable: PeerTable,
    capMap: CapabilityMap,
    profiler: DeviceProfiler,
    resolveAddress: (meshId: MeshId) => string | undefined
  ) {
    this.meshId = meshId;
    this.transport = transport;
    this.bus = bus;
    this.peerTable = peerTable;
    this.capMap = capMap;
    this.profiler = profiler;
    this.resolveAddress = resolveAddress;
  }

  /**
   * Start capability exchange layer.
   * Listens for handshake completions and incoming capability messages.
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Listen for new peer handshakes
    this.bus.on('peer:handshake_complete', (data) => {
      this.onHandshakeComplete(data.meshId);
    });

    // Listen for incoming messages
    this.transport.on('message', (event) => {
      this.onMessage(event);
    });

    // Listen for peer departures → remove from map
    this.bus.on('peer:lost', (data) => {
      this.capMap.remove(data.meshId);
      this.exchanged.delete(toHex(data.meshId));
    });

    // Profile ourselves initially
    await this.profiler.profile(this.meshId);

    // Start periodic refresh
    this.startRefreshLoop();

    // Register profiler change callback
    this.profiler.onChange((cap) => {
      this.broadcastCapability(cap);
    });

    this.running = true;
    log.info('Capability exchange started');
  }

  /**
   * Stop the capability exchange layer.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.stopRefreshLoop();
    this.exchanged.clear();
  }

  /**
   * Get the capability map.
   */
  getCapabilityMap(): CapabilityMap {
    return this.capMap;
  }

  /**
   * Get the profiler.
   */
  getProfiler(): DeviceProfiler {
    return this.profiler;
  }

  // ── Event Handlers ──

  private async onHandshakeComplete(peerId: MeshId): Promise<void> {
    const hex = toHex(peerId);
    if (this.exchanged.has(hex)) return;

    log.debug(`Exchanging capability with ${shortId(peerId)}`);

    // Send our capability to the new peer
    const myCapability = await this.profiler.profile(this.meshId);
    await this.sendCapabilityTo(peerId, myCapability);

    this.exchanged.add(hex);
  }

  private onMessage(event: TransportEvent): void {
    if (!this.running || !event.data) return;

    const msg = decodeMessage(event.data);
    if (!msg || msg.type !== MessageType.CAPABILITY_EXCHANGE) return;

    this.handleCapabilityMessage(msg.payload, event.peerAddress);
  }

  private handleCapabilityMessage(payload: Uint8Array, peerAddress?: string): void {
    const capability = decodeCapability(payload);
    if (!capability) {
      log.warn('Failed to decode capability message');
      return;
    }

    const peerId = capability.meshId;
    const hex = toHex(peerId);

    // Store in capability map
    this.capMap.update(peerId, capability);

    // Update peer table with network info
    const peer = this.peerTable.get(peerId);
    if (peer) {
      this.peerTable.upsert(peerId, {
        capability,
      });
    }

    // Mark as exchanged
    if (!this.exchanged.has(hex)) {
      this.exchanged.add(hex);
      // If they sent first, send ours back
      this.sendCapabilityTo(peerId, this.profiler.getLastProfile()!).catch(() => {});
    }

    log.debug(`Received capability from ${shortId(peerId)}`, {
      tier: capability.cpu.coresAvailable > 0 ? 'T' + Math.ceil(capability.memory.availableMb / 4096) : '?',
      cores: capability.cpu.coresAvailable,
      memMb: capability.memory.availableMb,
    });

    this.bus.emit('capability:updated', { meshId: peerId });
  }

  // ── Sending ──

  private async sendCapabilityTo(peerId: MeshId, capability: CMPCapability): Promise<void> {
    const addr = this.resolveAddress(peerId);
    if (!addr) {
      log.warn(`Cannot resolve address for ${shortId(peerId)}`);
      return;
    }

    const payload = encodeCapability(capability);
    const msg = encodeMessage(MessageType.CAPABILITY_EXCHANGE, payload);

    try {
      await this.transport.sendTo(addr, msg);
    } catch (err: any) {
      log.warn(`Failed to send capability to ${shortId(peerId)}: ${err.message}`);
    }
  }

  private async broadcastCapability(capability: CMPCapability): Promise<void> {
    const payload = encodeCapability(capability);
    const msg = encodeMessage(MessageType.CAPABILITY_EXCHANGE, payload);

    try {
      await this.transport.broadcast(msg);
    } catch (err: any) {
      log.warn(`Failed to broadcast capability: ${err.message}`);
    }
  }

  // ── Periodic Refresh ──

  private startRefreshLoop(): void {
    this.refreshTimer = setInterval(async () => {
      if (!this.running) return;

      // Re-profile
      const cap = await this.profiler.profile(this.meshId);

      // If capability changed significantly, broadcast to all peers
      const prev = this.profiler.getLastProfile();
      if (prev && this.profiler.hasSignificantChange(prev, cap)) {
        await this.broadcastCapability(cap);
      }
    }, CAPABILITY_REFRESH_MS);
  }

  private stopRefreshLoop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}
