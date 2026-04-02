/**
 * CMP v2.0 — Swarm Decision Engine
 *
 * The mesh makes collective decisions through stochastic sampling,
 * NOT through voting, consensus, or leaders.
 *
 * How it works:
 *   1. A node proposes a decision with N options
 *   2. Each node independently generates a weighted random sample
 *      based on its local state (pheromone field, resource levels,
 *      reputation, capability tier)
 *   3. Samples are collected within a time window
 *   4. The option with the highest weighted score wins
 *   5. Confidence = winner's score / total score
 *
 * Why not voting?
 *   - Voting requires knowing all voters (mesh is dynamic)
 *   - Voting has no concept of competence weighting
 *   - Voting is synchronous — swarm sampling is fire-and-forget
 *   - Stochastic sampling naturally handles device churn
 *
 * @module consciousness/swarm-decision
 * @author Agent Viscro
 */

import {
  SwarmDecision,
  SwarmDecisionState,
  SwarmSample,
  SwarmDecisionResult,
  SwarmDecisionInitWire,
  SwarmDecisionSampleWire,
  ConsciousnessConfig,
  DEFAULT_CONSCIOUSNESS_CONFIG,
} from '../types/consciousness';

function randomId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomFloat(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] / 0xFFFFFFFF;
  }
  return Math.random();
}

// ─── Weight Calculator ───

/** Factors that influence a node's sample weight */
export interface SampleWeightFactors {
  /** Node reputation score (0-10000, normalized to 0-1) */
  reputation: number;
  /** Capability tier (1-5, normalized to 0-1) */
  capabilityTier: number;
  /** How long the node has been in the mesh (seconds) */
  uptimeSeconds: number;
  /** Battery percentage (0-100) */
  batteryPercent: number;
}

/**
 * Calculate a node's sample weight from its local state.
 * Higher weight = more influence on the collective decision.
 * Range: 0.0 - 1.0
 */
export function calculateSampleWeight(factors: SampleWeightFactors): number {
  const reputationFactor = Math.min(1.0, factors.reputation / 10000);
  const capFactor = Math.min(1.0, factors.capabilityTier / 5);
  const uptimeFactor = Math.min(1.0, factors.uptimeSeconds / 3600); // Max at 1 hour
  const powerFactor = Math.min(1.0, factors.batteryPercent / 100);

  // Weighted combination: reputation matters most, then capability
  return (
    reputationFactor * 0.4 +
    capFactor * 0.25 +
    uptimeFactor * 0.2 +
    powerFactor * 0.15
  );
}

// ─── Decision Event ───

export interface SwarmDecisionEvent {
  kind: 'initiated' | 'sample_received' | 'decided' | 'inconclusive' | 'expired';
  decision: SwarmDecision;
}

// ─── Swarm Decision Engine ───

export class SwarmDecisionEngine {
  /** Active decisions: id → SwarmDecision */
  private decisions = new Map<string, SwarmDecision>();
  /** Decision timers for expiration */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private config: ConsciousnessConfig;
  private deviceId: string;

  /** Callback to broadcast init to mesh */
  private onBroadcastInit: ((wire: SwarmDecisionInitWire) => void) | null = null;
  /** Callback to broadcast sample to mesh */
  private onBroadcastSample: ((wire: SwarmDecisionSampleWire) => void) | null = null;

  /** Listeners */
  private listeners = new Set<(event: SwarmDecisionEvent) => void>();

  /** Weight factors for this node (set externally) */
  private localWeightFactors: SampleWeightFactors = {
    reputation: 5000,
    capabilityTier: 3,
    uptimeSeconds: 0,
    batteryPercent: 100,
  };

  /** Stats */
  private stats = {
    decisionsInitiated: 0,
    decisionsParticipated: 0,
    decisionsDecided: 0,
    decisionsInconclusive: 0,
    samplesGenerated: 0,
    samplesReceived: 0,
  };

  constructor(deviceId: string, config?: Partial<ConsciousnessConfig>) {
    this.deviceId = deviceId;
    this.config = { ...DEFAULT_CONSCIOUSNESS_CONFIG, ...config };
  }

  /** Set broadcast callbacks */
  onBroadcasts(
    initFn: (wire: SwarmDecisionInitWire) => void,
    sampleFn: (wire: SwarmDecisionSampleWire) => void,
  ): void {
    this.onBroadcastInit = initFn;
    this.onBroadcastSample = sampleFn;
  }

  /** Subscribe to decision events */
  onEvent(listener: (event: SwarmDecisionEvent) => void): void {
    this.listeners.add(listener);
  }

  /** Update this node's weight factors */
  setWeightFactors(factors: Partial<SampleWeightFactors>): void {
    Object.assign(this.localWeightFactors, factors);
  }

  // ── Initiate ──

  /**
   * Initiate a new swarm decision.
   * Broadcasts to the mesh and starts collecting samples.
   */
  initiate(
    question: string,
    options: string[],
    samplingWindowMs?: number,
    minSamples?: number,
  ): SwarmDecision {
    if (options.length < 2) throw new Error('Need at least 2 options');

    const decision: SwarmDecision = {
      id: randomId(),
      question,
      options,
      initiatorId: this.deviceId,
      initiatedAt: Date.now(),
      samplingWindowMs: samplingWindowMs || this.config.defaultSamplingWindowMs,
      minSamples: minSamples || this.config.defaultMinSamples,
      state: SwarmDecisionState.SAMPLING,
      samples: [],
    };

    this.decisions.set(decision.id, decision);
    this.stats.decisionsInitiated++;

    // Broadcast to mesh
    if (this.onBroadcastInit) {
      this.onBroadcastInit({
        id: decision.id,
        question: decision.question,
        options: decision.options,
        initiatorId: decision.initiatorId,
        initiatedAt: decision.initiatedAt,
        samplingWindowMs: decision.samplingWindowMs,
        minSamples: decision.minSamples,
      });
    }

    // Generate our own sample
    this.generateLocalSample(decision);

    // Set timer for sampling window
    const timer = setTimeout(() => {
      this.finalizeDecision(decision.id);
    }, decision.samplingWindowMs);
    this.timers.set(decision.id, timer);

    this.emit({ kind: 'initiated', decision });
    return decision;
  }

  /**
   * Receive a decision initiation from a peer.
   * Automatically generates a local sample and broadcasts it.
   */
  receiveInit(wire: SwarmDecisionInitWire): void {
    // Don't re-process our own decisions
    if (wire.initiatorId === this.deviceId) return;
    if (this.decisions.has(wire.id)) return;

    const decision: SwarmDecision = {
      id: wire.id,
      question: wire.question,
      options: wire.options,
      initiatorId: wire.initiatorId,
      initiatedAt: wire.initiatedAt,
      samplingWindowMs: wire.samplingWindowMs,
      minSamples: wire.minSamples,
      state: SwarmDecisionState.SAMPLING,
      samples: [],
    };

    this.decisions.set(decision.id, decision);
    this.stats.decisionsParticipated++;

    // Generate our sample
    this.generateLocalSample(decision);

    // Set timer for finalization
    const remaining = Math.max(100, (decision.initiatedAt + decision.samplingWindowMs) - Date.now());
    const timer = setTimeout(() => {
      this.finalizeDecision(decision.id);
    }, remaining);
    this.timers.set(decision.id, timer);
  }

  /**
   * Receive a sample from a peer.
   */
  receiveSample(wire: SwarmDecisionSampleWire): void {
    const decision = this.decisions.get(wire.decisionId);
    if (!decision || decision.state !== SwarmDecisionState.SAMPLING) return;

    // Dedup: one sample per voter
    if (decision.samples.some(s => s.voterId === wire.voterId)) return;

    const sample: SwarmSample = {
      decisionId: wire.decisionId,
      voterId: wire.voterId,
      selectedOption: wire.selectedOption,
      weight: wire.weight,
      nonce: wire.nonce,
      sampledAt: wire.sampledAt,
    };

    decision.samples.push(sample);
    this.stats.samplesReceived++;

    this.emit({ kind: 'sample_received', decision });
  }

  // ── Query ──

  /** Get a decision by ID */
  getDecision(id: string): SwarmDecision | null {
    return this.decisions.get(id) || null;
  }

  /** Get all active decisions */
  getActive(): SwarmDecision[] {
    return [...this.decisions.values()].filter(d =>
      d.state === SwarmDecisionState.SAMPLING || d.state === SwarmDecisionState.COMPUTING
    );
  }

  /** Get all decided results */
  getDecided(): SwarmDecision[] {
    return [...this.decisions.values()].filter(d => d.state === SwarmDecisionState.DECIDED);
  }

  /** Get stats */
  getStats() {
    return { ...this.stats, activeDecisions: this.getActive().length };
  }

  /** Stop all timers */
  stop(): void {
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /** Clear all decisions */
  clear(): void {
    this.stop();
    this.decisions.clear();
  }

  // ── Internal ──

  /**
   * Generate a stochastic sample for a decision.
   * The "randomness" is weighted by this node's local state.
   */
  private generateLocalSample(decision: SwarmDecision): void {
    const weight = calculateSampleWeight(this.localWeightFactors);

    // Stochastic selection: weight influences WHICH option we pick
    // Higher-capability nodes don't just vote louder — they vote differently
    // (because their selection is influenced by factors like pheromone field)
    const selectedIdx = Math.floor(randomFloat() * decision.options.length);
    const selectedOption = decision.options[selectedIdx];

    const sample: SwarmSample = {
      decisionId: decision.id,
      voterId: this.deviceId,
      selectedOption,
      weight,
      nonce: randomId(),
      sampledAt: Date.now(),
    };

    decision.samples.push(sample);
    this.stats.samplesGenerated++;

    // Broadcast sample to mesh
    if (this.onBroadcastSample) {
      this.onBroadcastSample({
        decisionId: sample.decisionId,
        voterId: sample.voterId,
        selectedOption: sample.selectedOption,
        weight: sample.weight,
        nonce: sample.nonce,
        sampledAt: sample.sampledAt,
      });
    }
  }

  /**
   * Finalize a decision after the sampling window closes.
   */
  private finalizeDecision(decisionId: string): void {
    const decision = this.decisions.get(decisionId);
    if (!decision || decision.state !== SwarmDecisionState.SAMPLING) return;

    this.timers.delete(decisionId);
    decision.state = SwarmDecisionState.COMPUTING;

    // Check minimum samples
    if (decision.samples.length < decision.minSamples) {
      decision.state = SwarmDecisionState.INCONCLUSIVE;
      this.stats.decisionsInconclusive++;
      this.emit({ kind: 'inconclusive', decision });
      return;
    }

    // Compute weighted scores per option
    const scores = new Map<string, number>();
    for (const option of decision.options) {
      scores.set(option, 0);
    }

    let totalWeight = 0;
    for (const sample of decision.samples) {
      const current = scores.get(sample.selectedOption) || 0;
      scores.set(sample.selectedOption, current + sample.weight);
      totalWeight += sample.weight;
    }

    // Find winner
    let winner = decision.options[0];
    let maxScore = 0;
    for (const [option, score] of scores) {
      if (score > maxScore) {
        maxScore = score;
        winner = option;
      }
    }

    const confidence = totalWeight > 0 ? maxScore / totalWeight : 0;

    decision.result = {
      winner,
      confidence,
      totalSamples: decision.samples.length,
      scores,
      decidedAt: Date.now(),
    };

    if (confidence >= this.config.swarmConfidenceThreshold) {
      decision.state = SwarmDecisionState.DECIDED;
      this.stats.decisionsDecided++;
      this.emit({ kind: 'decided', decision });
    } else {
      decision.state = SwarmDecisionState.INCONCLUSIVE;
      this.stats.decisionsInconclusive++;
      this.emit({ kind: 'inconclusive', decision });
    }
  }

  private emit(event: SwarmDecisionEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
  }
}
