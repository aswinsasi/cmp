/**
 * CMP v4.0 — Backpressure Controller
 *
 * Flow control between pipeline stages. Prevents fast producers
 * from overwhelming slow consumers.
 *
 * Algorithm:
 *   1. Each stage has a buffer with configurable capacity
 *   2. When buffer exceeds threshold → activate backpressure
 *   3. Upstream pauses until downstream drains
 *   4. Persistent backpressure (>30s) → request stage rebalance
 *
 * @module pipes/backpressure
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import type { PipelineConfig } from './pipeline-types';

const log = new Logger('Backpressure');

// ─── Buffer State ───

export interface BufferState {
  stageIndex: number;
  currentSize: number;
  capacity: number;
  threshold: number;
  isActive: boolean;
  activeSince: number | null;
  totalPaused: number;     // Total items dropped/paused due to backpressure
  totalProcessed: number;
}

// ─── Backpressure Controller ───

export class BackpressureController {
  private buffers = new Map<number, BufferState>();
  private config: PipelineConfig;
  private rebalanceCallback: ((stageIndex: number) => void) | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  /**
   * Initialize buffer tracking for a stage.
   */
  initStage(stageIndex: number, capacity?: number): void {
    const cap = capacity ?? this.config.defaultBufferCapacity;
    this.buffers.set(stageIndex, {
      stageIndex,
      currentSize: 0,
      capacity: cap,
      threshold: Math.floor(cap * this.config.backpressureThreshold),
      isActive: false,
      activeSince: null,
      totalPaused: 0,
      totalProcessed: 0,
    });
  }

  /**
   * Record an item entering a stage's buffer.
   * Returns true if the item should be processed, false if backpressure should pause.
   */
  onItemEnter(stageIndex: number): boolean {
    const buf = this.buffers.get(stageIndex);
    if (!buf) return true;

    buf.currentSize++;

    if (buf.currentSize >= buf.threshold && !buf.isActive) {
      buf.isActive = true;
      buf.activeSince = Date.now();
      log.info(`Backpressure ACTIVE on stage ${stageIndex} (buffer: ${buf.currentSize}/${buf.capacity})`);
    }

    if (buf.isActive) {
      buf.totalPaused++;
      return false; // Signal upstream to slow down
    }

    return true;
  }

  /**
   * Record an item leaving a stage's buffer (processed).
   */
  onItemExit(stageIndex: number): void {
    const buf = this.buffers.get(stageIndex);
    if (!buf) return;

    buf.currentSize = Math.max(0, buf.currentSize - 1);
    buf.totalProcessed++;

    // Deactivate backpressure when buffer drains below half threshold
    if (buf.isActive && buf.currentSize < buf.threshold / 2) {
      buf.isActive = false;
      buf.activeSince = null;
      log.info(`Backpressure RELEASED on stage ${stageIndex} (buffer: ${buf.currentSize}/${buf.capacity})`);
    }
  }

  /**
   * Check if backpressure is active for a stage.
   */
  isActive(stageIndex: number): boolean {
    return this.buffers.get(stageIndex)?.isActive ?? false;
  }

  /**
   * Get buffer state for a stage.
   */
  getBufferState(stageIndex: number): BufferState | null {
    return this.buffers.get(stageIndex) ?? null;
  }

  /**
   * Get all buffer states.
   */
  getAllBufferStates(): BufferState[] {
    return Array.from(this.buffers.values());
  }

  /**
   * Find the bottleneck stage (highest buffer occupancy).
   */
  findBottleneck(): number | null {
    let maxOccupancy = 0;
    let bottleneck: number | null = null;

    for (const [idx, buf] of this.buffers) {
      const occupancy = buf.currentSize / buf.capacity;
      if (occupancy > maxOccupancy) {
        maxOccupancy = occupancy;
        bottleneck = idx;
      }
    }

    return maxOccupancy > this.config.backpressureThreshold ? bottleneck : null;
  }

  /**
   * Set callback for rebalance requests.
   */
  onRebalanceNeeded(callback: (stageIndex: number) => void): void {
    this.rebalanceCallback = callback;
  }

  /**
   * Start periodic check for persistent backpressure.
   */
  startMonitoring(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => this.checkPersistent(), 5000);
  }

  /**
   * Stop monitoring.
   */
  stopMonitoring(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Reset all buffer states.
   */
  reset(): void {
    this.buffers.clear();
    this.stopMonitoring();
  }

  // ─── Internal ───

  private checkPersistent(): void {
    const now = Date.now();
    for (const buf of this.buffers.values()) {
      if (buf.isActive && buf.activeSince) {
        const duration = now - buf.activeSince;
        if (duration >= this.config.rebalanceTimeoutMs) {
          log.warn(`Persistent backpressure on stage ${buf.stageIndex} (${(duration / 1000).toFixed(0)}s) — requesting rebalance`);
          if (this.rebalanceCallback) {
            this.rebalanceCallback(buf.stageIndex);
          }
        }
      }
    }
  }
}
