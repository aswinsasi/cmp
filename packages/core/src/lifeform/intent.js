"use strict";
/**
 * CMP v1.4 — Intent System
 * A Lifeform declares machine-verifiable INTENTs — formal promises
 * about what it will achieve. The mesh verifies via probabilistic
 * sampling without re-execution or global consensus.
 *
 * Components:
 *   - IntentRegistry: stores and manages intent declarations
 *   - IntentVerifier: evaluates predicates against CRDT state
 *   - IntentSampler: coordinates probabilistic sampling protocol
 *   - ViolationHandler: executes violation actions (slash, kill, etc.)
 *
 * @module lifeform/intent
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViolationHandler = exports.IntentSampler = exports.IntentVerifier = exports.IntentRegistry = void 0;
const intent_1 = require("../types/intent");
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomBytes(n) {
    const bytes = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    }
    else {
        for (let i = 0; i < n; i++)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
}
// ═══════════════════════════════════════
// Intent Registry
// ═══════════════════════════════════════
class IntentRegistry {
    /** intentId hex → IntentContract */
    intents = new Map();
    /** lifeformId hex → Set of intentId hex */
    byLifeform = new Map();
    /**
     * Declare a new intent.
     */
    declare(intent) {
        const hex = toHex(intent.id);
        if (this.intents.has(hex))
            return false;
        this.intents.set(hex, intent);
        const lfHex = toHex(intent.lifeformId);
        if (!this.byLifeform.has(lfHex)) {
            this.byLifeform.set(lfHex, new Set());
        }
        this.byLifeform.get(lfHex).add(hex);
        return true;
    }
    /**
     * Revoke an intent.
     * Returns the staked CCU minus a 10% early revocation penalty.
     */
    revoke(intentId) {
        const hex = toHex(intentId);
        const intent = this.intents.get(hex);
        if (!intent)
            return { revoked: false, ccuReturned: 0 };
        const penalty = intent.ccuStaked * 0.1;
        const returned = intent.ccuStaked - penalty;
        // Clean up indices
        const lfHex = toHex(intent.lifeformId);
        this.byLifeform.get(lfHex)?.delete(hex);
        this.intents.delete(hex);
        return { revoked: true, ccuReturned: returned };
    }
    /**
     * Get an intent by ID.
     */
    get(intentId) {
        return this.intents.get(toHex(intentId)) ?? null;
    }
    /**
     * Get all intents for a Lifeform.
     */
    getForLifeform(lifeformId) {
        const lfHex = toHex(lifeformId);
        const ids = this.byLifeform.get(lfHex);
        if (!ids)
            return [];
        return [...ids].map(id => this.intents.get(id)).filter(Boolean);
    }
    /**
     * Get all active (non-expired) intents.
     */
    getActive() {
        const now = Date.now();
        return [...this.intents.values()].filter(i => i.expiresAt === 0 || i.expiresAt > now);
    }
    /**
     * Get intents due for sampling (sampleIntervalMs elapsed since last check).
     */
    getDueForSampling(lastCheckedAt) {
        const now = Date.now();
        return this.getActive().filter(i => {
            const elapsed = now - lastCheckedAt;
            return elapsed >= i.sampleIntervalMs;
        });
    }
    /**
     * Record a violation for an intent.
     * Increments consecutive violation count.
     * @returns true if violation threshold crossed
     */
    recordViolation(intentId) {
        const intent = this.intents.get(toHex(intentId));
        if (!intent)
            return false;
        intent.consecutiveViolations++;
        return intent.consecutiveViolations >= intent.violationThreshold;
    }
    /**
     * Reset consecutive violations (intent satisfied again).
     */
    resetViolations(intentId) {
        const intent = this.intents.get(toHex(intentId));
        if (intent)
            intent.consecutiveViolations = 0;
    }
    /**
     * Remove all intents for a Lifeform (on death).
     */
    removeAllFor(lifeformId) {
        const lfHex = toHex(lifeformId);
        const ids = this.byLifeform.get(lfHex);
        if (!ids)
            return 0;
        const count = ids.size;
        for (const id of ids) {
            this.intents.delete(id);
        }
        this.byLifeform.delete(lfHex);
        return count;
    }
    /** Total registered intents */
    get size() {
        return this.intents.size;
    }
}
exports.IntentRegistry = IntentRegistry;
// ═══════════════════════════════════════
// Intent Verifier
// ═══════════════════════════════════════
class IntentVerifier {
    /**
     * Evaluate a predicate against CRDT state.
     * Returns true if the intent is satisfied.
     */
    evaluate(predicate, state) {
        switch (predicate.type) {
            case intent_1.PredicateType.VALUE_CHECK:
                return this.evaluateValueCheck(predicate, state);
            case intent_1.PredicateType.FRESHNESS_CHECK:
                return this.evaluateFreshnessCheck(predicate, state);
            case intent_1.PredicateType.RATE_CHECK:
                return this.evaluateRateCheck(predicate, state);
            case intent_1.PredicateType.COMPOUND:
                return this.evaluateCompound(predicate, state);
            default:
                return false;
        }
    }
    /**
     * Evaluate a full intent contract against state.
     */
    evaluateIntent(intent, state) {
        const satisfied = this.evaluate(intent.predicate, state);
        return {
            intentId: intent.id,
            satisfied,
            samplesCollected: 1,
            satisfiedCount: satisfied ? 1 : 0,
            violatedCount: satisfied ? 0 : 1,
            evaluatedAt: Date.now(),
        };
    }
    // ── Predicate evaluators ──
    evaluateValueCheck(predicate, state) {
        const value = state.get(predicate.stateKey);
        if (value === undefined) {
            return predicate.operator === 'not_empty' ? false : false;
        }
        const numValue = typeof value === 'number' ? value : parseFloat(String(value));
        switch (predicate.operator) {
            case 'lt': return numValue < predicate.value;
            case 'gt': return numValue > predicate.value;
            case 'eq': return value === predicate.value || numValue === predicate.value;
            case 'lte': return numValue <= predicate.value;
            case 'gte': return numValue >= predicate.value;
            case 'between': {
                const [lo, hi] = predicate.value;
                return numValue >= lo && numValue <= hi;
            }
            case 'contains': {
                if (value instanceof Set)
                    return value.has(predicate.value);
                if (typeof value === 'string')
                    return value.includes(String(predicate.value));
                return false;
            }
            case 'not_empty': {
                if (value instanceof Set)
                    return value.size > 0;
                if (Array.isArray(value))
                    return value.length > 0;
                return value !== null && value !== undefined && value !== '';
            }
            default: return false;
        }
    }
    evaluateFreshnessCheck(predicate, state) {
        // Check if key was updated within the threshold (ms)
        // Simplified: check if key exists and has a value
        // Real impl would check CRDT timestamp
        const value = state.get(predicate.stateKey);
        return value !== undefined;
    }
    evaluateRateCheck(predicate, state) {
        // Rate check: value change per time window
        // Simplified: check if current value meets the threshold
        // Real impl would compare snapshots over time
        return this.evaluateValueCheck(predicate, state);
    }
    evaluateCompound(predicate, state) {
        if (!predicate.children || predicate.children.length === 0)
            return true;
        if (predicate.logicOperator === 'and') {
            return predicate.children.every(child => this.evaluate(child, state));
        }
        else {
            return predicate.children.some(child => this.evaluate(child, state));
        }
    }
}
exports.IntentVerifier = IntentVerifier;
class IntentSampler {
    /** intentId hex → SamplingRound */
    activeRounds = new Map();
    /** Total rounds completed */
    totalRounds = 0;
    totalViolations = 0;
    /**
     * Start a sampling round for an intent.
     * Selects random peers to sample.
     */
    startRound(intent, availablePeers) {
        if (availablePeers.length === 0)
            return null;
        const numSamplers = Math.min(intent.samplesPerInterval, availablePeers.length);
        // Random selection without replacement
        const shuffled = [...availablePeers].sort(() => Math.random() - 0.5);
        const selectedPeers = shuffled.slice(0, numSamplers);
        const round = {
            intentId: intent.id,
            selectedPeers,
            samples: [],
            startedAt: Date.now(),
            status: 'collecting',
            result: null,
        };
        this.activeRounds.set(toHex(intent.id), round);
        return round;
    }
    /**
     * Record a sample response from a peer.
     */
    recordSample(intentId, sample) {
        const round = this.activeRounds.get(toHex(intentId));
        if (!round || round.status !== 'collecting')
            return;
        round.samples.push(sample);
        // Check if all samples collected
        if (round.samples.length >= round.selectedPeers.length) {
            this.evaluateRound(round);
        }
    }
    /**
     * Evaluate a sampling round — majority vote.
     */
    evaluateRound(round) {
        round.status = 'evaluating';
        const satisfied = round.samples.filter(s => s.satisfied).length;
        const violated = round.samples.filter(s => !s.satisfied).length;
        const majoritySatisfied = satisfied > violated;
        round.result = majoritySatisfied;
        round.status = 'complete';
        this.totalRounds++;
        if (!majoritySatisfied)
            this.totalViolations++;
        // Clean up
        this.activeRounds.delete(toHex(round.intentId));
        return {
            intentId: round.intentId,
            satisfied: majoritySatisfied,
            samplesCollected: round.samples.length,
            satisfiedCount: satisfied,
            violatedCount: violated,
            evaluatedAt: Date.now(),
        };
    }
    /**
     * Force-complete a round (timeout).
     */
    forceComplete(intentId) {
        const round = this.activeRounds.get(toHex(intentId));
        if (!round)
            return null;
        return this.evaluateRound(round);
    }
    /** Get active round for an intent */
    getActiveRound(intentId) {
        return this.activeRounds.get(toHex(intentId)) ?? null;
    }
    /** Get stats */
    getStats() {
        return {
            totalRounds: this.totalRounds,
            totalViolations: this.totalViolations,
            activeRounds: this.activeRounds.size,
        };
    }
}
exports.IntentSampler = IntentSampler;
class ViolationHandler {
    history = [];
    /** Callback hooks */
    onSlash = null;
    onKill = null;
    onForceFission = null;
    onNotify = null;
    /** Set violation action callbacks */
    setCallbacks(cbs) {
        if (cbs.onSlash)
            this.onSlash = cbs.onSlash;
        if (cbs.onKill)
            this.onKill = cbs.onKill;
        if (cbs.onForceFission)
            this.onForceFission = cbs.onForceFission;
        if (cbs.onNotify)
            this.onNotify = cbs.onNotify;
    }
    /**
     * Execute a violation action.
     */
    handleViolation(intent) {
        const record = {
            intentId: intent.id,
            lifeformId: intent.lifeformId,
            action: intent.violationAction,
            ccuSlashed: 0,
            beneficiaryId: intent.beneficiaryId,
            timestamp: Date.now(),
        };
        switch (intent.violationAction) {
            case intent_1.ViolationAction.NOTIFY:
                if (this.onNotify)
                    this.onNotify(intent.lifeformId, intent.id);
                break;
            case intent_1.ViolationAction.SLASH:
                record.ccuSlashed = intent.ccuStaked;
                if (this.onSlash)
                    this.onSlash(intent.lifeformId, intent.ccuStaked, intent.beneficiaryId);
                break;
            case intent_1.ViolationAction.KILL:
                record.ccuSlashed = intent.ccuStaked;
                if (this.onSlash)
                    this.onSlash(intent.lifeformId, intent.ccuStaked, intent.beneficiaryId);
                if (this.onKill)
                    this.onKill(intent.lifeformId, `Intent violation: ${intent.description}`);
                break;
            case intent_1.ViolationAction.FORCE_FISSION:
                if (this.onForceFission)
                    this.onForceFission(intent.lifeformId);
                break;
        }
        this.history.push(record);
        return record;
    }
    /** Get violation history */
    getHistory() {
        return [...this.history];
    }
    /** Get violation count for a Lifeform */
    getViolationCount(lifeformId) {
        const hex = toHex(lifeformId);
        return this.history.filter(r => toHex(r.lifeformId) === hex).length;
    }
}
exports.ViolationHandler = ViolationHandler;
//# sourceMappingURL=intent.js.map