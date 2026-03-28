/**
 * CMP v1.3 — Quarantine Manager
 * Isolates suspicious devices from task assignment.
 * Three levels: WATCH (monitored), RESTRICTED (excluded from tasks),
 * EXPELLED (disconnected).
 *
 * Quarantines are time-limited — devices can rehabilitate.
 *
 * @module immune/quarantine-manager
 * @author Agent Viscro
 */

import {
  QuarantineEntry,
  QuarantineLevel,
  ThreatSeverity,
  ImmuneSystemConfig,
} from '../types/immune';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const DEFAULT_CONFIG: ImmuneSystemConfig = {
  minIncidentsForAntibody: 3,
  antibodyTtlMs: 7 * 24 * 3600 * 1000,
  mediumQuarantineDurationMs: 3600 * 1000,
  highQuarantineDurationMs: 24 * 3600 * 1000,
  maxFalsePositives: 5,
  enablePollinatedImmunity: true,
  minShareConfidence: 0.8,
};

export class QuarantineManager {
  /** deviceId hex → QuarantineEntry */
  private quarantines = new Map<string, QuarantineEntry>();
  private config: ImmuneSystemConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<ImmuneSystemConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start periodic cleanup of expired quarantines */
  start(): void {
    this.cleanupTimer = setInterval(() => this.purgeExpired(), 60000);
  }

  /** Stop cleanup timer */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Quarantine a device based on threat severity.
   * Severity mapping:
   *   LOW → WATCH
   *   MEDIUM → RESTRICTED (1 hour)
   *   HIGH → RESTRICTED (24 hours)
   *   CRITICAL → EXPELLED (24 hours)
   */
  quarantine(
    deviceId: Uint8Array,
    severity: ThreatSeverity,
    antibodyId: string,
  ): QuarantineEntry {
    const now = Date.now();
    const hex = toHex(deviceId);

    let level: QuarantineLevel;
    let durationMs: number;

    switch (severity) {
      case ThreatSeverity.LOW:
        level = QuarantineLevel.WATCH;
        durationMs = this.config.mediumQuarantineDurationMs / 2;
        break;
      case ThreatSeverity.MEDIUM:
        level = QuarantineLevel.RESTRICTED;
        durationMs = this.config.mediumQuarantineDurationMs;
        break;
      case ThreatSeverity.HIGH:
        level = QuarantineLevel.RESTRICTED;
        durationMs = this.config.highQuarantineDurationMs;
        break;
      case ThreatSeverity.CRITICAL:
        level = QuarantineLevel.EXPELLED;
        durationMs = this.config.highQuarantineDurationMs;
        break;
    }

    // Escalate if already quarantined
    const existing = this.quarantines.get(hex);
    if (existing) {
      if (levelRank(level) <= levelRank(existing.level)) {
        // Escalate: upgrade level and extend duration
        level = escalate(existing.level);
        durationMs = Math.max(durationMs, existing.expiresAt - now + durationMs);
      }
    }

    const entry: QuarantineEntry = {
      deviceId,
      level,
      triggeredBy: antibodyId,
      startedAt: now,
      expiresAt: now + durationMs,
      appealable: level !== QuarantineLevel.EXPELLED,
    };

    this.quarantines.set(hex, entry);
    return entry;
  }

  /**
   * Check if a device is quarantined.
   * Returns the quarantine entry or null.
   */
  getQuarantine(deviceId: Uint8Array): QuarantineEntry | null {
    const hex = toHex(deviceId);
    const entry = this.quarantines.get(hex);
    if (!entry) return null;

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.quarantines.delete(hex);
      return null;
    }

    return entry;
  }

  /**
   * Check if a device is excluded from task assignment.
   * RESTRICTED and EXPELLED devices are excluded.
   */
  isExcluded(deviceId: Uint8Array): boolean {
    const entry = this.getQuarantine(deviceId);
    if (!entry) return false;
    return entry.level === QuarantineLevel.RESTRICTED ||
           entry.level === QuarantineLevel.EXPELLED;
  }

  /**
   * Check if a device should be disconnected.
   */
  isExpelled(deviceId: Uint8Array): boolean {
    const entry = this.getQuarantine(deviceId);
    return entry?.level === QuarantineLevel.EXPELLED;
  }

  /**
   * Release a device from quarantine (e.g. on appeal or admin override).
   */
  release(deviceId: Uint8Array): boolean {
    const hex = toHex(deviceId);
    return this.quarantines.delete(hex);
  }

  /**
   * Purge expired quarantines.
   * @returns number of entries purged
   */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;

    for (const [hex, entry] of this.quarantines) {
      if (now > entry.expiresAt) {
        this.quarantines.delete(hex);
        purged++;
      }
    }

    return purged;
  }

  /**
   * Load quarantine entries (from persistence).
   */
  loadEntries(entries: QuarantineEntry[]): void {
    const now = Date.now();
    for (const entry of entries) {
      if (now < entry.expiresAt) {
        this.quarantines.set(toHex(entry.deviceId), entry);
      }
    }
  }

  /** Get all active quarantine entries */
  getAll(): QuarantineEntry[] {
    return [...this.quarantines.values()];
  }

  /** Number of quarantined devices */
  get size(): number {
    return this.quarantines.size;
  }
}

// ── Helpers ──

function levelRank(level: QuarantineLevel): number {
  switch (level) {
    case QuarantineLevel.WATCH: return 1;
    case QuarantineLevel.RESTRICTED: return 2;
    case QuarantineLevel.EXPELLED: return 3;
  }
}

function escalate(level: QuarantineLevel): QuarantineLevel {
  switch (level) {
    case QuarantineLevel.WATCH: return QuarantineLevel.RESTRICTED;
    case QuarantineLevel.RESTRICTED: return QuarantineLevel.EXPELLED;
    case QuarantineLevel.EXPELLED: return QuarantineLevel.EXPELLED;
  }
}
