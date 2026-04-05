/**
 * CMP v4.0 — Gravity Planner
 *
 * Decides WHERE to execute a task based on data location.
 * The core principle: move the smaller thing.
 *
 *   - If most data is on Device B: send code to B (gravity pull)
 *   - If data is evenly distributed: send code to all, merge (scatter)
 *   - If data is small: move data to fastest device (anti-gravity/push)
 *
 * Gravity Score:
 *   cost(device) = data_transfer_bytes / bandwidth + compute_time_estimate
 *   Choose the device with the lowest cost.
 *
 * Example:
 *   Device A: "filter all readings > 30C"
 *   Gravity checks: where does temperature dataset live?
 *   DataCatalog says: Device B has 80% of shards
 *   Decision: send 50-byte filter function to Device B
 *   Network cost: 50 bytes code + 4KB results = 4.05KB
 *   Without gravity: 2GB data + 4KB results = 2GB
 *   Savings: 99.998%
 *
 * @module gravity/gravity-planner
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { DataCatalog, DataLocation } from './data-catalog';

const log = new Logger('Gravity');

// ─── Gravity Strategy ───

export enum GravityStrategy {
  /** Send code to the device holding data (code is smaller) */
  PULL = 'pull',
  /** Send code to all devices holding shards, merge results */
  SCATTER = 'scatter',
  /** Move data to the best compute device (data is smaller) */
  PUSH = 'push',
  /** No gravity optimization — execute normally */
  NONE = 'none',
}

// ─── Gravity Decision ───

export interface GravityDecision {
  strategy: GravityStrategy;
  /** Target device(s) for execution */
  targetDevices: string[];
  /** Estimated bytes that will travel over the network */
  networkCostBytes: number;
  /** Estimated bytes WITHOUT gravity optimization */
  naiveCostBytes: number;
  /** Savings ratio (0-1): 0 = no savings, 0.99 = 99% savings */
  savingsRatio: number;
  /** Human-readable explanation */
  reason: string;
}

// ─── Gravity Planner Config ───

export interface GravityPlannerConfig {
  /** Threshold: if code is this much smaller than data, use PULL (default: 100x) */
  pullThreshold: number;
  /** Threshold: if data fraction on primary > this, PULL instead of SCATTER */
  concentrationThreshold: number;
  /** Estimated bandwidth between devices (bytes/sec) */
  estimatedBandwidth: number;
  /** Minimum data size to consider gravity optimization (bytes) */
  minDataSizeBytes: number;
}

export const DEFAULT_GRAVITY_CONFIG: GravityPlannerConfig = {
  pullThreshold: 100,
  concentrationThreshold: 0.6,
  estimatedBandwidth: 10_000_000, // 10 MB/s (typical LAN)
  minDataSizeBytes: 10_000, // 10 KB
};

// ─── Gravity Planner ───

export class GravityPlanner {
  private catalog: DataCatalog;
  private config: GravityPlannerConfig;

  // Stats
  private stats = {
    decisions: 0,
    pullCount: 0,
    scatterCount: 0,
    pushCount: 0,
    noneCount: 0,
    totalSavedBytes: 0,
  };

  constructor(catalog: DataCatalog, config: Partial<GravityPlannerConfig> = {}) {
    this.catalog = catalog;
    this.config = { ...DEFAULT_GRAVITY_CONFIG, ...config };
  }

  /**
   * Decide the gravity strategy for a task.
   *
   * @param dataKey - Key of the data to process
   * @param codeSizeBytes - Size of the WASM function to ship
   * @param estimatedResultBytes - Estimated size of the result
   * @param localDeviceId - This device's ID
   * @returns GravityDecision with strategy and cost analysis
   */
  plan(
    dataKey: string,
    codeSizeBytes: number,
    estimatedResultBytes: number,
    localDeviceId: string,
  ): GravityDecision {
    this.stats.decisions++;

    // Look up data location
    const location = this.catalog.locate(dataKey);

    // No data found in catalog — can't optimize
    if (!location) {
      this.stats.noneCount++;
      return {
        strategy: GravityStrategy.NONE,
        targetDevices: [localDeviceId],
        networkCostBytes: 0,
        naiveCostBytes: 0,
        savingsRatio: 0,
        reason: `Data key "${dataKey}" not found in catalog — no gravity optimization`,
      };
    }

    // Data too small — overhead not worth it
    if (location.totalSizeBytes < this.config.minDataSizeBytes) {
      this.stats.noneCount++;
      return {
        strategy: GravityStrategy.NONE,
        targetDevices: [localDeviceId],
        networkCostBytes: location.totalSizeBytes,
        naiveCostBytes: location.totalSizeBytes,
        savingsRatio: 0,
        reason: `Data too small (${location.totalSizeBytes}B < ${this.config.minDataSizeBytes}B threshold)`,
      };
    }

    // Data already on local device
    if (location.primaryDevice === localDeviceId && location.primaryFraction > 0.9) {
      this.stats.noneCount++;
      return {
        strategy: GravityStrategy.NONE,
        targetDevices: [localDeviceId],
        networkCostBytes: 0,
        naiveCostBytes: 0,
        savingsRatio: 0,
        reason: 'Data already on local device — no transfer needed',
      };
    }

    const dataSizeBytes = location.totalSizeBytes;
    const codeTransferCost = codeSizeBytes + estimatedResultBytes;
    const dataTransferCost = dataSizeBytes;
    const sizeRatio = dataTransferCost / Math.max(1, codeTransferCost);

    // ── Decision Logic ──

    // PULL: data is concentrated on one device, and code is much smaller
    if (location.isConcentrated && sizeRatio >= this.config.pullThreshold) {
      const target = location.primaryDevice!;
      const networkCost = codeTransferCost;
      const savings = 1 - (networkCost / dataTransferCost);

      this.stats.pullCount++;
      this.stats.totalSavedBytes += dataTransferCost - networkCost;

      return {
        strategy: GravityStrategy.PULL,
        targetDevices: [target],
        networkCostBytes: networkCost,
        naiveCostBytes: dataTransferCost,
        savingsRatio: Math.max(0, savings),
        reason: `PULL: ${codeSizeBytes}B code → ${target} (has ${(location.primaryFraction * 100).toFixed(0)}% of ${this.formatBytes(dataSizeBytes)} data). Savings: ${(savings * 100).toFixed(1)}%`,
      };
    }

    // SCATTER: data is distributed, but code is still much smaller
    if (location.isDistributed && sizeRatio >= 10) {
      const targets = location.devices.map(d => d.deviceId);
      const networkCost = codeTransferCost * targets.length; // Code sent to each
      const naiveCost = dataTransferCost;
      const savings = 1 - (networkCost / naiveCost);

      this.stats.scatterCount++;
      if (savings > 0) this.stats.totalSavedBytes += naiveCost - networkCost;

      return {
        strategy: GravityStrategy.SCATTER,
        targetDevices: targets,
        networkCostBytes: networkCost,
        naiveCostBytes: naiveCost,
        savingsRatio: Math.max(0, savings),
        reason: `SCATTER: ${codeSizeBytes}B code → ${targets.length} devices (data distributed). Savings: ${(savings * 100).toFixed(1)}%`,
      };
    }

    // PUSH: data is small enough to move, or code is not much smaller
    if (sizeRatio < this.config.pullThreshold) {
      this.stats.pushCount++;
      return {
        strategy: GravityStrategy.PUSH,
        targetDevices: [localDeviceId],
        networkCostBytes: dataTransferCost,
        naiveCostBytes: dataTransferCost,
        savingsRatio: 0,
        reason: `PUSH: data (${this.formatBytes(dataSizeBytes)}) is small relative to code (${this.formatBytes(codeSizeBytes)}) — moving data to compute`,
      };
    }

    // Default PULL for concentrated data
    if (location.primaryDevice && location.primaryFraction > this.config.concentrationThreshold) {
      const target = location.primaryDevice;
      const networkCost = codeTransferCost;
      const savings = 1 - (networkCost / dataTransferCost);

      this.stats.pullCount++;
      this.stats.totalSavedBytes += Math.max(0, dataTransferCost - networkCost);

      return {
        strategy: GravityStrategy.PULL,
        targetDevices: [target],
        networkCostBytes: networkCost,
        naiveCostBytes: dataTransferCost,
        savingsRatio: Math.max(0, savings),
        reason: `PULL: code to primary device ${target} (${(location.primaryFraction * 100).toFixed(0)}% data). Savings: ${(savings * 100).toFixed(1)}%`,
      };
    }

    // Fallback
    this.stats.noneCount++;
    return {
      strategy: GravityStrategy.NONE,
      targetDevices: [localDeviceId],
      networkCostBytes: dataTransferCost,
      naiveCostBytes: dataTransferCost,
      savingsRatio: 0,
      reason: 'No clear gravity advantage — executing normally',
    };
  }

  /**
   * Quick check: would gravity help for this data key?
   */
  wouldBenefit(dataKey: string, codeSizeBytes: number): boolean {
    const location = this.catalog.locate(dataKey);
    if (!location) return false;
    if (location.totalSizeBytes < this.config.minDataSizeBytes) return false;
    return location.totalSizeBytes / Math.max(1, codeSizeBytes) >= 10;
  }

  /**
   * Get gravity planner statistics.
   */
  getStats(): {
    decisions: number;
    pullCount: number;
    scatterCount: number;
    pushCount: number;
    noneCount: number;
    totalSavedBytes: number;
  } {
    return { ...this.stats };
  }

  /**
   * Get the data catalog.
   */
  getCatalog(): DataCatalog {
    return this.catalog;
  }

  // ─── Helpers ───

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
}
