/**
 * CMP v1.3 — Dream Scheduler
 * Predicts future tasks from MCL's MER history during idle periods.
 * Implements 5 pattern detectors:
 *   1. Temporal Recurrence — same task at regular intervals
 *   2. Sequential Chain — task B always follows task A
 *   3. Payload Similarity — same module hash appearing repeatedly
 *   4. Diurnal Cycle — time-of-day correlations
 *   5. Burst Pattern — rapid sequences of same task
 *
 * @module precognition/dream-scheduler
 * @author Agent Viscro
 */

import type { CMP_MER } from '../types/mcl';
import { TaskType } from '../types/task';
import {
  Prediction,
  PredictionSet,
  PredictionPattern,
  DreamSchedulerConfig,
} from '../types/precognition';

const DEFAULT_CONFIG: DreamSchedulerConfig = {
  minIdleBeforeDreamMs: 30000,
  idleCpuThreshold: 0.15,
  maxSpeculativeBudgetPerCycle: 50,
  predictionIntervalMs: 60000,
  minMersForPrediction: 10,
  maxPredictionsPerCycle: 8,
  initialAggressiveness: 0.3,
};

// ── Helpers ──

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

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Types for internal tracking ──

interface MERSummary {
  merId: string;
  taskType: TaskType;
  moduleHash: string;       // hex
  createdAt: number;
  chunkCount: number;
  avgChunkSizeKb: number;
  confidence: number;
}

export class DreamScheduler {
  private config: DreamSchedulerConfig;
  private currentPredictions: PredictionSet | null = null;
  private dreamInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** External callbacks */
  private getMERsFn: () => CMP_MER[];
  private getCpuLoadFn: () => number;
  private getActiveTasks: () => number;
  private onPredictionsReady: ((ps: PredictionSet) => void) | null = null;

  constructor(
    getMERsFn: () => CMP_MER[],
    getCpuLoadFn: () => number,
    getActiveTasks: () => number,
    config?: Partial<DreamSchedulerConfig>,
  ) {
    this.getMERsFn = getMERsFn;
    this.getCpuLoadFn = getCpuLoadFn;
    this.getActiveTasks = getActiveTasks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register callback for when predictions are generated */
  onPredictions(fn: (ps: PredictionSet) => void): void {
    this.onPredictionsReady = fn;
  }

  /** Start the dream scheduler. Begins monitoring idle state. */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.dreamInterval = setInterval(() => {
      this.onIdleTick();
    }, this.config.predictionIntervalMs);
  }

  /** Stop dreaming. */
  stop(): void {
    this.running = false;
    if (this.dreamInterval) {
      clearInterval(this.dreamInterval);
      this.dreamInterval = null;
    }
    this.currentPredictions = null;
  }

  /**
   * Core prediction algorithm.
   * Queries MER history and generates ranked predictions.
   */
  generatePredictions(): PredictionSet {
    const mers = this.getMERsFn();

    // Convert to summaries for easier processing
    const summaries = mers.map(m => this.toSummary(m));

    // Run all pattern detectors
    const predictions: Prediction[] = [];

    predictions.push(...this.detectTemporalRecurrence(summaries));
    predictions.push(...this.detectSequentialChain(summaries));
    predictions.push(...this.detectPayloadSimilarity(summaries));
    predictions.push(...this.detectDiurnalCycle(summaries));
    predictions.push(...this.detectBurstPattern(summaries));

    // Sort by confidence (highest first)
    predictions.sort((a, b) => b.confidence - a.confidence);

    // Trim to max predictions per cycle
    const trimmed = predictions.slice(0, this.config.maxPredictionsPerCycle);

    const now = Date.now();
    const predictionSet: PredictionSet = {
      predictions: trimmed,
      speculativeBudget: this.config.maxSpeculativeBudgetPerCycle,
      generatedAt: now,
      nextGenerationAt: now + this.config.predictionIntervalMs,
    };

    this.currentPredictions = predictionSet;
    return predictionSet;
  }

  /**
   * Check if the device is idle enough to dream.
   */
  checkIdleState(): boolean {
    const cpuLoad = this.getCpuLoadFn();
    const activeTasks = this.getActiveTasks();
    return cpuLoad < this.config.idleCpuThreshold && activeTasks === 0;
  }

  /**
   * Called when a real task arrives. Checks if any prediction matches.
   *
   * Match criteria:
   * - Same taskType
   * - Same moduleHash (exact match)
   * - inputFingerprint similarity > 0.8 (hamming distance)
   * - Current time within predictedWindow
   */
  matchRealTask(
    taskType: TaskType,
    moduleHash: Uint8Array,
    inputFingerprint: Uint8Array,
  ): Prediction | null {
    if (!this.currentPredictions) return null;

    const now = Date.now();
    const moduleHashHex = toHex(moduleHash);

    for (const pred of this.currentPredictions.predictions) {
      // Task type must match
      if (pred.taskType !== taskType) continue;

      // Module hash must match exactly
      if (toHex(pred.moduleHash) !== moduleHashHex) continue;

      // Time must be within predicted window
      if (now < pred.predictedWindowStart || now > pred.predictedWindowEnd) continue;

      // Input fingerprint similarity (hamming distance based)
      const similarity = this.fingerprintSimilarity(pred.inputFingerprint, inputFingerprint);
      if (similarity < 0.8) continue;

      return pred;
    }

    return null;
  }

  /** Get current prediction set (for CLI display) */
  getCurrentPredictions(): PredictionSet | null {
    return this.currentPredictions;
  }

  /** Update aggressiveness (affects maxPredictionsPerCycle and budget) */
  setAggressiveness(level: number): void {
    const clamped = Math.max(0.05, Math.min(0.95, level));
    this.config.maxPredictionsPerCycle = Math.max(1, Math.floor(8 * clamped));
    this.config.maxSpeculativeBudgetPerCycle = Math.max(5, Math.floor(50 * clamped));
  }

  // ═══════════════════════════════════════
  // Pattern Detector 1: Temporal Recurrence
  // ═══════════════════════════════════════

  /**
   * Find task types that repeat at regular intervals.
   * - Calculate inter-MER intervals for same taskType
   * - If stddev(intervals) / mean(intervals) < 0.3 → recurrence detected
   * - Predict next occurrence at: lastMER.timestamp + mean(interval)
   */
  detectTemporalRecurrence(summaries: MERSummary[]): Prediction[] {
    const predictions: Prediction[] = [];

    // Group by taskType
    const byType = this.groupByTaskType(summaries);

    for (const [taskType, mers] of byType) {
      if (mers.length < 3) continue; // Need at least 3 for interval analysis

      // Sort by timestamp
      const sorted = [...mers].sort((a, b) => a.createdAt - b.createdAt);

      // Calculate intervals between consecutive MERs
      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        intervals.push(sorted[i].createdAt - sorted[i - 1].createdAt);
      }

      if (intervals.length < 2) continue;

      const avgInterval = mean(intervals);
      const sd = stddev(intervals);

      // Coefficient of variation: stddev / mean
      // Low CV (< 0.3) means regular intervals
      const cv = avgInterval > 0 ? sd / avgInterval : Infinity;

      if (cv < 0.3 && avgInterval > 1000) { // At least 1 second intervals
        const lastMer = sorted[sorted.length - 1];
        const predictedTime = lastMer.createdAt + avgInterval;
        const windowMargin = avgInterval * 0.3; // 30% margin

        // Confidence based on CV (lower CV = higher confidence)
        const confidence = Math.min(0.95, 1.0 - cv) * Math.min(1.0, mers.length / 10);

        predictions.push({
          id: randomBytes(16),
          taskType,
          moduleHash: this.hexToBytes(lastMer.moduleHash),
          inputFingerprint: new Uint8Array(32), // Unknown — will match on module hash
          confidence,
          predictedWindowStart: predictedTime - windowMargin,
          predictedWindowEnd: predictedTime + windowMargin,
          sourceMerIds: sorted.slice(-5).map(m => m.merId),
          createdAt: Date.now(),
          patternType: PredictionPattern.TEMPORAL_RECURRENCE,
        });
      }
    }

    return predictions;
  }

  // ═══════════════════════════════════════
  // Pattern Detector 2: Sequential Chain
  // ═══════════════════════════════════════

  /**
   * Find MER pairs where type B always follows type A.
   * - Build transition matrix: P(typeB | typeA) for all type pairs
   * - If P > 0.7 and sample count > 3 → chain detected
   * - When typeA completes, predict typeB within mean(gap) ms
   */
  detectSequentialChain(summaries: MERSummary[]): Prediction[] {
    const predictions: Prediction[] = [];

    if (summaries.length < 4) return predictions;

    // Sort all MERs by timestamp
    const sorted = [...summaries].sort((a, b) => a.createdAt - b.createdAt);

    // Build transition counts: typeA → { typeB: count, gaps: number[] }
    const transitions = new Map<number, Map<number, { count: number; gaps: number[] }>>();

    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i].taskType;
      const to = sorted[i + 1].taskType;

      if (from === to) continue; // Skip same-type sequences (handled by temporal)

      if (!transitions.has(from)) transitions.set(from, new Map());
      const targets = transitions.get(from)!;

      if (!targets.has(to)) targets.set(to, { count: 0, gaps: [] });
      const entry = targets.get(to)!;
      entry.count++;
      entry.gaps.push(sorted[i + 1].createdAt - sorted[i].createdAt);
    }

    // Count total transitions from each type
    const totalFromType = new Map<number, number>();
    for (const [from, targets] of transitions) {
      let total = 0;
      for (const entry of targets.values()) total += entry.count;
      totalFromType.set(from, total);
    }

    // Find high-probability transitions
    for (const [from, targets] of transitions) {
      const total = totalFromType.get(from) ?? 0;

      for (const [to, entry] of targets) {
        const probability = total > 0 ? entry.count / total : 0;

        if (probability > 0.7 && entry.count > 3) {
          // Chain detected: from → to
          const avgGap = mean(entry.gaps);
          const lastMer = sorted.filter(m => m.taskType === from).pop();
          if (!lastMer) continue;

          // Find a representative MER for the "to" type
          const toMers = sorted.filter(m => m.taskType === to);
          const representativeTo = toMers[toMers.length - 1];
          if (!representativeTo) continue;

          const predictedTime = lastMer.createdAt + avgGap;
          const windowMargin = Math.max(avgGap * 0.5, 5000);

          const confidence = probability * Math.min(1.0, entry.count / 5) * 0.85;

          predictions.push({
            id: randomBytes(16),
            taskType: to,
            moduleHash: this.hexToBytes(representativeTo.moduleHash),
            inputFingerprint: new Uint8Array(32),
            confidence,
            predictedWindowStart: predictedTime - windowMargin,
            predictedWindowEnd: predictedTime + windowMargin,
            sourceMerIds: [lastMer.merId, representativeTo.merId],
            createdAt: Date.now(),
            patternType: PredictionPattern.SEQUENTIAL_CHAIN,
          });
        }
      }
    }

    return predictions;
  }

  // ═══════════════════════════════════════
  // Pattern Detector 3: Payload Similarity
  // ═══════════════════════════════════════

  /**
   * Same module hash appearing 5+ times with similar input sizes.
   * - Group by moduleHash
   * - If same moduleHash appears 5+ times → similarity detected
   * - Predict same module with median input size
   */
  detectPayloadSimilarity(summaries: MERSummary[]): Prediction[] {
    const predictions: Prediction[] = [];

    // Group by moduleHash
    const byModule = new Map<string, MERSummary[]>();
    for (const s of summaries) {
      const existing = byModule.get(s.moduleHash) || [];
      existing.push(s);
      byModule.set(s.moduleHash, existing);
    }

    for (const [moduleHash, mers] of byModule) {
      if (mers.length < 5) continue;

      // Sort by time
      const sorted = [...mers].sort((a, b) => a.createdAt - b.createdAt);

      // Calculate median input size
      const sizes = sorted.map(m => m.avgChunkSizeKb);
      const medianSize = median(sizes);

      // Confidence based on frequency
      const confidence = Math.min(0.9, 0.5 + (mers.length / 20)) *
                         Math.min(1.0, 1.0 - (stddev(sizes) / (mean(sizes) || 1)));

      const lastMer = sorted[sorted.length - 1];

      // Predict recurrence within 2x the average interval (or 5 minutes default)
      const intervals = [];
      for (let i = 1; i < sorted.length; i++) {
        intervals.push(sorted[i].createdAt - sorted[i - 1].createdAt);
      }
      const avgInterval = intervals.length > 0 ? mean(intervals) : 300000;
      const now = Date.now();

      predictions.push({
        id: randomBytes(16),
        taskType: lastMer.taskType,
        moduleHash: this.hexToBytes(moduleHash),
        inputFingerprint: new Uint8Array(32), // Generic — will match on module hash
        confidence: Math.max(0, confidence),
        predictedWindowStart: now,
        predictedWindowEnd: now + avgInterval * 2,
        sourceMerIds: sorted.slice(-5).map(m => m.merId),
        createdAt: now,
        patternType: PredictionPattern.PAYLOAD_SIMILARITY,
      });
    }

    return predictions;
  }

  // ═══════════════════════════════════════
  // Pattern Detector 4: Diurnal Cycle
  // ═══════════════════════════════════════

  /**
   * Task types correlated with time-of-day.
   * - Bucket MERs by hour-of-day (24 buckets)
   * - If a taskType has >60% of its MERs in a 3-hour window → diurnal
   * - Predict during that window each day
   */
  detectDiurnalCycle(summaries: MERSummary[]): Prediction[] {
    const predictions: Prediction[] = [];

    const byType = this.groupByTaskType(summaries);

    for (const [taskType, mers] of byType) {
      if (mers.length < 5) continue; // Need enough data

      // Bucket by hour of day
      const hourBuckets = new Array(24).fill(0);
      for (const m of mers) {
        const hour = new Date(m.createdAt).getHours();
        hourBuckets[hour]++;
      }

      // Find the densest 3-hour window
      let maxCount = 0;
      let maxStartHour = 0;
      for (let start = 0; start < 24; start++) {
        let count = 0;
        for (let offset = 0; offset < 3; offset++) {
          count += hourBuckets[(start + offset) % 24];
        }
        if (count > maxCount) {
          maxCount = count;
          maxStartHour = start;
        }
      }

      const ratio = mers.length > 0 ? maxCount / mers.length : 0;

      if (ratio > 0.6) {
        // Diurnal pattern detected
        const lastMer = mers[mers.length - 1];

        // Predict for the next occurrence of this window
        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(maxStartHour, 0, 0, 0);
        const todayEnd = new Date(now);
        todayEnd.setHours((maxStartHour + 3) % 24, 0, 0, 0);
        if (todayEnd < todayStart) todayEnd.setDate(todayEnd.getDate() + 1);

        // If we're past today's window, predict tomorrow
        let windowStart = todayStart.getTime();
        let windowEnd = todayEnd.getTime();
        if (now.getTime() > windowEnd) {
          windowStart += 86400000; // +24h
          windowEnd += 86400000;
        }

        const confidence = ratio * Math.min(1.0, mers.length / 10) * 0.8;

        predictions.push({
          id: randomBytes(16),
          taskType,
          moduleHash: this.hexToBytes(lastMer.moduleHash),
          inputFingerprint: new Uint8Array(32),
          confidence,
          predictedWindowStart: windowStart,
          predictedWindowEnd: windowEnd,
          sourceMerIds: mers.slice(-5).map(m => m.merId),
          createdAt: Date.now(),
          patternType: PredictionPattern.DIURNAL_CYCLE,
        });
      }
    }

    return predictions;
  }

  // ═══════════════════════════════════════
  // Pattern Detector 5: Burst Pattern
  // ═══════════════════════════════════════

  /**
   * Rapid sequences of same task (inter-arrival < 5 seconds).
   * - Find MER sequences where inter-arrival < 5s
   * - If burst length > 3 → predict continuation during burst
   */
  detectBurstPattern(summaries: MERSummary[]): Prediction[] {
    const predictions: Prediction[] = [];
    const BURST_THRESHOLD_MS = 5000;

    const byType = this.groupByTaskType(summaries);

    for (const [taskType, mers] of byType) {
      if (mers.length < 4) continue;

      const sorted = [...mers].sort((a, b) => a.createdAt - b.createdAt);

      // Find bursts: sequences where inter-arrival < threshold
      let burstStart = 0;
      let burstLength = 1;
      let maxBurstLength = 0;
      let maxBurstEndIdx = 0;

      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].createdAt - sorted[i - 1].createdAt;

        if (gap < BURST_THRESHOLD_MS) {
          burstLength++;
        } else {
          if (burstLength > maxBurstLength) {
            maxBurstLength = burstLength;
            maxBurstEndIdx = i - 1;
          }
          burstStart = i;
          burstLength = 1;
        }
      }
      // Check last burst
      if (burstLength > maxBurstLength) {
        maxBurstLength = burstLength;
        maxBurstEndIdx = sorted.length - 1;
      }

      if (maxBurstLength <= 3) continue;

      // Check if the most recent MERs form a burst (active burst)
      const lastMer = sorted[sorted.length - 1];
      const now = Date.now();
      const timeSinceLastMer = now - lastMer.createdAt;

      // Only predict if the last burst was recent (within 30 seconds)
      if (timeSinceLastMer > 30000) continue;

      // Calculate average burst inter-arrival
      const burstMers = sorted.slice(maxBurstEndIdx - maxBurstLength + 1, maxBurstEndIdx + 1);
      const burstIntervals: number[] = [];
      for (let i = 1; i < burstMers.length; i++) {
        burstIntervals.push(burstMers[i].createdAt - burstMers[i - 1].createdAt);
      }
      const avgBurstInterval = mean(burstIntervals);

      const confidence = Math.min(0.9, 0.5 + (maxBurstLength / 10)) * 0.85;

      predictions.push({
        id: randomBytes(16),
        taskType,
        moduleHash: this.hexToBytes(lastMer.moduleHash),
        inputFingerprint: new Uint8Array(32),
        confidence,
        predictedWindowStart: now,
        predictedWindowEnd: now + avgBurstInterval * 3,
        sourceMerIds: burstMers.map(m => m.merId),
        createdAt: now,
        patternType: PredictionPattern.BURST_PATTERN,
      });
    }

    return predictions;
  }

  // ═══════════════════════════════════════
  // Internals
  // ═══════════════════════════════════════

  private onIdleTick(): void {
    if (!this.running) return;

    const mers = this.getMERsFn();
    if (mers.length < this.config.minMersForPrediction) return;

    if (!this.checkIdleState()) return;

    const ps = this.generatePredictions();
    if (ps.predictions.length > 0 && this.onPredictionsReady) {
      this.onPredictionsReady(ps);
    }
  }

  private toSummary(mer: CMP_MER): MERSummary {
    return {
      merId: toHex(mer.merId),
      taskType: mer.taskType,
      moduleHash: toHex(mer.meshSignature), // Use meshSignature as proxy for module hash
      createdAt: mer.createdAt,
      chunkCount: mer.chunkCount,
      avgChunkSizeKb: mer.avgChunkSizeKb,
      confidence: mer.confidence,
    };
  }

  private groupByTaskType(summaries: MERSummary[]): Map<TaskType, MERSummary[]> {
    const groups = new Map<TaskType, MERSummary[]>();
    for (const s of summaries) {
      const existing = groups.get(s.taskType) || [];
      existing.push(s);
      groups.set(s.taskType, existing);
    }
    return groups;
  }

  private fingerprintSimilarity(a: Uint8Array, b: Uint8Array): number {
    if (a.length !== b.length) return 0;
    if (a.length === 0) return 1;

    // Count matching bytes (simple similarity)
    let matching = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) matching++;
    }
    return matching / a.length;
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }
}
