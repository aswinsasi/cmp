"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationManager = exports.MigrationStatus = exports.MigrationReason = void 0;
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < n; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}
var MigrationReason;
(function (MigrationReason) {
    /** Host resources depleted */
    MigrationReason["RESOURCE_SHORTAGE"] = "resource_shortage";
    /** Better host available */
    MigrationReason["BETTER_HOST"] = "better_host";
    /** Host shutting down */
    MigrationReason["HOST_DEPARTURE"] = "host_departure";
    /** Manual migration request */
    MigrationReason["MANUAL"] = "manual";
    /** Load balancing */
    MigrationReason["LOAD_BALANCE"] = "load_balance";
})(MigrationReason || (exports.MigrationReason = MigrationReason = {}));
var MigrationStatus;
(function (MigrationStatus) {
    MigrationStatus["PENDING"] = "pending";
    MigrationStatus["TRANSFERRING"] = "transferring";
    MigrationStatus["CONFIRMING"] = "confirming";
    MigrationStatus["COMPLETED"] = "completed";
    MigrationStatus["FAILED"] = "failed";
})(MigrationStatus || (exports.MigrationStatus = MigrationStatus = {}));
class MigrationManager {
    /** Active migrations: migrationId hex → MigrationRecord */
    activeMigrations = new Map();
    /** Completed migrations history */
    history = [];
    /** Stats */
    totalMigrations = 0;
    successfulMigrations = 0;
    failedMigrations = 0;
    /**
     * Initiate a migration.
     * Creates a migration request and returns the migration ID.
     */
    initiate(lifeformId, fromHostId, toHostId, reason, stateSnapshot) {
        const id = randomBytes(16);
        const record = {
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
    markTransferring(migrationId) {
        const record = this.activeMigrations.get(toHex(migrationId));
        if (!record || record.status !== MigrationStatus.PENDING)
            return false;
        record.status = MigrationStatus.TRANSFERRING;
        return true;
    }
    /**
     * Mark migration as confirming (target received state, confirming).
     */
    markConfirming(migrationId) {
        const record = this.activeMigrations.get(toHex(migrationId));
        if (!record || record.status !== MigrationStatus.TRANSFERRING)
            return false;
        record.status = MigrationStatus.CONFIRMING;
        return true;
    }
    /**
     * Complete a migration successfully.
     */
    complete(migrationId) {
        const hex = toHex(migrationId);
        const record = this.activeMigrations.get(hex);
        if (!record)
            return false;
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
    fail(migrationId, error) {
        const hex = toHex(migrationId);
        const record = this.activeMigrations.get(hex);
        if (!record)
            return false;
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
    getActiveMigration(lifeformId) {
        const lfHex = toHex(lifeformId);
        for (const record of this.activeMigrations.values()) {
            if (toHex(record.lifeformId) === lfHex)
                return record;
        }
        return null;
    }
    /**
     * Check if a Lifeform is currently migrating.
     */
    isMigrating(lifeformId) {
        return this.getActiveMigration(lifeformId) !== null;
    }
    /** Get migration history */
    getHistory() {
        return [...this.history];
    }
    /** Get stats */
    getStats() {
        return {
            total: this.totalMigrations,
            successful: this.successfulMigrations,
            failed: this.failedMigrations,
            active: this.activeMigrations.size,
        };
    }
}
exports.MigrationManager = MigrationManager;
//# sourceMappingURL=migration.js.map