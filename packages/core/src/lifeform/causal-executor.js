"use strict";
/**
 * CMP v1.4 — Causal Executor
 * Replaces the tick-based TickScheduler. Lifeforms are inert until
 * a Cause arrives. The executor:
 *   - Wakes Lifeforms on cause arrival
 *   - Manages Lifeform-set timers (one-shot and recurring)
 *   - Tracks CausalChains across the mesh
 *   - Implements backpressure on runaway cascades
 *   - Bills CCU per-cause (not per-tick)
 *
 * @module lifeform/causal-executor
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CausalExecutor = void 0;
const causal_1 = require("../types/causal");
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
const DEFAULT_CONFIG = {
    maxConcurrent: 1,
    maxChainDepth: 64,
    maxChainCcu: 100,
    billing: causal_1.DEFAULT_CAUSE_BILLING,
    chainTtlMs: 60000,
};
class CausalExecutor {
    config;
    running = false;
    /** Active causal chains: chainId hex → CausalChain */
    chains = new Map();
    /** Active timers: timerId hex → LifeformTimer */
    timers = new Map();
    /** Timer intervals: timerId hex → NodeJS timeout handle */
    timerHandles = new Map();
    /** Cause handler (set by LifeformRuntime) */
    handler = null;
    /** Callback to deliver timer-generated causes */
    onTimerCause = null;
    /** Stats */
    totalExecuted = 0;
    totalCcuSpent = 0;
    totalErrors = 0;
    chainStats = {
        totalChains: 0,
        backpressured: 0,
        deadlineMissed: 0,
    };
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** Set the cause handler (called when a cause is ready to process) */
    setHandler(handler) {
        this.handler = handler;
    }
    /** Set callback for timer-generated causes */
    onTimer(fn) {
        this.onTimerCause = fn;
    }
    /** Start the executor */
    start() {
        this.running = true;
    }
    /** Stop the executor — cancel all timers */
    stop() {
        this.running = false;
        for (const handle of this.timerHandles.values()) {
            clearTimeout(handle);
        }
        this.timerHandles.clear();
        this.timers.clear();
    }
    // ═══════════════════════════════════════
    // Cause Execution
    // ═══════════════════════════════════════
    /**
     * Execute a cause. This is the core method — called when a Lifeform
     * needs to wake and process a cause.
     *
     * Steps:
     * 1. Check/create CausalChain tracking
     * 2. Check backpressure (chain depth, CCU limits)
     * 3. Check deadline
     * 4. Call the handler
     * 5. Calculate CCU cost
     * 6. Update chain stats
     * 7. Return result with outgoing causes
     */
    async executeCause(cause) {
        if (!this.running || !this.handler) {
            return this.failResult(cause, 'Executor not running');
        }
        const chainHex = toHex(cause.chainId);
        // Step 1: Track causal chain
        let chain = this.chains.get(chainHex);
        if (!chain) {
            chain = {
                chainId: cause.chainId,
                originCauseId: cause.id,
                totalCauses: 0,
                lifeformsTouched: new Set(),
                totalCcuSpent: 0,
                startedAt: Date.now(),
                deadlineMs: cause.deadlineMs,
                backpressureActive: false,
                maxDepthReached: 0,
            };
            this.chains.set(chainHex, chain);
            this.chainStats.totalChains++;
        }
        // Step 2: Backpressure checks
        if (cause.chainDepth >= this.config.maxChainDepth) {
            chain.backpressureActive = true;
            this.chainStats.backpressured++;
            return this.failResult(cause, `Chain depth ${cause.chainDepth} exceeds max ${this.config.maxChainDepth}`);
        }
        if (chain.totalCcuSpent >= this.config.maxChainCcu) {
            chain.backpressureActive = true;
            this.chainStats.backpressured++;
            return this.failResult(cause, `Chain CCU ${chain.totalCcuSpent} exceeds max ${this.config.maxChainCcu}`);
        }
        // Step 3: Deadline check
        if (cause.deadlineMs > 0 && Date.now() > cause.deadlineMs) {
            this.chainStats.deadlineMissed++;
            return this.failResult(cause, 'Deadline expired');
        }
        // Step 4: Execute handler
        const startTime = Date.now();
        let stateMutations = 0;
        let outgoingCauses = [];
        try {
            const result = await this.handler(cause);
            stateMutations = result.stateMutations;
            outgoingCauses = result.outgoingCauses;
        }
        catch (err) {
            this.totalErrors++;
            return this.failResult(cause, err.message);
        }
        const executionTimeMs = Date.now() - startTime;
        // Step 5: Calculate CCU cost
        const ccuCost = (0, causal_1.calculateCauseCost)(this.config.billing, executionTimeMs, stateMutations);
        // Step 6: Update chain stats
        chain.totalCauses++;
        chain.totalCcuSpent += ccuCost;
        chain.maxDepthReached = Math.max(chain.maxDepthReached, cause.chainDepth);
        chain.lifeformsTouched.add(toHex(cause.targetId));
        // Stamp outgoing causes with chain info
        for (const outgoing of outgoingCauses) {
            outgoing.chainId = cause.chainId;
            outgoing.chainDepth = cause.chainDepth + 1;
            outgoing.maxChainDepth = cause.maxChainDepth;
            if (cause.deadlineMs > 0) {
                outgoing.deadlineMs = cause.deadlineMs;
            }
        }
        this.totalExecuted++;
        this.totalCcuSpent += ccuCost;
        return {
            causeId: cause.id,
            chainId: cause.chainId,
            executionTimeMs,
            stateMutations,
            ccuCost,
            outgoingCauses,
            success: true,
        };
    }
    // ═══════════════════════════════════════
    // Timer Management
    // ═══════════════════════════════════════
    /**
     * Set a timer for a Lifeform.
     * When the timer fires, it generates a TIMER cause.
     */
    setTimer(lifeformId, delayMs, intervalMs, payload, maxFirings = 0) {
        const timerId = randomBytes(16);
        const timerHex = toHex(timerId);
        const timer = {
            id: timerId,
            lifeformId,
            fireAt: Date.now() + delayMs,
            intervalMs,
            payload,
            maxFirings,
            firingCount: 0,
        };
        this.timers.set(timerHex, timer);
        this.scheduleTimer(timer);
        return timerId;
    }
    /**
     * Cancel a timer.
     */
    cancelTimer(timerId) {
        const hex = toHex(timerId);
        const handle = this.timerHandles.get(hex);
        if (handle) {
            clearTimeout(handle);
            this.timerHandles.delete(hex);
        }
        return this.timers.delete(hex);
    }
    /**
     * Cancel all timers for a Lifeform.
     */
    cancelAllTimers(lifeformId) {
        const lfHex = toHex(lifeformId);
        let cancelled = 0;
        for (const [hex, timer] of this.timers) {
            if (toHex(timer.lifeformId) === lfHex) {
                const handle = this.timerHandles.get(hex);
                if (handle)
                    clearTimeout(handle);
                this.timerHandles.delete(hex);
                this.timers.delete(hex);
                cancelled++;
            }
        }
        return cancelled;
    }
    /**
     * Get all active timers for a Lifeform.
     */
    getTimers(lifeformId) {
        const lfHex = toHex(lifeformId);
        return [...this.timers.values()].filter(t => toHex(t.lifeformId) === lfHex);
    }
    // ═══════════════════════════════════════
    // Chain Management
    // ═══════════════════════════════════════
    /**
     * Get a causal chain by ID.
     */
    getChain(chainId) {
        return this.chains.get(toHex(chainId));
    }
    /**
     * Check if backpressure is active for a chain.
     */
    isBackpressured(chainId) {
        const chain = this.chains.get(toHex(chainId));
        return chain?.backpressureActive ?? false;
    }
    /**
     * Clean up expired chains.
     */
    cleanupChains() {
        const cutoff = Date.now() - this.config.chainTtlMs;
        let cleaned = 0;
        for (const [hex, chain] of this.chains) {
            if (chain.startedAt < cutoff) {
                this.chains.delete(hex);
                cleaned++;
            }
        }
        return cleaned;
    }
    /**
     * Get chain statistics.
     */
    getChainStats() {
        let totalDepth = 0;
        let totalCcu = 0;
        let activeCount = 0;
        for (const chain of this.chains.values()) {
            totalDepth += chain.maxDepthReached;
            totalCcu += chain.totalCcuSpent;
            activeCount++;
        }
        return {
            totalChains: this.chainStats.totalChains,
            activeChains: activeCount,
            backpressuredChains: this.chainStats.backpressured,
            deadlineMissedChains: this.chainStats.deadlineMissed,
            avgChainDepth: activeCount > 0 ? totalDepth / activeCount : 0,
            avgChainCcu: activeCount > 0 ? totalCcu / activeCount : 0,
        };
    }
    // ═══════════════════════════════════════
    // Executor Stats
    // ═══════════════════════════════════════
    getStats() {
        return {
            totalExecuted: this.totalExecuted,
            totalCcuSpent: this.totalCcuSpent,
            totalErrors: this.totalErrors,
            activeTimers: this.timers.size,
            activeChains: this.chains.size,
        };
    }
    // ── Internals ──
    scheduleTimer(timer) {
        const hex = toHex(timer.id);
        const delay = Math.max(0, timer.fireAt - Date.now());
        const handle = setTimeout(() => {
            this.fireTimer(timer);
        }, delay);
        this.timerHandles.set(hex, handle);
    }
    fireTimer(timer) {
        if (!this.running)
            return;
        const hex = toHex(timer.id);
        timer.firingCount++;
        // Generate a TIMER cause
        const cause = {
            id: randomBytes(16),
            type: causal_1.CauseType.TIMER,
            chainId: randomBytes(16), // New chain per timer fire
            chainDepth: 0,
            maxChainDepth: this.config.maxChainDepth,
            deadlineMs: 0,
            sourceId: timer.lifeformId,
            sourceType: 'timer',
            targetId: timer.lifeformId,
            payload: timer.payload,
            ccuAttached: 0,
            expectsResponse: false,
            correlationId: null,
            emittedAt: Date.now(),
        };
        if (this.onTimerCause) {
            this.onTimerCause(cause);
        }
        // Schedule next firing if recurring
        if (timer.intervalMs > 0) {
            if (timer.maxFirings === 0 || timer.firingCount < timer.maxFirings) {
                timer.fireAt = Date.now() + timer.intervalMs;
                this.scheduleTimer(timer);
            }
            else {
                // Max firings reached — remove timer
                this.timers.delete(hex);
                this.timerHandles.delete(hex);
            }
        }
        else {
            // One-shot — remove timer
            this.timers.delete(hex);
            this.timerHandles.delete(hex);
        }
    }
    failResult(cause, error) {
        return {
            causeId: cause.id,
            chainId: cause.chainId,
            executionTimeMs: 0,
            stateMutations: 0,
            ccuCost: 0,
            outgoingCauses: [],
            success: false,
            error,
        };
    }
}
exports.CausalExecutor = CausalExecutor;
//# sourceMappingURL=causal-executor.js.map