"use strict";
/**
 * CMP v1.3 — Antibody Generator
 * Creates behavioral signatures (antibodies) from accumulated threat events.
 * Antibodies are reusable detection patterns that can identify similar
 * malicious behavior in new devices — and can be shared across meshes.
 *
 * @module immune/antibody-generator
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AntibodyGenerator = void 0;
const immune_1 = require("../types/immune");
function randomId() {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < 16; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
const DEFAULT_CONFIG = {
    minIncidentsForAntibody: 3,
    antibodyTtlMs: 7 * 24 * 3600 * 1000,
    mediumQuarantineDurationMs: 3600 * 1000,
    highQuarantineDurationMs: 24 * 3600 * 1000,
    maxFalsePositives: 5,
    enablePollinatedImmunity: true,
    minShareConfidence: 0.8,
};
class AntibodyGenerator {
    config;
    meshFingerprint;
    constructor(meshFingerprint, config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.meshFingerprint = meshFingerprint;
    }
    /**
     * Generate an antibody from accumulated threat events.
     *
     * Algorithm:
     * 1. Filter events for the same threatType
     * 2. If incidents < minIncidentsForAntibody → return null
     * 3. Extract common patterns across incidents
     * 4. Build SignatureRule[] from statistical thresholds
     * 5. Calculate confidence from evidence consistency
     * 6. Create Antibody with TTL
     *
     * @returns Antibody or null if insufficient evidence
     */
    generateFromEvents(events) {
        if (events.length < this.config.minIncidentsForAntibody) {
            return null;
        }
        // All events should be the same threat type
        const threatType = events[0].type;
        const sameType = events.filter(e => e.type === threatType);
        if (sameType.length < this.config.minIncidentsForAntibody) {
            return null;
        }
        // Extract signature rules based on threat type
        const rules = this.extractRules(threatType, sameType);
        if (rules.length === 0)
            return null;
        // Calculate confidence from evidence quality
        const avgConfidence = sameType.reduce((s, e) => s + e.evidence.confidence, 0) / sameType.length;
        const consistency = this.measureConsistency(sameType);
        const confidence = Math.min(0.95, avgConfidence * consistency);
        // Determine severity from majority
        const severity = this.majorityVerdict(sameType.map(e => e.severity));
        const now = Date.now();
        return {
            id: randomId(),
            threatType,
            signature: { rules },
            severity,
            activationCount: 0,
            createdAt: now,
            lastActivatedAt: 0,
            originMeshFingerprint: this.meshFingerprint,
            falsePositiveCount: 0,
            confidence,
            expiresAt: now + this.config.antibodyTtlMs,
        };
    }
    /**
     * Merge two antibodies targeting the same threat type.
     * Takes stricter thresholds and combined activation counts.
     */
    mergeAntibodies(local, foreign) {
        // Combine rules — take union, prefer stricter thresholds
        const mergedRules = [...local.signature.rules];
        for (const foreignRule of foreign.signature.rules) {
            const existing = mergedRules.find(r => r.metric === foreignRule.metric);
            if (existing) {
                // Keep the stricter threshold
                if (existing.operator === 'gt' && foreignRule.operator === 'gt') {
                    if (typeof foreignRule.value === 'number' && typeof existing.value === 'number') {
                        existing.value = Math.min(existing.value, foreignRule.value); // Lower threshold = stricter for "gt"
                    }
                }
            }
            else {
                mergedRules.push({ ...foreignRule });
            }
        }
        return {
            ...local,
            signature: { rules: mergedRules },
            activationCount: local.activationCount + foreign.activationCount,
            confidence: Math.max(local.confidence, foreign.confidence),
            lastActivatedAt: Math.max(local.lastActivatedAt, foreign.lastActivatedAt),
            // Keep the longer expiry
            expiresAt: Math.max(local.expiresAt, foreign.expiresAt),
        };
    }
    // ── Rule Extraction per Threat Type ──
    extractRules(type, events) {
        const windowMs = this.calculateObservationWindow(events);
        switch (type) {
            case immune_1.ThreatType.RESULT_POISONING:
                return this.rulesForResultPoisoning(events, windowMs);
            case immune_1.ThreatType.CAPABILITY_FRAUD:
                return this.rulesForCapabilityFraud(events, windowMs);
            case immune_1.ThreatType.TASK_SINKHOLE:
                return this.rulesForTaskSinkhole(events, windowMs);
            case immune_1.ThreatType.BEACON_FLOODING:
                return this.rulesForBeaconFlooding(events, windowMs);
            case immune_1.ThreatType.SYBIL_ATTACK:
                return this.rulesForSybilAttack(events, windowMs);
            case immune_1.ThreatType.TIMING_ATTACK:
                return this.rulesForTimingAttack(events, windowMs);
            case immune_1.ThreatType.REPUTATION_GAMING:
                return this.rulesForReputationGaming(events, windowMs);
            default:
                // Generic: high error rate
                return [{
                        metric: immune_1.SignatureMetric.RESULT_ERROR_RATE,
                        operator: 'gt',
                        value: 0.5,
                        windowMs,
                    }];
        }
    }
    rulesForResultPoisoning(events, windowMs) {
        // Extract average error rate from evidence
        const errorRates = events
            .map(e => e.evidence.dataPoints.find(d => d.key === 'error_rate'))
            .filter(Boolean)
            .map(d => parseFloat(d.actual));
        const threshold = errorRates.length > 0
            ? Math.max(0.3, Math.min(...errorRates) * 0.8)
            : 0.5;
        return [{
                metric: immune_1.SignatureMetric.RESULT_ERROR_RATE,
                operator: 'gt',
                value: threshold,
                windowMs,
            }];
    }
    rulesForCapabilityFraud(events, windowMs) {
        return [{
                metric: immune_1.SignatureMetric.CAPABILITY_HONESTY,
                operator: 'lt',
                value: 0.5, // Performance < 50% of claimed capability
                windowMs,
            }];
    }
    rulesForTaskSinkhole(events, windowMs) {
        return [{
                metric: immune_1.SignatureMetric.TIMEOUT_RATE,
                operator: 'gt',
                value: 0.6, // 60%+ timeout rate
                windowMs,
            }];
    }
    rulesForBeaconFlooding(events, windowMs) {
        return [{
                metric: immune_1.SignatureMetric.BEACON_RATE,
                operator: 'gt',
                value: 10, // More than 10 beacons per second
                windowMs: 5000,
            }];
    }
    rulesForSybilAttack(events, windowMs) {
        return [{
                metric: immune_1.SignatureMetric.IDENTITY_MULTIPLICITY,
                operator: 'gt',
                value: 3, // More than 3 identities from same transport address
                windowMs,
            }];
    }
    rulesForTimingAttack(events, windowMs) {
        return [{
                metric: immune_1.SignatureMetric.BID_TIMING_VARIANCE,
                operator: 'lt',
                value: 5, // Suspiciously low variance (< 5ms) = automated
                windowMs,
            }];
    }
    rulesForReputationGaming(events, windowMs) {
        return [
            {
                metric: immune_1.SignatureMetric.CHERRY_PICK_RATIO,
                operator: 'gt',
                value: 0.8, // Accepts 80%+ high-value, rejects low-value
                windowMs,
            },
            {
                metric: immune_1.SignatureMetric.REPUTATION_VELOCITY,
                operator: 'gt',
                value: 2.0, // Reputation growing 2x faster than justified
                windowMs,
            },
        ];
    }
    // ── Helpers ──
    calculateObservationWindow(events) {
        if (events.length < 2)
            return 3600000; // 1 hour default
        const timestamps = events.map(e => e.detectedAt).sort((a, b) => a - b);
        const span = timestamps[timestamps.length - 1] - timestamps[0];
        return Math.max(span * 1.5, 60000); // At least 1 minute
    }
    measureConsistency(events) {
        if (events.length < 2)
            return 0.5;
        // All same threat type? → 1.0
        // All same detection method? → +0.2
        const sameMethod = events.every(e => e.detectionMethod === events[0].detectionMethod);
        return sameMethod ? 1.0 : 0.8;
    }
    majorityVerdict(severities) {
        const counts = new Map();
        for (const s of severities) {
            counts.set(s, (counts.get(s) ?? 0) + 1);
        }
        let maxCount = 0;
        let result = immune_1.ThreatSeverity.MEDIUM;
        for (const [sev, count] of counts) {
            if (count > maxCount) {
                maxCount = count;
                result = sev;
            }
        }
        return result;
    }
}
exports.AntibodyGenerator = AntibodyGenerator;
//# sourceMappingURL=antibody-generator.js.map