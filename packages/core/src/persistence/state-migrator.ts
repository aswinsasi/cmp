/**
 * CMP v4.0 — State Migrator
 *
 * Schema versioning and migration system for the V3 State Store.
 * Reads the current schema version from SQLite, applies sequential
 * migrations to bring the schema up to the latest version.
 *
 * Each migration is a function that receives the V3StateStore and
 * performs DDL or data transforms. Migrations are idempotent —
 * running them twice is safe.
 *
 * Migration naming: v{from}_to_v{to}
 * Example: v1_to_v2, v2_to_v3
 *
 * Usage:
 *   const migrator = new StateMigrator(store);
 *   const result = migrator.migrate();
 *   // result.migrationsApplied: ['v1_to_v2', 'v2_to_v3']
 *
 * @module persistence/state-migrator
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { V3StateStore } from './v3-state-store';

const log = new Logger('Migrator');

// ─── Migration Types ───

export interface Migration {
  /** Migration name, e.g. 'v1_to_v2' */
  name: string;
  /** Target schema version after this migration */
  targetVersion: number;
  /** Migration function — receives the store */
  up: (store: V3StateStore) => void;
  /** Optional rollback function */
  down?: (store: V3StateStore) => void;
  /** Human-readable description */
  description: string;
}

export interface MigrationResult {
  previousVersion: number;
  currentVersion: number;
  migrationsApplied: string[];
  durationMs: number;
  errors: string[];
}

// ─── Migration Registry ───

/**
 * All migrations in sequential order.
 * Add new migrations at the end of this array.
 *
 * Current schema: v1 (initial)
 *
 * Future migrations will be added here as the schema evolves.
 * Example:
 *   {
 *     name: 'v1_to_v2',
 *     targetVersion: 2,
 *     description: 'Add job_queue table for Phase 2',
 *     up: (store) => {
 *       // DDL changes via raw SQL or state transforms
 *       store.saveState('_migration', 'v2_marker', { appliedAt: Date.now() });
 *     },
 *   }
 */
const MIGRATIONS: Migration[] = [
  // v1 is the initial schema — no migrations needed yet.
  // Future migrations go here:
  //
  // {
  //   name: 'v1_to_v2',
  //   targetVersion: 2,
  //   description: 'Add job_queue and job_results tables for Phase 2',
  //   up: (store) => {
  //     store.saveState('_migration', 'v2_applied', { at: Date.now() });
  //   },
  // },
];

// ─── State Migrator ───

export class StateMigrator {
  private store: V3StateStore;
  private migrations: Migration[];

  constructor(store: V3StateStore, customMigrations?: Migration[]) {
    this.store = store;
    this.migrations = customMigrations ?? MIGRATIONS;
  }

  /**
   * Get the current schema version.
   */
  getCurrentVersion(): number {
    return this.store.getSchemaVersion();
  }

  /**
   * Get the latest available schema version.
   */
  getLatestVersion(): number {
    if (this.migrations.length === 0) return 1; // Initial version
    return Math.max(1, ...this.migrations.map(m => m.targetVersion));
  }

  /**
   * Check if migrations are needed.
   */
  needsMigration(): boolean {
    return this.getCurrentVersion() < this.getLatestVersion();
  }

  /**
   * Get pending migrations.
   */
  getPendingMigrations(): Migration[] {
    const currentVersion = this.getCurrentVersion();
    return this.migrations.filter(m => m.targetVersion > currentVersion);
  }

  /**
   * Apply all pending migrations sequentially.
   * Each migration updates the schema version on success.
   */
  migrate(): MigrationResult {
    const startMs = Date.now();
    const previousVersion = this.getCurrentVersion();
    const pending = this.getPendingMigrations();
    const applied: string[] = [];
    const errors: string[] = [];

    if (pending.length === 0) {
      log.info(`Schema is current (v${previousVersion}), no migrations needed`);
      return {
        previousVersion,
        currentVersion: previousVersion,
        migrationsApplied: [],
        durationMs: Date.now() - startMs,
        errors: [],
      };
    }

    log.info(`Running ${pending.length} migration(s) from v${previousVersion}...`);

    // Sort by target version to ensure order
    const sorted = [...pending].sort((a, b) => a.targetVersion - b.targetVersion);

    for (const migration of sorted) {
      try {
        log.info(`Applying ${migration.name}: ${migration.description}`);
        migration.up(this.store);
        this.store.setSchemaVersion(migration.targetVersion);
        applied.push(migration.name);
        log.info(`Migration ${migration.name} applied successfully → v${migration.targetVersion}`);
      } catch (err: any) {
        const errorMsg = `Migration ${migration.name} failed: ${err.message}`;
        log.warn(errorMsg);
        errors.push(errorMsg);
        // Stop on first error — don't skip migrations
        break;
      }
    }

    // Flush after all migrations
    this.store.forceSave();

    const currentVersion = this.getCurrentVersion();
    const durationMs = Date.now() - startMs;

    log.info(`Migration complete: v${previousVersion} → v${currentVersion} (${applied.length} applied, ${errors.length} errors) in ${durationMs}ms`);

    return { previousVersion, currentVersion, migrationsApplied: applied, durationMs, errors };
  }

  /**
   * Rollback the last N migrations (if down functions exist).
   */
  rollback(count: number = 1): MigrationResult {
    const startMs = Date.now();
    const currentVersion = this.getCurrentVersion();
    const applied: string[] = [];
    const errors: string[] = [];

    // Find migrations to rollback (in reverse order)
    const toRollback = this.migrations
      .filter(m => m.targetVersion <= currentVersion && m.down)
      .sort((a, b) => b.targetVersion - a.targetVersion)
      .slice(0, count);

    if (toRollback.length === 0) {
      log.info('No migrations to rollback');
      return {
        previousVersion: currentVersion,
        currentVersion,
        migrationsApplied: [],
        durationMs: Date.now() - startMs,
        errors: [],
      };
    }

    for (const migration of toRollback) {
      try {
        log.info(`Rolling back ${migration.name}`);
        migration.down!(this.store);
        // Set version to one below this migration
        const newVersion = migration.targetVersion - 1;
        this.store.setSchemaVersion(newVersion);
        applied.push(`rollback:${migration.name}`);
      } catch (err: any) {
        errors.push(`Rollback ${migration.name} failed: ${err.message}`);
        break;
      }
    }

    this.store.forceSave();

    return {
      previousVersion: currentVersion,
      currentVersion: this.getCurrentVersion(),
      migrationsApplied: applied,
      durationMs: Date.now() - startMs,
      errors,
    };
  }

  /**
   * Validate the migration chain — checks for gaps, duplicates.
   */
  validate(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const versions = new Set<number>();

    for (const m of this.migrations) {
      if (versions.has(m.targetVersion)) {
        issues.push(`Duplicate target version ${m.targetVersion} in migration ${m.name}`);
      }
      versions.add(m.targetVersion);

      if (!m.name || !m.up || !m.description) {
        issues.push(`Migration ${m.name ?? '(unnamed)'} is missing required fields`);
      }
    }

    // Check for gaps
    const sorted = [...versions].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) {
        issues.push(`Version gap: v${sorted[i - 1]} → v${sorted[i]} (expected v${sorted[i - 1] + 1})`);
      }
    }

    return { valid: issues.length === 0, issues };
  }
}

export { MIGRATIONS };
