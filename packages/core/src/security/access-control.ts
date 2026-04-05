/**
 * CMP v4.0 — Access Control
 *
 * Per-node ACL controlling who can submit tasks.
 *
 * Modes:
 *   open:       Any device can submit tasks (default)
 *   whitelist:  Only listed mesh IDs allowed
 *   reputation: Minimum reputation score required (default: 2000)
 *   deposit:    Requester must lock CCU in escrow before task starts
 *
 * Multiple modes can be combined (all must pass).
 *
 * @module security/access-control
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';

const log = new Logger('ACL');

// ─── ACL Mode ───

export enum ACLMode {
  OPEN       = 'open',
  WHITELIST  = 'whitelist',
  REPUTATION = 'reputation',
  DEPOSIT    = 'deposit',
}

// ─── ACL Config ───

export interface ACLConfig {
  /** Active modes (all must pass) */
  modes: ACLMode[];
  /** Whitelisted mesh IDs (for WHITELIST mode) */
  whitelist: Set<string>;
  /** Minimum reputation score (for REPUTATION mode) */
  minReputation: number;
  /** Minimum CCU deposit (for DEPOSIT mode) */
  minDeposit: number;
}

export const DEFAULT_ACL_CONFIG: ACLConfig = {
  modes: [ACLMode.OPEN],
  whitelist: new Set(),
  minReputation: 2000,
  minDeposit: 10,
};

// ─── ACL Check Result ───

export interface ACLCheckResult {
  allowed: boolean;
  reason: string;
  failedMode: ACLMode | null;
}

// ─── Access Controller ───

export class AccessController {
  private config: ACLConfig;

  // Stats
  private stats = {
    totalChecks: 0,
    allowed: 0,
    denied: 0,
    deniedByMode: {} as Record<string, number>,
  };

  constructor(config: Partial<ACLConfig> = {}) {
    this.config = {
      ...DEFAULT_ACL_CONFIG,
      ...config,
      whitelist: config.whitelist ?? new Set(DEFAULT_ACL_CONFIG.whitelist),
      modes: config.modes ?? [...DEFAULT_ACL_CONFIG.modes],
    };
  }

  /**
   * Check if a device is allowed to submit tasks.
   */
  check(deviceId: string, reputation: number = 0, ccuBalance: number = 0): ACLCheckResult {
    this.stats.totalChecks++;

    for (const mode of this.config.modes) {
      switch (mode) {
        case ACLMode.OPEN:
          // Always passes
          break;

        case ACLMode.WHITELIST:
          if (!this.config.whitelist.has(deviceId)) {
            this.stats.denied++;
            this.stats.deniedByMode[ACLMode.WHITELIST] = (this.stats.deniedByMode[ACLMode.WHITELIST] || 0) + 1;
            return {
              allowed: false,
              reason: `Device ${deviceId.substring(0, 8)} not in whitelist`,
              failedMode: ACLMode.WHITELIST,
            };
          }
          break;

        case ACLMode.REPUTATION:
          if (reputation < this.config.minReputation) {
            this.stats.denied++;
            this.stats.deniedByMode[ACLMode.REPUTATION] = (this.stats.deniedByMode[ACLMode.REPUTATION] || 0) + 1;
            return {
              allowed: false,
              reason: `Reputation ${reputation} below minimum ${this.config.minReputation}`,
              failedMode: ACLMode.REPUTATION,
            };
          }
          break;

        case ACLMode.DEPOSIT:
          if (ccuBalance < this.config.minDeposit) {
            this.stats.denied++;
            this.stats.deniedByMode[ACLMode.DEPOSIT] = (this.stats.deniedByMode[ACLMode.DEPOSIT] || 0) + 1;
            return {
              allowed: false,
              reason: `CCU balance ${ccuBalance} below deposit requirement ${this.config.minDeposit}`,
              failedMode: ACLMode.DEPOSIT,
            };
          }
          break;
      }
    }

    this.stats.allowed++;
    return { allowed: true, reason: 'All ACL checks passed', failedMode: null };
  }

  // ── Configuration ──

  /**
   * Set active ACL modes.
   */
  setModes(modes: ACLMode[]): void {
    this.config.modes = modes;
    log.info(`ACL modes set: ${modes.join(', ')}`);
  }

  /**
   * Add a device to the whitelist.
   */
  addToWhitelist(deviceId: string): void {
    this.config.whitelist.add(deviceId);
  }

  /**
   * Remove a device from the whitelist.
   */
  removeFromWhitelist(deviceId: string): void {
    this.config.whitelist.delete(deviceId);
  }

  /**
   * Set minimum reputation threshold.
   */
  setMinReputation(min: number): void {
    this.config.minReputation = min;
  }

  /**
   * Set minimum deposit.
   */
  setMinDeposit(min: number): void {
    this.config.minDeposit = min;
  }

  /**
   * Get current config.
   */
  getConfig(): ACLConfig {
    return { ...this.config, whitelist: new Set(this.config.whitelist) };
  }

  /**
   * Get ACL stats.
   */
  getStats(): typeof this.stats {
    return { ...this.stats, deniedByMode: { ...this.stats.deniedByMode } };
  }
}
