/**
 * CMP v4.0 — Race Manager
 *
 * Coordinates speculative execution: sends the same task to N devices
 * simultaneously, takes the first result, cancels the rest.
 *
 * When to race:
 *   - Task > 5s estimated: always race
 *   - Task < 100ms estimated: never race (overhead not worth it)
 *   - High load variance in peer history: race (unpredictable perf)
 *   - Low mesh utilization: race (devices idle anyway)
 *
 * CCU Economics:
 *   Winner: earns 100% of agreed price
 *   Losers: earn 20% participation credit
 *   Requester: pays price × (1 + 0.2 × (n-1))
 *   Example: 3 racers, price=10 CCU → winner=10, losers=2 each → total=14
 *
 * @module scheduler/race-manager
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { CancelTracker, CancelReason } from './cancel-protocol';

const log = new Logger('RaceMgr');

// ─── Race Config ───

export interface RaceConfig {
  /** Default number of racers (default: 3) */
  defaultRacerCount: number;
  /** Maximum racers (default: 5) */
  maxRacers: number;
  /** Task duration below which racing is skipped (ms) */
  minTaskDurationMs: number;
  /** Task duration above which racing is always used (ms) */
  alwaysRaceDurationMs: number;
  /** Load variance threshold to trigger racing */
  varianceThreshold: number;
  /** Mesh utilization below which idle racing kicks in (0-1) */
  idleThreshold: number;
  /** Winner CCU share (default: 1.0 = 100%) */
  winnerShare: number;
  /** Loser participation credit share (default: 0.2 = 20%) */
  loserShare: number;
}

export const DEFAULT_RACE_CONFIG: RaceConfig = {
  defaultRacerCount: 3,
  maxRacers: 5,
  minTaskDurationMs: 100,
  alwaysRaceDurationMs: 5000,
  varianceThreshold: 20,
  idleThreshold: 0.3,
  winnerShare: 1.0,
  loserShare: 0.2,
};

// ─── Race Decision ───

export interface RaceDecision {
  shouldRace: boolean;
  racerCount: number;
  reason: string;
}

// ─── Racer ───

export interface Racer {
  deviceId: string;
  taskId: string;
  startedAt: number;
  /** Promise that resolves with the racer's result */
  promise: Promise<RacerResult>;
}

export interface RacerResult {
  deviceId: string;
  taskId: string;
  success: boolean;
  data: Uint8Array | null;
  totalTimeMs: number;
  error: string | null;
}

// ─── Race Record ───

export interface RaceRecord {
  raceId: string;
  racers: Racer[];
  winner: RacerResult | null;
  losers: RacerResult[];
  startedAt: number;
  completedAt: number | null;
  state: 'running' | 'completed' | 'failed';
  ccuCost: CCUBreakdown | null;
}

// ─── CCU Economics ───

export interface CCUBreakdown {
  basePrice: number;
  racerCount: number;
  winnerPayment: number;
  loserPayment: number;
  totalCost: number;
}

// ─── Mesh State for Racing Decisions ───

export interface RacingMeshState {
  /** Number of available devices */
  availableDevices: number;
  /** Average CPU utilization across mesh (0-1) */
  avgUtilization: number;
  /** Load variance (standard deviation of CPU loads) */
  loadVariance: number;
  /** Estimated task duration (ms), or -1 if unknown */
  estimatedDurationMs: number;
}

// ─── Race Manager ───

export class RaceManager {
  private config: RaceConfig;
  private cancelTracker: CancelTracker;
  private activeRaces = new Map<string, RaceRecord>();
  private completedRaces: RaceRecord[] = [];
  private nextRaceId = 1;

  // Stats
  private stats = {
    totalRaces: 0,
    totalWins: 0,
    totalCancelled: 0,
    totalCCUSpent: 0,
    avgSpeedupMs: 0,
    racesDeclined: 0,
  };

  constructor(config: Partial<RaceConfig> = {}) {
    this.config = { ...DEFAULT_RACE_CONFIG, ...config };
    this.cancelTracker = new CancelTracker();
  }

  /**
   * Set transport for cancel messages.
   */
  setTransport(sendFn: (deviceId: string, msgType: number, payload: any) => void): void {
    this.cancelTracker.setTransport(sendFn);
  }

  // ══════════════════════════════════════
  // Racing Decision
  // ══════════════════════════════════════

  /**
   * Decide whether to race a task based on mesh state.
   */
  shouldRace(meshState: RacingMeshState): RaceDecision {
    const { estimatedDurationMs, loadVariance, avgUtilization, availableDevices } = meshState;

    // Not enough devices to race
    if (availableDevices < 2) {
      return { shouldRace: false, racerCount: 1, reason: 'Not enough devices (need ≥2)' };
    }

    // Task too fast — overhead not worth it
    if (estimatedDurationMs >= 0 && estimatedDurationMs < this.config.minTaskDurationMs) {
      this.stats.racesDeclined++;
      return { shouldRace: false, racerCount: 1, reason: `Task too fast (${estimatedDurationMs}ms < ${this.config.minTaskDurationMs}ms threshold)` };
    }

    // Task very slow — always race
    if (estimatedDurationMs >= this.config.alwaysRaceDurationMs) {
      const racerCount = Math.min(this.config.defaultRacerCount, availableDevices, this.config.maxRacers);
      return { shouldRace: true, racerCount, reason: `Slow task (${estimatedDurationMs}ms ≥ ${this.config.alwaysRaceDurationMs}ms) — always race` };
    }

    // High load variance — race because performance is unpredictable
    if (loadVariance >= this.config.varianceThreshold) {
      const racerCount = Math.min(this.config.defaultRacerCount, availableDevices, this.config.maxRacers);
      return { shouldRace: true, racerCount, reason: `High load variance (${loadVariance.toFixed(1)} ≥ ${this.config.varianceThreshold}) — unpredictable performance` };
    }

    // Low mesh utilization — devices are idle anyway
    if (avgUtilization < this.config.idleThreshold) {
      const racerCount = Math.min(this.config.defaultRacerCount, availableDevices, this.config.maxRacers);
      return { shouldRace: true, racerCount, reason: `Low utilization (${(avgUtilization * 100).toFixed(0)}% < ${(this.config.idleThreshold * 100).toFixed(0)}%) — devices idle` };
    }

    // Unknown duration — check if we have enough idle devices
    if (estimatedDurationMs < 0 && avgUtilization < 0.5) {
      const racerCount = Math.min(this.config.defaultRacerCount, availableDevices, this.config.maxRacers);
      return { shouldRace: true, racerCount, reason: 'Unknown duration with available capacity — speculative race' };
    }

    // Default: don't race
    this.stats.racesDeclined++;
    return { shouldRace: false, racerCount: 1, reason: 'No racing criteria met' };
  }

  // ══════════════════════════════════════
  // Start Race
  // ══════════════════════════════════════

  /**
   * Start a race with the given racers.
   * Each racer is a promise that resolves when the device completes.
   *
   * @returns The winning result (first to complete successfully)
   */
  async race(racers: Racer[], basePrice: number = 10): Promise<{
    winner: RacerResult;
    record: RaceRecord;
  }> {
    const raceId = `race-${this.nextRaceId++}`;

    const record: RaceRecord = {
      raceId,
      racers,
      winner: null,
      losers: [],
      startedAt: Date.now(),
      completedAt: null,
      state: 'running',
      ccuCost: null,
    };

    this.activeRaces.set(raceId, record);
    this.stats.totalRaces++;

    log.info(`Race ${raceId} started: ${racers.length} racers`);

    try {
      // Race: wait for first successful result
      const winner = await this.racePromises(racers);

      record.winner = winner;
      record.state = 'completed';
      record.completedAt = Date.now();

      // Cancel losers
      const loserRacers = racers
        .filter(r => r.deviceId !== winner.deviceId)
        .map(r => ({ deviceId: r.deviceId, taskId: r.taskId }));

      const cancelled = this.cancelTracker.cancelLosers(raceId, winner.deviceId, loserRacers);
      this.stats.totalCancelled += cancelled;
      this.stats.totalWins++;

      // Calculate CCU costs
      record.ccuCost = this.calculateCCU(basePrice, racers.length);
      this.stats.totalCCUSpent += record.ccuCost.totalCost;

      log.info(
        `Race ${raceId} won by ${winner.deviceId} in ${winner.totalTimeMs}ms, ` +
        `${cancelled} losers cancelled, CCU: ${record.ccuCost.totalCost}`
      );

      // Collect loser results (non-blocking)
      this.collectLoserResults(record, racers, winner.deviceId);

      // Move to completed
      this.activeRaces.delete(raceId);
      this.completedRaces.push(record);
      if (this.completedRaces.length > 100) this.completedRaces.shift();

      return { winner, record };

    } catch (err: any) {
      // All racers failed
      record.state = 'failed';
      record.completedAt = Date.now();
      this.activeRaces.delete(raceId);
      this.completedRaces.push(record);

      log.warn(`Race ${raceId} failed: all racers failed — ${err.message}`);
      throw new Error(`All ${racers.length} racers failed: ${err.message}`);
    }
  }

  // ══════════════════════════════════════
  // CCU Economics
  // ══════════════════════════════════════

  /**
   * Calculate CCU costs for a race.
   *
   * Winner: earns 100% of basePrice
   * Losers: earn 20% participation credit each
   * Requester pays: basePrice × (1 + 0.2 × (n-1))
   */
  calculateCCU(basePrice: number, racerCount: number): CCUBreakdown {
    const winnerPayment = basePrice * this.config.winnerShare;
    const loserPayment = basePrice * this.config.loserShare;
    const totalCost = winnerPayment + loserPayment * (racerCount - 1);

    return {
      basePrice,
      racerCount,
      winnerPayment,
      loserPayment,
      totalCost,
    };
  }

  // ══════════════════════════════════════
  // Query
  // ══════════════════════════════════════

  /**
   * Get active races.
   */
  getActiveRaces(): RaceRecord[] {
    return Array.from(this.activeRaces.values());
  }

  /**
   * Get recent completed races.
   */
  getCompletedRaces(limit: number = 10): RaceRecord[] {
    return this.completedRaces.slice(-limit);
  }

  /**
   * Get race statistics.
   */
  getStats(): {
    totalRaces: number;
    totalWins: number;
    totalCancelled: number;
    totalCCUSpent: number;
    racesDeclined: number;
    activeRaces: number;
  } {
    return {
      ...this.stats,
      activeRaces: this.activeRaces.size,
    };
  }

  /**
   * Get the cancel tracker (for testing/direct access).
   */
  getCancelTracker(): CancelTracker {
    return this.cancelTracker;
  }

  // ══════════════════════════════════════
  // Internals
  // ══════════════════════════════════════

  /**
   * Race multiple promises — resolve with the first successful result.
   * If all fail, reject with the last error.
   */
  private racePromises(racers: Racer[]): Promise<RacerResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let failCount = 0;
      let lastError: string = 'All racers failed';

      for (const racer of racers) {
        racer.promise.then((result) => {
          if (!settled && result.success) {
            settled = true;
            resolve(result);
          } else if (!result.success) {
            failCount++;
            lastError = result.error || 'Unknown error';
            if (failCount === racers.length && !settled) {
              reject(new Error(lastError));
            }
          }
        }).catch((err) => {
          failCount++;
          lastError = err.message || 'Unknown error';
          if (failCount === racers.length && !settled) {
            reject(new Error(lastError));
          }
        });
      }
    });
  }

  /**
   * Collect loser results asynchronously (for stats, not blocking).
   */
  private collectLoserResults(record: RaceRecord, racers: Racer[], winnerId: string): void {
    for (const racer of racers) {
      if (racer.deviceId === winnerId) continue;

      racer.promise
        .then(result => { record.losers.push(result); })
        .catch(() => {
          record.losers.push({
            deviceId: racer.deviceId,
            taskId: racer.taskId,
            success: false,
            data: null,
            totalTimeMs: Date.now() - racer.startedAt,
            error: 'cancelled',
          });
        });
    }
  }
}
