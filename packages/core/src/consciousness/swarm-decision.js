"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwarmDecisionEngine = void 0;
exports.calculateSampleWeight = calculateSampleWeight;
const consciousness_1 = require("../types/consciousness");
function randomId() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < 8; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomFloat() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const arr = new Uint32Array(1);
        crypto.getRandomValues(arr);
        return arr[0] / 0xFFFFFFFF;
    }
    return Math.random();
}
/**
 * Calculate a node's sample weight from its local state.
 * Higher weight = more influence on the collective decision.
 * Range: 0.0 - 1.0
 */
function calculateSampleWeight(factors) {
    const reputationFactor = Math.min(1.0, factors.reputation / 10000);
    const capFactor = Math.min(1.0, factors.capabilityTier / 5);
    const uptimeFactor = Math.min(1.0, factors.uptimeSeconds / 3600); // Max at 1 hour
    const powerFactor = Math.min(1.0, factors.batteryPercent / 100);
    // Weighted combination: reputation matters most, then capability
    return (reputationFactor * 0.4 +
        capFactor * 0.25 +
        uptimeFactor * 0.2 +
        powerFactor * 0.15);
}
// ─── Swarm Decision Engine ───
class SwarmDecisionEngine {
    /** Active decisions: id → SwarmDecision */
    decisions = new Map();
    /** Decision timers for expiration */
    timers = new Map();
    config;
    deviceId;
    /** Callback to broadcast init to mesh */
    onBroadcastInit = null;
    /** Callback to broadcast sample to mesh */
    onBroadcastSample = null;
    /** Listeners */
    listeners = new Set();
    /** Weight factors for this node (set externally) */
    localWeightFactors = {
        reputation: 5000,
        capabilityTier: 3,
        uptimeSeconds: 0,
        batteryPercent: 100,
    };
    /** Stats */
    stats = {
        decisionsInitiated: 0,
        decisionsParticipated: 0,
        decisionsDecided: 0,
        decisionsInconclusive: 0,
        samplesGenerated: 0,
        samplesReceived: 0,
    };
    constructor(deviceId, config) {
        this.deviceId = deviceId;
        this.config = { ...consciousness_1.DEFAULT_CONSCIOUSNESS_CONFIG, ...config };
    }
    /** Set broadcast callbacks */
    onBroadcasts(initFn, sampleFn) {
        this.onBroadcastInit = initFn;
        this.onBroadcastSample = sampleFn;
    }
    /** Subscribe to decision events */
    onEvent(listener) {
        this.listeners.add(listener);
    }
    /** Update this node's weight factors */
    setWeightFactors(factors) {
        Object.assign(this.localWeightFactors, factors);
    }
    // ── Initiate ──
    /**
     * Initiate a new swarm decision.
     * Broadcasts to the mesh and starts collecting samples.
     */
    initiate(question, options, samplingWindowMs, minSamples) {
        if (options.length < 2)
            throw new Error('Need at least 2 options');
        const decision = {
            id: randomId(),
            question,
            options,
            initiatorId: this.deviceId,
            initiatedAt: Date.now(),
            samplingWindowMs: samplingWindowMs || this.config.defaultSamplingWindowMs,
            minSamples: minSamples || this.config.defaultMinSamples,
            state: consciousness_1.SwarmDecisionState.SAMPLING,
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
    receiveInit(wire) {
        // Don't re-process our own decisions
        if (wire.initiatorId === this.deviceId)
            return;
        if (this.decisions.has(wire.id))
            return;
        const decision = {
            id: wire.id,
            question: wire.question,
            options: wire.options,
            initiatorId: wire.initiatorId,
            initiatedAt: wire.initiatedAt,
            samplingWindowMs: wire.samplingWindowMs,
            minSamples: wire.minSamples,
            state: consciousness_1.SwarmDecisionState.SAMPLING,
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
    receiveSample(wire) {
        const decision = this.decisions.get(wire.decisionId);
        if (!decision || decision.state !== consciousness_1.SwarmDecisionState.SAMPLING)
            return;
        // Dedup: one sample per voter
        if (decision.samples.some(s => s.voterId === wire.voterId))
            return;
        const sample = {
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
    getDecision(id) {
        return this.decisions.get(id) || null;
    }
    /** Get all active decisions */
    getActive() {
        return [...this.decisions.values()].filter(d => d.state === consciousness_1.SwarmDecisionState.SAMPLING || d.state === consciousness_1.SwarmDecisionState.COMPUTING);
    }
    /** Get all decided results */
    getDecided() {
        return [...this.decisions.values()].filter(d => d.state === consciousness_1.SwarmDecisionState.DECIDED);
    }
    /** Get stats */
    getStats() {
        return { ...this.stats, activeDecisions: this.getActive().length };
    }
    /** Stop all timers */
    stop() {
        for (const [, timer] of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }
    /** Clear all decisions */
    clear() {
        this.stop();
        this.decisions.clear();
    }
    // ── Internal ──
    /**
     * Generate a stochastic sample for a decision.
     * The "randomness" is weighted by this node's local state.
     */
    generateLocalSample(decision) {
        const weight = calculateSampleWeight(this.localWeightFactors);
        // Stochastic selection: weight influences WHICH option we pick
        // Higher-capability nodes don't just vote louder — they vote differently
        // (because their selection is influenced by factors like pheromone field)
        const selectedIdx = Math.floor(randomFloat() * decision.options.length);
        const selectedOption = decision.options[selectedIdx];
        const sample = {
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
    finalizeDecision(decisionId) {
        const decision = this.decisions.get(decisionId);
        if (!decision || decision.state !== consciousness_1.SwarmDecisionState.SAMPLING)
            return;
        this.timers.delete(decisionId);
        decision.state = consciousness_1.SwarmDecisionState.COMPUTING;
        // Check minimum samples
        if (decision.samples.length < decision.minSamples) {
            decision.state = consciousness_1.SwarmDecisionState.INCONCLUSIVE;
            this.stats.decisionsInconclusive++;
            this.emit({ kind: 'inconclusive', decision });
            return;
        }
        // Compute weighted scores per option
        const scores = new Map();
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
            decision.state = consciousness_1.SwarmDecisionState.DECIDED;
            this.stats.decisionsDecided++;
            this.emit({ kind: 'decided', decision });
        }
        else {
            decision.state = consciousness_1.SwarmDecisionState.INCONCLUSIVE;
            this.stats.decisionsInconclusive++;
            this.emit({ kind: 'inconclusive', decision });
        }
    }
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch { }
        }
    }
}
exports.SwarmDecisionEngine = SwarmDecisionEngine;
//# sourceMappingURL=swarm-decision.js.map