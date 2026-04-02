/**
 * CMP v1.4 — Replication Manager
 * Manages Lifeform state replication to secondary hosts for fault tolerance.
 * Primary host processes causes; secondaries hold CRDT state replicas
 * that stay in sync via delta propagation.
 *
 * Features:
 *   - Configurable replica count (min/max per Lifeform)
 *   - Delta-based sync (only changed keys sent)
 *   - Automatic replica promotion on primary failure
 *   - Replica health monitoring
 *
 * @module lifeform/replication
 * @author Agent Viscro
 */

import { StateDelta } from './crdt/crdt-state';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Replica Info ───

export interface ReplicaInfo {
  /** Host device ID (hex) */
  hostId: string;
  /** Is this the primary replica? */
  isPrimary: boolean;
  /** Last delta sequence received */
  lastDeltaSequence: number;
  /** Last sync timestamp */
  lastSyncAt: number;
  /** Sync lag in ms (0 = fully synced) */
  syncLagMs: number;
  /** Replica health: 0.0 (dead) to 1.0 (healthy) */
  health: number;
  /** Added at timestamp */
  addedAt: number;
}

export interface ReplicationConfig {
  /** Minimum replicas (default: 1 = primary only) */
  minReplicas: number;
  /** Maximum replicas (default: 3) */
  maxReplicas: number;
  /** Sync interval for delta propagation (ms, default: 5000) */
  syncIntervalMs: number;
  /** Maximum sync lag before replica is unhealthy (ms, default: 30000) */
  maxSyncLagMs: number;
  /** Health check interval (ms, default: 10000) */
  healthCheckIntervalMs: number;
}

const DEFAULT_CONFIG: ReplicationConfig = {
  minReplicas: 1,
  maxReplicas: 3,
  syncIntervalMs: 5000,
  maxSyncLagMs: 30000,
  healthCheckIntervalMs: 10000,
};

export class ReplicationManager {
  /** lifeformId hex → Map of hostId hex → ReplicaInfo */
  private replicas = new Map<string, Map<string, ReplicaInfo>>();
  private config: ReplicationConfig;

  constructor(config?: Partial<ReplicationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize replication for a Lifeform with its primary host.
   */
  initializeReplica(lifeformId: string, primaryHostId: string): void {
    const replicaMap = new Map<string, ReplicaInfo>();
    replicaMap.set(primaryHostId, {
      hostId: primaryHostId,
      isPrimary: true,
      lastDeltaSequence: 0,
      lastSyncAt: Date.now(),
      syncLagMs: 0,
      health: 1.0,
      addedAt: Date.now(),
    });
    this.replicas.set(lifeformId, replicaMap);
  }

  /**
   * Add a secondary replica.
   */
  addReplica(lifeformId: string, hostId: string): boolean {
    const replicaMap = this.replicas.get(lifeformId);
    if (!replicaMap) return false;

    if (replicaMap.size >= this.config.maxReplicas) return false;
    if (replicaMap.has(hostId)) return false;

    replicaMap.set(hostId, {
      hostId,
      isPrimary: false,
      lastDeltaSequence: 0,
      lastSyncAt: Date.now(),
      syncLagMs: 0,
      health: 1.0,
      addedAt: Date.now(),
    });

    return true;
  }

  /**
   * Remove a replica.
   */
  removeReplica(lifeformId: string, hostId: string): boolean {
    const replicaMap = this.replicas.get(lifeformId);
    if (!replicaMap) return false;

    const replica = replicaMap.get(hostId);
    if (!replica) return false;
    if (replica.isPrimary) return false; // Can't remove primary

    return replicaMap.delete(hostId);
  }

  /**
   * Record that a delta was sent to a replica.
   */
  recordDeltaSync(lifeformId: string, hostId: string, deltaSequence: number): void {
    const replica = this.getReplica(lifeformId, hostId);
    if (!replica) return;

    replica.lastDeltaSequence = deltaSequence;
    replica.lastSyncAt = Date.now();
    replica.syncLagMs = 0;
    replica.health = Math.min(1.0, replica.health + 0.1);
  }

  /**
   * Promote a secondary to primary (when primary fails).
   * Returns the new primary host ID, or null if no healthy secondaries.
   */
  promoteToPrimary(lifeformId: string): string | null {
    const replicaMap = this.replicas.get(lifeformId);
    if (!replicaMap) return null;

    // Find the healthiest secondary
    let bestHost: string | null = null;
    let bestHealth = -1;

    for (const [hostId, replica] of replicaMap) {
      if (!replica.isPrimary && replica.health > bestHealth) {
        bestHealth = replica.health;
        bestHost = hostId;
      }
    }

    if (!bestHost) return null;

    // Demote old primary
    for (const replica of replicaMap.values()) {
      if (replica.isPrimary) {
        replica.isPrimary = false;
      }
    }

    // Promote new primary
    const newPrimary = replicaMap.get(bestHost)!;
    newPrimary.isPrimary = true;

    return bestHost;
  }

  /**
   * Get all replicas for a Lifeform.
   */
  getReplicas(lifeformId: string): ReplicaInfo[] {
    const replicaMap = this.replicas.get(lifeformId);
    if (!replicaMap) return [];
    return [...replicaMap.values()];
  }

  /**
   * Get a specific replica.
   */
  getReplica(lifeformId: string, hostId: string): ReplicaInfo | undefined {
    return this.replicas.get(lifeformId)?.get(hostId);
  }

  /**
   * Get the primary host for a Lifeform.
   */
  getPrimaryHost(lifeformId: string): string | null {
    const replicaMap = this.replicas.get(lifeformId);
    if (!replicaMap) return null;

    for (const [hostId, replica] of replicaMap) {
      if (replica.isPrimary) return hostId;
    }
    return null;
  }

  /**
   * Get secondary hosts for delta sync.
   */
  getSecondaryHosts(lifeformId: string): string[] {
    const replicaMap = this.replicas.get(lifeformId);
    if (!replicaMap) return [];
    return [...replicaMap.entries()]
      .filter(([_, r]) => !r.isPrimary)
      .map(([id]) => id);
  }

  /**
   * Check replica health and update sync lag.
   */
  healthCheck(lifeformId: string): { healthy: number; unhealthy: number; needsReplica: boolean } {
    const replicaMap = this.replicas.get(lifeformId);
    if (!replicaMap) return { healthy: 0, unhealthy: 0, needsReplica: true };

    const now = Date.now();
    let healthy = 0;
    let unhealthy = 0;

    for (const replica of replicaMap.values()) {
      replica.syncLagMs = now - replica.lastSyncAt;

      if (replica.syncLagMs > this.config.maxSyncLagMs) {
        replica.health = Math.max(0, replica.health - 0.2);
        unhealthy++;
      } else {
        healthy++;
      }
    }

    return {
      healthy,
      unhealthy,
      needsReplica: replicaMap.size < this.config.minReplicas,
    };
  }

  /**
   * Get replica count for a Lifeform.
   */
  replicaCount(lifeformId: string): number {
    return this.replicas.get(lifeformId)?.size ?? 0;
  }

  /**
   * Remove all replicas for a Lifeform (on death).
   */
  removeAll(lifeformId: string): void {
    this.replicas.delete(lifeformId);
  }

  /** Total Lifeforms being replicated */
  get totalLifeforms(): number {
    return this.replicas.size;
  }
}
