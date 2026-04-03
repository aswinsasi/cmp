/**
 * CMP v3.0 — Computation Entanglement Type Definitions
 * Bidirectional symmetric CRDT state mirroring between two Lifeforms.
 *
 * Unlike replication (master → slave), entanglement is symmetric:
 * both Lifeforms are primaries. A change in either is immediately
 * reflected in the other via CRDT merge (guaranteed convergence).
 *
 * @module types/entanglement
 * @author Agent Viscro
 */

// ─── Entanglement Record ───

export interface EntanglementRecord {
  /** Unique entanglement ID (hex) */
  id: string;
  /** First Lifeform name */
  lifeformA: string;
  /** Second Lifeform name */
  lifeformB: string;
  /** Timestamp of entanglement creation */
  createdAt: number;
  /** Whether entanglement is active */
  active: boolean;
  /** Total deltas synced since entanglement */
  deltasSynced: number;
  /** Keys being entangled (empty = all keys) */
  keyFilter: string[];
}

// ─── Entanglement Configuration ───

export interface EntanglementConfig {
  /** Max concurrent entanglements per Lifeform (default: 3) */
  maxEntanglementsPerLifeform: number;
  /** Sync mode: 'immediate' applies delta on every mutation,
   *  'batched' collects and applies every intervalMs */
  syncMode: 'immediate' | 'batched';
  /** Batch interval in ms (only if syncMode = 'batched') */
  batchIntervalMs: number;
  /** Whether to sync across devices (requires transport) or local-only */
  crossDevice: boolean;
}

export const DEFAULT_ENTANGLEMENT_CONFIG: EntanglementConfig = {
  maxEntanglementsPerLifeform: 3,
  syncMode: 'immediate',
  batchIntervalMs: 100,
  crossDevice: false,
};

// ─── Entanglement Events ───

export interface EntanglementEvent {
  type: 'created' | 'broken' | 'synced' | 'conflict';
  entanglementId: string;
  lifeformA: string;
  lifeformB: string;
  timestamp: number;
  detail?: string;
}
