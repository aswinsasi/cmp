/**
 * CMP v1.4 — Migration Manager
 * Handles Lifeform live migration between host devices.
 *
 * Migration Protocol:
 *   1. Select target host via HostSelector
 *   2. Lifeform transitions to MIGRATING state
 *   3. Snapshot CRDT state
 *   4. Transfer state + genome to new host
 *   5. New host spawns Lifeform from snapshot
 *   6. Old host confirms, DNS updates
 *   7. Lifeform transitions to ALIVE on new host
 *
 * @module lifeform/migration
 * @author Agent Viscro
 */

import { StateSnapshot } from './crdt/crdt-state';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ─── Migration Request ───

export interface MigrationRequest {
  /** Migration ID */
  id: Uint8Array;
  /** Lifeform ID being migrated */
  lifeformId: Uint8Array;
  /** Lifeform name */
  lifeformName: string;
  /** Current host device ID */
  fromHostId: Uint8Array;
  /** Target host device ID */
  toHostId: Uint8Array;
  /** Reason for migration */
  reason: MigrationReason;
  /** CRDT state snapshot */
  stateSnapshot: StateSnapshot;
  /** WASM genome hash */
  genomeHash: Uint8Array;
  /** WASM module binary (if not already cached on target) */
  wasmModule: Uint8Array | null;
  /** CCU balance to transfer */
  ccuBalance: number;
  /** Timers to transfer */
  timerData: any[];
  /** Synapse connections to preserve */
  synapseData: any[];
  /** Timestamp */
  requestedAt: number;
}

export enum MigrationReason {
  /** Host resources depleted */
  RESOURCE_SHORTAGE = 'resource_shortage',
  /** Better host available */
  BETTER_HOST = 'better_host',
  /** Host shutting down */
  HOST_DEPARTURE = 'host_departure',
  /** Manual migration request */
  MANUAL = 'manual',
  /** Load balancing */
  LOAD_BALANCE = 'load_balance',
}

export enum MigrationStatus {
  PENDING = 'pending',
  TRANSFERRING = 'transferring',
  CONFIRMING = 'confirming',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface MigrationRecord {
  id: Uint8Array;
  lifeformId: Uint8Array;
  fromHostId: Uint8Array;
  toHostId: Uint8Array;
  status: MigrationStatus;
  reason: MigrationReason;
  startedAt: number;
  completedAt: number | null;
  stateSize: number;
  error: string | null;
}

export class MigrationManager {
  /** Active migrations: migrationId hex → MigrationRecord */
  private activeMigrations = new Map<string, MigrationRecord>();

  /** Completed migrations history */
  private history: MigrationRecord[] = [];

  /** Stats */
  private totalMigrations = 0;
  private successfulMigrations = 0;
  private failedMigrations = 0;

  /**
   * Initiate a migration.
   * Creates a migration request and returns the migration ID.
   */
  initiate(
    lifeformId: Uint8Array,
    fromHostId: Uint8Array,
    toHostId: Uint8Array,
    reason: MigrationReason,
    stateSnapshot: StateSnapshot,
  ): MigrationRecord {
    const id = randomBytes(16);
    const record: MigrationRecord = {
      id,
      lifeformId,
      fromHostId,
      toHostId,
      status: MigrationStatus.PENDING,
      reason,
      startedAt: Date.now(),
      completedAt: null,
      stateSize: stateSnapshot.sizeBytes,
      error: null,
    };

    this.activeMigrations.set(toHex(id), record);
    this.totalMigrations++;
    return record;
  }

  /**
   * Mark migration as transferring (state being sent).
   */
  markTransferring(migrationId: Uint8Array): boolean {
    const record = this.activeMigrations.get(toHex(migrationId));
    if (!record || record.status !== MigrationStatus.PENDING) return false;
    record.status = MigrationStatus.TRANSFERRING;
    return true;
  }

  /**
   * Mark migration as confirming (target received state, confirming).
   */
  markConfirming(migrationId: Uint8Array): boolean {
    const record = this.activeMigrations.get(toHex(migrationId));
    if (!record || record.status !== MigrationStatus.TRANSFERRING) return false;
    record.status = MigrationStatus.CONFIRMING;
    return true;
  }

  /**
   * Complete a migration successfully.
   */
  complete(migrationId: Uint8Array): boolean {
    const hex = toHex(migrationId);
    const record = this.activeMigrations.get(hex);
    if (!record) return false;

    record.status = MigrationStatus.COMPLETED;
    record.completedAt = Date.now();
    this.successfulMigrations++;

    this.history.push(record);
    this.activeMigrations.delete(hex);
    return true;
  }

  /**
   * Fail a migration.
   */
  fail(migrationId: Uint8Array, error: string): boolean {
    const hex = toHex(migrationId);
    const record = this.activeMigrations.get(hex);
    if (!record) return false;

    record.status = MigrationStatus.FAILED;
    record.completedAt = Date.now();
    record.error = error;
    this.failedMigrations++;

    this.history.push(record);
    this.activeMigrations.delete(hex);
    return true;
  }

  /**
   * Get active migration for a Lifeform.
   */
  getActiveMigration(lifeformId: Uint8Array): MigrationRecord | null {
    const lfHex = toHex(lifeformId);
    for (const record of this.activeMigrations.values()) {
      if (toHex(record.lifeformId) === lfHex) return record;
    }
    return null;
  }

  /**
   * Check if a Lifeform is currently migrating.
   */
  isMigrating(lifeformId: Uint8Array): boolean {
    return this.getActiveMigration(lifeformId) !== null;
  }

  /** Get migration history */
  getHistory(): MigrationRecord[] {
    return [...this.history];
  }

  /** Get stats */
  getStats(): { total: number; successful: number; failed: number; active: number } {
    return {
      total: this.totalMigrations,
      successful: this.successfulMigrations,
      failed: this.failedMigrations,
      active: this.activeMigrations.size,
    };
  }
}
