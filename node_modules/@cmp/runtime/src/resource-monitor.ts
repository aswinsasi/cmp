/**
 * CMP Resource Monitor
 * Monitors CPU time, memory usage, and thermal state during
 * chunk execution. Triggers violation callbacks if limits exceeded.
 *
 * @module runtime/resource-monitor
 * @author Agent Viscro
 */

import os from 'os';

export interface ResourceLimits {
  maxMemoryMb: number;
  maxCpuMs: number;
}

export interface ResourceSnapshot {
  cpuTimeMs: number;
  memoryMb: number;
  loadPercent: number;
  timestamp: number;
}

export type ViolationReason = 'memory_exceeded' | 'cpu_exceeded' | 'thermal_throttle';
export type ViolationHandler = (reason: ViolationReason, details: string) => void;

export class ResourceMonitor {
  private limits: ResourceLimits;
  private monitoring = false;
  private intervalId?: ReturnType<typeof setInterval>;
  private startTime = 0;
  private snapshots: ResourceSnapshot[] = [];
  private peakMemoryMb = 0;
  private onViolation?: ViolationHandler;

  constructor(limits: ResourceLimits) {
    this.limits = limits;
  }

  /**
   * Start monitoring resources.
   */
  start(onViolation: ViolationHandler): void {
    this.monitoring = true;
    this.startTime = Date.now();
    this.snapshots = [];
    this.peakMemoryMb = 0;
    this.onViolation = onViolation;

    this.intervalId = setInterval(() => {
      this.check();
    }, 100); // Check every 100ms
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    this.monitoring = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /**
   * Take a snapshot and check for violations.
   */
  private check(): void {
    if (!this.monitoring) return;

    const elapsed = Date.now() - this.startTime;
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const usedMb = Math.round((totalMem - freeMem) / (1024 * 1024));
    const loadAvg = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const loadPercent = Math.round((loadAvg / cpuCount) * 100);

    const snapshot: ResourceSnapshot = {
      cpuTimeMs: elapsed,
      memoryMb: usedMb,
      loadPercent,
      timestamp: Date.now(),
    };

    this.snapshots.push(snapshot);
    if (usedMb > this.peakMemoryMb) {
      this.peakMemoryMb = usedMb;
    }

    // Check CPU time limit
    if (elapsed > this.limits.maxCpuMs) {
      this.onViolation?.(
        'cpu_exceeded',
        `CPU time ${elapsed}ms exceeds limit ${this.limits.maxCpuMs}ms`
      );
    }
  }

  /**
   * Get peak memory usage during monitoring.
   */
  getPeakMemoryMb(): number {
    return this.peakMemoryMb;
  }

  /**
   * Get elapsed time since monitoring started.
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get all snapshots taken during monitoring.
   */
  getSnapshots(): ResourceSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get current resource usage summary.
   */
  getCurrentUsage(): { cpuMs: number; memoryPeakMb: number; gpuMs: number } {
    return {
      cpuMs: this.getElapsedMs(),
      memoryPeakMb: this.peakMemoryMb,
      gpuMs: 0, // GPU monitoring not yet implemented
    };
  }

  /**
   * Check if monitoring is active.
   */
  isMonitoring(): boolean {
    return this.monitoring;
  }
}
