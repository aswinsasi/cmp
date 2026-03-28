/**
 * CMP Peer Table
 * Manages the list of known mesh participants with their capabilities,
 * connection state, and liveness tracking.
 *
 * @module mesh/peer-table
 * @author Agent Viscro
 */

import { MeshId, SessionKey, PublicKey } from '../types/primitives';
import { CMPCapability, CapabilityTier, classifyTier } from '../types/capability';
import { EventBus } from './event-bus';
import { toHex, shortId } from '../utils/helpers';
import { Logger } from '../utils/logger';

const log = new Logger('PeerTable');

export type PeerState = 'discovered' | 'handshaking' | 'active' | 'stale';

export interface PeerEntry {
  meshId: MeshId;
  hexId: string;
  capability?: CMPCapability;
  tier?: CapabilityTier;
  lastSeen: number;
  transports: string[];
  publicKey?: PublicKey;
  sessionKey?: SessionKey;
  state: PeerState;
  latencyMs: number;
  reputationScore: number;
}

export class PeerTable {
  private peers = new Map<string, PeerEntry>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private bus: EventBus,
    private staleMs: number = 30000,
    private deadMs: number = 60000
  ) {
    this.startCleanupLoop();
  }

  /**
   * Add or update a peer in the table.
   */
  upsert(meshId: MeshId, update: Partial<PeerEntry>): PeerEntry {
    const hex = toHex(meshId);
    const existing = this.peers.get(hex);

    const entry: PeerEntry = {
      meshId,
      hexId: hex,
      state: 'discovered',
      transports: [],
      latencyMs: 0,
      reputationScore: 5000,
      lastSeen: Date.now(),
      ...existing,
      ...update,
    };
    // Always update lastSeen to now
    entry.lastSeen = Date.now();

    // Classify tier if capability is available
    if (entry.capability) {
      entry.tier = classifyTier(entry.capability);
    }

    const isNew = !existing;
    this.peers.set(hex, entry);

    if (isNew) {
      log.info(`New peer: ${shortId(meshId)} (${entry.state})`, {
        transports: entry.transports,
      });
      this.bus.emit('peer:discovered', {
        meshId,
        transport: entry.transports[0] || 'unknown',
      });
    }

    return entry;
  }

  /**
   * Get a peer by MeshId.
   */
  get(meshId: MeshId): PeerEntry | undefined {
    return this.peers.get(toHex(meshId));
  }

  /**
   * Get a peer by hex ID string.
   */
  getByHex(hexId: string): PeerEntry | undefined {
    return this.peers.get(hexId);
  }

  /**
   * Remove a peer from the table.
   */
  remove(meshId: MeshId): boolean {
    const hex = toHex(meshId);
    const existed = this.peers.has(hex);
    this.peers.delete(hex);
    if (existed) {
      this.bus.emit('peer:lost', { meshId, reason: 'removed' });
    }
    return existed;
  }

  /**
   * Get all peers in the 'active' state.
   */
  getActive(): PeerEntry[] {
    return [...this.peers.values()].filter((p) => p.state === 'active');
  }

  /**
   * Get all peers at or above a minimum capability tier.
   */
  getByMinTier(minTier: CapabilityTier): PeerEntry[] {
    return this.getActive().filter(
      (p) => p.tier !== undefined && p.tier >= minTier
    );
  }

  /**
   * Get all known peers regardless of state.
   */
  getAll(): PeerEntry[] {
    return [...this.peers.values()];
  }

  /**
   * Total number of peers in the table.
   */
  get size(): number {
    return this.peers.size;
  }

  /**
   * Number of active peers.
   */
  get activeCount(): number {
    return this.getActive().length;
  }

  /**
   * Mark a peer's transport as having been seen via beacon.
   */
  touchBeacon(meshId: MeshId, transport: string): void {
    const hex = toHex(meshId);
    const entry = this.peers.get(hex);
    if (entry) {
      entry.lastSeen = Date.now();
      if (!entry.transports.includes(transport)) {
        entry.transports.push(transport);
      }
    }
  }

  /**
   * Cleanup: mark stale peers, remove dead peers.
   */
  private startCleanupLoop(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();

      for (const [hex, peer] of this.peers) {
        const age = now - peer.lastSeen;

        if (age > this.deadMs) {
          log.info(`Peer dead: ${shortId(peer.meshId)} (${age}ms inactive)`);
          this.peers.delete(hex);
          this.bus.emit('peer:lost', { meshId: peer.meshId, reason: 'timeout' });
        } else if (age > this.staleMs && peer.state === 'active') {
          peer.state = 'stale';
          log.debug(`Peer stale: ${shortId(peer.meshId)}`);
          this.bus.emit('peer:stale', { meshId: peer.meshId });
        }
      }
    }, 5000);
  }

  /**
   * Stop the cleanup loop.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.peers.clear();
  }
}
