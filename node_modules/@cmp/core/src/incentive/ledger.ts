/**
 * CMP Incentive Ledger
 * Tracks credits (CCU) and reputation for all known mesh participants.
 *
 * Credits:
 *   - New nodes bootstrap with 100 CCU
 *   - Requesters spend CCU to submit tasks (deducted on assignment)
 *   - Executors earn CCU on successful chunk completion
 *   - Ledger prevents spending more than available balance
 *
 * Reputation:
 *   - New nodes start at 5000 / 10000
 *   - Updated after each task: completion rate, accuracy, availability, honesty
 *   - Decays 5% per week of inactivity
 *   - Below 2000: deprioritized in assignment
 *   - Below 500: excluded from mesh participation
 *
 * Persistence:
 *   - In-memory with optional JSON file save/load
 *   - Call save() to persist, load() to restore
 *
 * @module incentive/ledger
 * @author Agent Viscro
 */

import {
  BOOTSTRAP_CREDITS,
  REPUTATION_DEFAULT,
  REPUTATION_MIN,
  REPUTATION_MAX,
  REPUTATION_DECAY_RATE,
  REPUTATION_WEIGHTS,
} from '../types/incentive';
import type { ReputationFactors, CreditTransaction } from '../types/incentive';
import type { CCU } from '../types/primitives';
import { sign, hash256 } from '../crypto';
import { Logger } from '../utils/logger';

const log = new Logger('Ledger');

/** Per-node account in the ledger */
export interface LedgerAccount {
  meshIdHex: string;
  credits: CCU;
  reputation: number;
  factors: ReputationFactors;
  /** Total tasks completed as executor */
  tasksCompleted: number;
  /** Total tasks failed as executor */
  tasksFailed: number;
  /** Total tasks submitted as requester */
  tasksSubmitted: number;
  /** Total credits earned */
  totalEarned: CCU;
  /** Total credits spent */
  totalSpent: CCU;
  /** Last activity timestamp */
  lastActiveMs: number;
  /** Account creation timestamp */
  createdMs: number;
}

/** Ledger configuration */
export interface LedgerConfig {
  /** Initial credits for new accounts */
  bootstrapCredits: CCU;
  /** Weekly reputation decay rate (0.0 - 1.0) */
  decayRate: number;
  /** Minimum reputation to participate in mesh */
  minReputation: number;
  /** Ed25519 signing secret key (64 bytes) for signing transactions */
  signingKey?: Uint8Array;
}

const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  bootstrapCredits: BOOTSTRAP_CREDITS,
  decayRate: REPUTATION_DECAY_RATE,
  minReputation: 500,
};

export class IncentiveLedger {
  private accounts = new Map<string, LedgerAccount>();
  private transactions: CreditTransaction[] = [];
  private config: LedgerConfig;

  constructor(config?: Partial<LedgerConfig>) {
    this.config = { ...DEFAULT_LEDGER_CONFIG, ...config };
  }

  // ══════════════════════════════════════════
  // Account Management
  // ══════════════════════════════════════════

  /**
   * Get or create an account for a mesh participant.
   * New accounts receive bootstrap credits and default reputation.
   */
  getAccount(meshIdHex: string): LedgerAccount {
    let account = this.accounts.get(meshIdHex);
    if (!account) {
      account = {
        meshIdHex,
        credits: this.config.bootstrapCredits,
        reputation: REPUTATION_DEFAULT,
        factors: {
          completionRate: 1.0,
          accuracyRate: 1.0,
          availabilityRate: 1.0,
          resourceHonesty: 1.0,
        },
        tasksCompleted: 0,
        tasksFailed: 0,
        tasksSubmitted: 0,
        totalEarned: 0,
        totalSpent: 0,
        lastActiveMs: Date.now(),
        createdMs: Date.now(),
      };
      this.accounts.set(meshIdHex, account);
      log.info(`New account: ${meshIdHex.substring(0, 8)} (${this.config.bootstrapCredits} CCU)`);
    }
    return account;
  }

  /**
   * Check if an account exists.
   */
  hasAccount(meshIdHex: string): boolean {
    return this.accounts.has(meshIdHex);
  }

  /**
   * Get all accounts.
   */
  getAllAccounts(): LedgerAccount[] {
    return [...this.accounts.values()];
  }

  // ══════════════════════════════════════════
  // Credits
  // ══════════════════════════════════════════

  /**
   * Get credit balance for a mesh participant.
   */
  getBalance(meshIdHex: string): CCU {
    return this.getAccount(meshIdHex).credits;
  }

  /**
   * Check if a participant can afford a given amount.
   */
  canAfford(meshIdHex: string, amount: CCU): boolean {
    return this.getBalance(meshIdHex) >= amount;
  }

  /**
   * Spend credits (requester submitting a task).
   * Returns false if insufficient balance.
   */
  spendCredits(meshIdHex: string, amount: CCU, taskId: string, chunkId: string = ''): boolean {
    const account = this.getAccount(meshIdHex);
    if (account.credits < amount) {
      log.warn(`Insufficient credits: ${meshIdHex.substring(0, 8)} has ${account.credits}, needs ${amount}`);
      return false;
    }

    account.credits -= amount;
    account.totalSpent += amount;
    account.tasksSubmitted++;
    account.lastActiveMs = Date.now();

    log.debug(`Spent: ${meshIdHex.substring(0, 8)} -${amount} CCU (balance: ${account.credits})`);

    return true;
  }

  /**
   * Earn credits (executor completing a chunk).
   */
  earnCredits(
    executorHex: string,
    requesterHex: string,
    amount: CCU,
    taskId: string,
    chunkId: string
  ): void {
    const executor = this.getAccount(executorHex);
    executor.credits += amount;
    executor.totalEarned += amount;
    executor.lastActiveMs = Date.now();

    // Build transaction receipt
    const tx: CreditTransaction = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      fromId: requesterHex,
      toId: executorHex,
      amount,
      taskId,
      chunkId,
      timestamp: Date.now(),
      fromSignature: new Uint8Array(64),
      toSignature: new Uint8Array(64),
    };

    // Sign the transaction if we have a signing key
    if (this.config.signingKey) {
      const txData = new TextEncoder().encode(
        `${tx.id}|${tx.fromId}|${tx.toId}|${tx.amount}|${tx.taskId}|${tx.chunkId}|${tx.timestamp}`
      );
      tx.fromSignature = sign(txData, this.config.signingKey);
    }

    this.transactions.push(tx);

    log.debug(`Earned: ${executorHex.substring(0, 8)} +${amount} CCU (balance: ${executor.credits})`);
  }

  /**
   * Get recent transactions.
   */
  getTransactions(limit: number = 50): CreditTransaction[] {
    return this.transactions.slice(-limit);
  }

  // ══════════════════════════════════════════
  // Reputation
  // ══════════════════════════════════════════

  /**
   * Get reputation score for a mesh participant.
   */
  getReputation(meshIdHex: string): number {
    return this.getAccount(meshIdHex).reputation;
  }

  /**
   * Get reputation factors for a mesh participant.
   */
  getFactors(meshIdHex: string): ReputationFactors {
    return { ...this.getAccount(meshIdHex).factors };
  }

  /**
   * Record a successful chunk completion by an executor.
   * Updates completion rate and accuracy, recalculates reputation.
   */
  recordCompletion(executorHex: string, accurate: boolean): void {
    const account = this.getAccount(executorHex);
    account.tasksCompleted++;
    account.lastActiveMs = Date.now();

    const total = account.tasksCompleted + account.tasksFailed;

    // Update completion rate (exponential moving average)
    account.factors.completionRate = this.ema(account.factors.completionRate, 1.0, total);

    // Update accuracy rate
    account.factors.accuracyRate = this.ema(
      account.factors.accuracyRate,
      accurate ? 1.0 : 0.0,
      total
    );

    this.recalculateReputation(account);
  }

  /**
   * Record a failed chunk execution by an executor.
   * Updates completion rate, recalculates reputation.
   */
  recordFailure(executorHex: string): void {
    const account = this.getAccount(executorHex);
    account.tasksFailed++;
    account.lastActiveMs = Date.now();

    const total = account.tasksCompleted + account.tasksFailed;

    // Completion rate drops
    account.factors.completionRate = this.ema(account.factors.completionRate, 0.0, total);

    this.recalculateReputation(account);
  }

  /**
   * Record availability (node was online and responsive).
   */
  recordAvailability(meshIdHex: string, wasAvailable: boolean): void {
    const account = this.getAccount(meshIdHex);
    const total = account.tasksCompleted + account.tasksFailed + 1;

    account.factors.availabilityRate = this.ema(
      account.factors.availabilityRate,
      wasAvailable ? 1.0 : 0.0,
      total
    );

    this.recalculateReputation(account);
  }

  /**
   * Record resource honesty (did the node deliver what it advertised).
   */
  recordResourceHonesty(meshIdHex: string, honest: boolean): void {
    const account = this.getAccount(meshIdHex);
    const total = account.tasksCompleted + account.tasksFailed + 1;

    account.factors.resourceHonesty = this.ema(
      account.factors.resourceHonesty,
      honest ? 1.0 : 0.0,
      total
    );

    this.recalculateReputation(account);
  }

  /**
   * Apply reputation decay to all inactive accounts.
   * Should be called periodically (e.g., once per day or on node startup).
   *
   * Decay formula: reputation *= (1 - decayRate) ^ weeksInactive
   */
  applyDecay(): void {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    for (const account of this.accounts.values()) {
      const elapsedMs = now - account.lastActiveMs;
      const weeksInactive = elapsedMs / weekMs;

      if (weeksInactive >= 1) {
        const factor = Math.pow(1 - this.config.decayRate, weeksInactive);
        const oldRep = account.reputation;
        account.reputation = Math.max(
          REPUTATION_MIN,
          Math.round(account.reputation * factor)
        );

        if (account.reputation !== oldRep) {
          log.debug(`Decay: ${account.meshIdHex.substring(0, 8)} ${oldRep} → ${account.reputation} ` +
            `(${weeksInactive.toFixed(1)} weeks inactive)`);
        }
      }
    }
  }

  /**
   * Check if a participant's reputation allows mesh participation.
   */
  canParticipate(meshIdHex: string): boolean {
    return this.getReputation(meshIdHex) >= this.config.minReputation;
  }

  // ══════════════════════════════════════════
  // Persistence
  // ══════════════════════════════════════════

  /**
   * Export ledger state as JSON string.
   */
  exportJSON(): string {
    return JSON.stringify({
      accounts: [...this.accounts.entries()],
      transactions: this.transactions.slice(-1000), // Keep last 1000 transactions
      exportedAt: Date.now(),
    });
  }

  /**
   * Import ledger state from JSON string.
   */
  importJSON(json: string): void {
    try {
      const data = JSON.parse(json);
      if (data.accounts) {
        this.accounts = new Map(data.accounts);
      }
      if (data.transactions) {
        this.transactions = data.transactions;
      }
      log.info(`Imported ledger: ${this.accounts.size} accounts, ${this.transactions.length} transactions`);
    } catch (err: any) {
      log.warn(`Failed to import ledger: ${err.message}`);
    }
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.accounts.clear();
    this.transactions = [];
  }

  /**
   * Get summary statistics.
   */
  getSummary(): {
    totalAccounts: number;
    totalCreditsInCirculation: number;
    totalTransactions: number;
    avgReputation: number;
  } {
    let totalCredits = 0;
    let totalRep = 0;
    for (const account of this.accounts.values()) {
      totalCredits += account.credits;
      totalRep += account.reputation;
    }

    return {
      totalAccounts: this.accounts.size,
      totalCreditsInCirculation: totalCredits,
      totalTransactions: this.transactions.length,
      avgReputation: this.accounts.size > 0 ? Math.round(totalRep / this.accounts.size) : 0,
    };
  }

  // ── Internal ──

  /**
   * Recalculate reputation score from factors.
   * Score = weighted sum of factors × REPUTATION_MAX
   */
  private recalculateReputation(account: LedgerAccount): void {
    const w = REPUTATION_WEIGHTS;
    const f = account.factors;

    const weighted =
      f.completionRate * w.completionRate +
      f.accuracyRate * w.accuracyRate +
      f.availabilityRate * w.availabilityRate +
      f.resourceHonesty * w.resourceHonesty;

    const oldRep = account.reputation;
    account.reputation = Math.round(
      Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, weighted * REPUTATION_MAX))
    );

    if (account.reputation !== oldRep) {
      log.debug(`Reputation: ${account.meshIdHex.substring(0, 8)} ${oldRep} → ${account.reputation}`);
    }
  }

  /**
   * Exponential moving average for factor updates.
   * Gives more weight to recent observations as sample count grows.
   */
  private ema(current: number, newValue: number, sampleCount: number): number {
    // Alpha decreases as we get more samples (more stable)
    const alpha = Math.max(0.05, 1 / Math.max(1, sampleCount));
    return current * (1 - alpha) + newValue * alpha;
  }
}