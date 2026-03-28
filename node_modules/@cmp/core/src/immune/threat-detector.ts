/**
 * CMP v1.3 — Threat Detector
 * Real-time threat detection engine. Evaluates chunk results,
 * beacon traffic, bidding behavior, and new peers against loaded
 * antibodies and statistical anomaly detection.
 *
 * @module immune/threat-detector
 * @author Agent Viscro
 */

import {
  Antibody,
  BehavioralSignature,
  SignatureRule,
  SignatureMetric,
  ThreatEvent,
  ThreatType,
  ThreatSeverity,
  DetectionMethod,
  ImmuneSystemConfig,
  DeviceBehaviorRecord,
} from '../types/immune';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
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

export class ThreatDetector {
  /** Loaded antibodies: id → Antibody */
  private antibodies = new Map<string, Antibody>();

  /** Per-device behavior tracking: deviceId hex → record */
  private behaviorRecords = new Map<string, DeviceBehaviorRecord>();

  /** Beacon rate tracking: deviceId hex → timestamps[] */
  private beaconTimestamps = new Map<string, number[]>();

  /** Address → device IDs seen (for Sybil detection) */
  private addressIdentities = new Map<string, Set<string>>();

  /** Threat event history: deviceId hex → events */
  private eventHistory = new Map<string, ThreatEvent[]>();

  private config: ImmuneSystemConfig;

  constructor(config?: Partial<ImmuneSystemConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ═══════════════════════════════════════
  // Antibody Management
  // ═══════════════════════════════════════

  /** Load antibodies from ImmuneMemory on startup */
  loadAntibodies(antibodies: Antibody[]): void {
    const now = Date.now();
    for (const ab of antibodies) {
      if (now < ab.expiresAt && ab.falsePositiveCount < this.config.maxFalsePositives) {
        this.antibodies.set(ab.id, ab);
      }
    }
  }

  /** Add a single antibody */
  addAntibody(antibody: Antibody): void {
    this.antibodies.set(antibody.id, antibody);
  }

  /** Report false positive — decrements antibody confidence */
  reportFalsePositive(antibodyId: string): void {
    const ab = this.antibodies.get(antibodyId);
    if (!ab) return;

    ab.falsePositiveCount++;
    ab.confidence *= 0.8; // Reduce confidence by 20%

    // Disable if too many false positives
    if (ab.falsePositiveCount >= this.config.maxFalsePositives) {
      this.antibodies.delete(antibodyId);
    }
  }

  /** Get all active antibodies */
  getAntibodies(): Antibody[] {
    return [...this.antibodies.values()];
  }

  /** Get threat history for a device */
  getEventHistory(deviceId: Uint8Array): ThreatEvent[] {
    return this.eventHistory.get(toHex(deviceId)) ?? [];
  }

  /** Get all threat events across all devices */
  getAllEvents(): ThreatEvent[] {
    const all: ThreatEvent[] = [];
    for (const events of this.eventHistory.values()) {
      all.push(...events);
    }
    return all.sort((a, b) => b.detectedAt - a.detectedAt);
  }

  // ═══════════════════════════════════════
  // Evaluation — Chunk Results (Layer 6)
  // ═══════════════════════════════════════

  /**
   * Evaluate a completed task result for threats.
   * Called after Layer 6 Assembly for every completed chunk.
   */
  evaluateChunkResult(
    executorId: Uint8Array,
    success: boolean,
    executionTimeMs: number,
    expectedTimeMs: number,
    resultCorrect: boolean,
  ): ThreatEvent | null {
    const hex = toHex(executorId);
    const record = this.getOrCreateRecord(hex);

    // Update behavior
    record.totalTasksAssigned++;
    if (success) {
      record.tasksCompleted++;
    } else {
      record.tasksFailed++;
    }
    if (!resultCorrect) {
      record.resultMismatches++;
    }
    record.lastSeenAt = Date.now();

    // Check 1: Result poisoning — incorrect results
    if (!resultCorrect) {
      const errorRate = record.resultMismatches / Math.max(1, record.totalTasksAssigned);
      if (errorRate > 0.3 && record.resultMismatches >= 2) {
        return this.createEvent(
          executorId,
          ThreatType.RESULT_POISONING,
          errorRate > 0.7 ? ThreatSeverity.HIGH : ThreatSeverity.MEDIUM,
          DetectionMethod.REDUNDANT_MISMATCH,
          `Result error rate ${(errorRate * 100).toFixed(0)}%`,
          [{ key: 'error_rate', expected: '< 0.1', actual: errorRate.toFixed(3) }],
          record.resultMismatches,
        );
      }
    }

    // Check 2: Capability fraud — execution time wildly off from estimate
    if (success && expectedTimeMs > 0) {
      const ratio = executionTimeMs / expectedTimeMs;
      if (ratio > 5.0 && record.tasksCompleted >= 3) {
        // Taking 5x longer than estimated → lying about capabilities
        return this.createEvent(
          executorId,
          ThreatType.CAPABILITY_FRAUD,
          ThreatSeverity.MEDIUM,
          DetectionMethod.CAPABILITY_MISMATCH,
          `Execution time ${executionTimeMs}ms vs estimated ${expectedTimeMs}ms`,
          [{ key: 'time_ratio', expected: '< 2.0', actual: ratio.toFixed(2) }],
          1,
        );
      }
    }

    // Check 3: Task sinkhole — pattern of timeouts
    if (!success) {
      record.tasksTimedOut++;
      const timeoutRate = record.tasksTimedOut / Math.max(1, record.totalTasksAssigned);
      if (timeoutRate > 0.5 && record.tasksTimedOut >= 3) {
        return this.createEvent(
          executorId,
          ThreatType.TASK_SINKHOLE,
          ThreatSeverity.HIGH,
          DetectionMethod.STATISTICAL_ANOMALY,
          `Timeout rate ${(timeoutRate * 100).toFixed(0)}%`,
          [{ key: 'timeout_rate', expected: '< 0.2', actual: timeoutRate.toFixed(3) }],
          record.tasksTimedOut,
        );
      }
    }

    // Check 4: Run loaded antibodies against this device
    return this.matchAntibodies(executorId, record);
  }

  // ═══════════════════════════════════════
  // Evaluation — Beacon Traffic (Layer 1)
  // ═══════════════════════════════════════

  /**
   * Evaluate beacon traffic for flooding.
   * Called by Discovery layer on each beacon received.
   */
  evaluateBeaconRate(senderId: Uint8Array, beaconTimestamp: number): ThreatEvent | null {
    const hex = toHex(senderId);

    if (!this.beaconTimestamps.has(hex)) {
      this.beaconTimestamps.set(hex, []);
    }
    const timestamps = this.beaconTimestamps.get(hex)!;
    timestamps.push(beaconTimestamp);

    // Keep only last 30 seconds of timestamps
    const cutoff = beaconTimestamp - 30000;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    // Calculate rate (beacons per second over last 10 seconds)
    const recentCutoff = beaconTimestamp - 10000;
    const recent = timestamps.filter(t => t >= recentCutoff);
    const rate = recent.length / 10.0;

    // Normal CMP beaconing is every 5 seconds = 0.2/s
    // Flooding threshold: > 5 per second
    if (rate > 5) {
      return this.createEvent(
        senderId,
        ThreatType.BEACON_FLOODING,
        rate > 20 ? ThreatSeverity.HIGH : ThreatSeverity.MEDIUM,
        DetectionMethod.RATE_VIOLATION,
        `Beacon rate ${rate.toFixed(1)}/s (normal: 0.2/s)`,
        [{ key: 'beacon_rate', expected: '< 1.0', actual: rate.toFixed(2) }],
        recent.length,
      );
    }

    return null;
  }

  // ═══════════════════════════════════════
  // Evaluation — Bidding Behavior (Layer 3)
  // ═══════════════════════════════════════

  /**
   * Evaluate negotiation behavior for cherry-picking or timing attacks.
   */
  evaluateBiddingBehavior(
    peerId: Uint8Array,
    bidsSubmitted: number,
    bidsWon: number,
    avgBidTimingMs: number,
    bidTimingVariance: number,
  ): ThreatEvent | null {
    const hex = toHex(peerId);
    const record = this.getOrCreateRecord(hex);

    // Track bid timings for pattern analysis
    record.bidTimings.push(avgBidTimingMs);
    if (record.bidTimings.length > 100) record.bidTimings.shift();

    // Check: Timing attack — suspiciously consistent bid timing (automated)
    if (record.bidTimings.length >= 10 && bidTimingVariance < 5) {
      return this.createEvent(
        peerId,
        ThreatType.TIMING_ATTACK,
        ThreatSeverity.MEDIUM,
        DetectionMethod.STATISTICAL_ANOMALY,
        `Bid timing variance ${bidTimingVariance.toFixed(1)}ms (suspiciously low)`,
        [{ key: 'bid_variance', expected: '> 10', actual: bidTimingVariance.toFixed(2) }],
        record.bidTimings.length,
      );
    }

    return null;
  }

  // ═══════════════════════════════════════
  // Evaluation — New Peer Screening (Layer 1)
  // ═══════════════════════════════════════

  /**
   * Check a newly discovered peer against loaded antibodies.
   * Also checks for Sybil attacks (multiple IDs from same address).
   */
  screenNewPeer(peerId: Uint8Array, transportAddress: string): Antibody | null {
    const hex = toHex(peerId);

    // Sybil detection: track identities per transport address
    if (!this.addressIdentities.has(transportAddress)) {
      this.addressIdentities.set(transportAddress, new Set());
    }
    const identities = this.addressIdentities.get(transportAddress)!;
    identities.add(hex);

    if (identities.size > 3) {
      this.createEvent(
        peerId,
        ThreatType.SYBIL_ATTACK,
        ThreatSeverity.HIGH,
        DetectionMethod.STATISTICAL_ANOMALY,
        `${identities.size} identities from ${transportAddress}`,
        [{ key: 'identity_count', expected: '<= 3', actual: String(identities.size) }],
        identities.size,
      );
    }

    // Check existing antibodies
    // For new peers, we can only match on simple criteria
    // Full behavior matching happens after task history builds up
    return null; // New peers get a clean slate — antibodies activate on behavior
  }

  // ═══════════════════════════════════════
  // Antibody Matching
  // ═══════════════════════════════════════

  /**
   * Run all loaded antibodies against a device's behavior record.
   */
  private matchAntibodies(deviceId: Uint8Array, record: DeviceBehaviorRecord): ThreatEvent | null {
    for (const [abId, antibody] of this.antibodies) {
      if (Date.now() > antibody.expiresAt) {
        this.antibodies.delete(abId);
        continue;
      }

      if (this.matchSignature(antibody.signature, record)) {
        // Antibody activated!
        antibody.activationCount++;
        antibody.lastActivatedAt = Date.now();

        return this.createEvent(
          deviceId,
          antibody.threatType,
          antibody.severity,
          DetectionMethod.ANTIBODY_MATCH,
          `Matched antibody ${abId.substring(0, 8)} (${antibody.threatType})`,
          [{ key: 'antibody_id', expected: 'none', actual: abId }],
          antibody.activationCount,
        );
      }
    }

    return null;
  }

  /**
   * Check if a device's behavior matches a behavioral signature.
   * All rules must match (AND logic).
   */
  private matchSignature(sig: BehavioralSignature, record: DeviceBehaviorRecord): boolean {
    for (const rule of sig.rules) {
      if (!this.evaluateRule(rule, record)) {
        return false; // All rules must match
      }
    }
    return sig.rules.length > 0; // Must have at least one rule
  }

  /**
   * Evaluate a single signature rule against behavior data.
   */
  private evaluateRule(rule: SignatureRule, record: DeviceBehaviorRecord): boolean {
    const metricValue = this.getMetricValue(rule.metric, record);
    if (metricValue === null) return false; // Can't evaluate

    switch (rule.operator) {
      case 'gt':
        return typeof rule.value === 'number' && metricValue > rule.value;
      case 'lt':
        return typeof rule.value === 'number' && metricValue < rule.value;
      case 'eq':
        return typeof rule.value === 'number' && Math.abs(metricValue - rule.value) < 0.001;
      case 'between':
        if (Array.isArray(rule.value)) {
          return metricValue >= rule.value[0] && metricValue <= rule.value[1];
        }
        return false;
      default:
        return false;
    }
  }

  /**
   * Extract a metric value from behavior record.
   */
  private getMetricValue(metric: SignatureMetric, record: DeviceBehaviorRecord): number | null {
    const total = Math.max(1, record.totalTasksAssigned);

    switch (metric) {
      case SignatureMetric.RESULT_ERROR_RATE:
        return record.resultMismatches / total;

      case SignatureMetric.TIMEOUT_RATE:
        return record.tasksTimedOut / total;

      case SignatureMetric.CAPABILITY_HONESTY:
        // Approximated: completion rate as proxy for honesty
        return record.tasksCompleted / total;

      case SignatureMetric.BEACON_RATE: {
        const timestamps = this.beaconTimestamps.get(record.deviceId);
        if (!timestamps || timestamps.length < 2) return 0;
        const span = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
        return span > 0 ? timestamps.length / span : 0;
      }

      case SignatureMetric.IDENTITY_MULTIPLICITY:
        // Would need transport address — approximate from address tracking
        return null;

      case SignatureMetric.BID_TIMING_VARIANCE: {
        if (record.bidTimings.length < 3) return null;
        const mean = record.bidTimings.reduce((s, v) => s + v, 0) / record.bidTimings.length;
        const variance = record.bidTimings.reduce((s, v) => s + (v - mean) ** 2, 0) / record.bidTimings.length;
        return Math.sqrt(variance);
      }

      case SignatureMetric.CHERRY_PICK_RATIO: {
        const highAccepted = record.highValueTasksAccepted;
        const lowRejected = record.lowValueTasksRejected;
        const totalDecisions = highAccepted + lowRejected;
        return totalDecisions > 0 ? highAccepted / totalDecisions : 0;
      }

      case SignatureMetric.REPUTATION_VELOCITY:
        // Would need reputation history — approximate
        return null;

      default:
        return null;
    }
  }

  // ═══════════════════════════════════════
  // Internals
  // ═══════════════════════════════════════

  private getOrCreateRecord(deviceHex: string): DeviceBehaviorRecord {
    let record = this.behaviorRecords.get(deviceHex);
    if (!record) {
      record = {
        deviceId: deviceHex,
        totalTasksAssigned: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        tasksTimedOut: 0,
        resultMismatches: 0,
        beaconsReceived: 0,
        lastBeaconAt: 0,
        bidTimings: [],
        highValueTasksAccepted: 0,
        lowValueTasksRejected: 0,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      this.behaviorRecords.set(deviceHex, record);
    }
    return record;
  }

  private createEvent(
    suspectId: Uint8Array,
    type: ThreatType,
    severity: ThreatSeverity,
    method: DetectionMethod,
    description: string,
    dataPoints: Array<{ key: string; expected: string; actual: string }>,
    incidentCount: number,
  ): ThreatEvent {
    const event: ThreatEvent = {
      id: randomId(),
      type,
      severity,
      suspectId,
      evidence: {
        description,
        dataPoints,
        incidentCount,
        observationWindowMs: Date.now() - (this.behaviorRecords.get(toHex(suspectId))?.firstSeenAt ?? Date.now()),
        confidence: Math.min(0.95, 0.5 + incidentCount * 0.1),
      },
      detectedAt: Date.now(),
      detectionMethod: method,
    };

    // Store in history
    const hex = toHex(suspectId);
    if (!this.eventHistory.has(hex)) {
      this.eventHistory.set(hex, []);
    }
    this.eventHistory.get(hex)!.push(event);

    return event;
  }

  /** Get behavior record for a device (for testing/CLI) */
  getBehaviorRecord(deviceId: Uint8Array): DeviceBehaviorRecord | undefined {
    return this.behaviorRecords.get(toHex(deviceId));
  }

  /** Get all behavior records */
  getAllBehaviorRecords(): DeviceBehaviorRecord[] {
    return [...this.behaviorRecords.values()];
  }
}
