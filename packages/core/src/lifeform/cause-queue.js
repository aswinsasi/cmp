"use strict";
/**
 * CMP v1.4 — Cause Queue
 * Priority queue of Causes ordered by deadline (urgent first).
 * Replaces the v1.4-original message inbox with causal-aware queuing.
 *
 * Features:
 *   - Priority ordering: causes with tighter deadlines process first
 *   - Backpressure: rejects causes when queue exceeds capacity
 *   - Rate limiting: enforces maxCausesPerSecond
 *   - Chain depth tracking: detects runaway causal cascades
 *
 * @module lifeform/cause-queue
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CauseQueue = exports.EnqueueResult = void 0;
const DEFAULT_CONFIG = {
    maxSize: 1000,
    maxCausesPerSecond: 100,
    maxChainDepth: 64,
};
var EnqueueResult;
(function (EnqueueResult) {
    /** Successfully enqueued */
    EnqueueResult["OK"] = "ok";
    /** Queue is full — backpressure */
    EnqueueResult["QUEUE_FULL"] = "queue_full";
    /** Rate limit exceeded */
    EnqueueResult["RATE_LIMITED"] = "rate_limited";
    /** Chain depth exceeded — backpressure on cascade */
    EnqueueResult["CHAIN_TOO_DEEP"] = "chain_too_deep";
    /** Deadline already passed */
    EnqueueResult["DEADLINE_EXPIRED"] = "deadline_expired";
})(EnqueueResult || (exports.EnqueueResult = EnqueueResult = {}));
class CauseQueue {
    /** Queue stored as array, sorted by priority on dequeue */
    queue = [];
    config;
    /** Rate limiting: timestamps of recent enqueues */
    recentEnqueues = [];
    /** Stats */
    totalEnqueued = 0;
    totalDequeued = 0;
    totalRejected = 0;
    totalBackpressured = 0;
    /** Callback when a cause is enqueued (wakes the executor) */
    onCauseReady = null;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** Set callback for when a cause is ready to process */
    onReady(fn) {
        this.onCauseReady = fn;
    }
    /**
     * Enqueue a cause.
     * Validates: queue capacity, rate limit, chain depth, deadline.
     */
    enqueue(cause) {
        // Check deadline
        if (cause.deadlineMs > 0 && Date.now() > cause.deadlineMs) {
            this.totalRejected++;
            return EnqueueResult.DEADLINE_EXPIRED;
        }
        // Check chain depth
        if (cause.chainDepth >= this.config.maxChainDepth) {
            this.totalBackpressured++;
            return EnqueueResult.CHAIN_TOO_DEEP;
        }
        // Check queue capacity
        if (this.queue.length >= this.config.maxSize) {
            this.totalBackpressured++;
            return EnqueueResult.QUEUE_FULL;
        }
        // Check rate limit
        const now = Date.now();
        this.recentEnqueues = this.recentEnqueues.filter(t => t > now - 1000);
        if (this.recentEnqueues.length >= this.config.maxCausesPerSecond) {
            this.totalRejected++;
            return EnqueueResult.RATE_LIMITED;
        }
        // Enqueue
        this.queue.push(cause);
        this.recentEnqueues.push(now);
        this.totalEnqueued++;
        // Notify executor
        if (this.onCauseReady) {
            this.onCauseReady();
        }
        return EnqueueResult.OK;
    }
    /**
     * Dequeue the highest-priority cause.
     * Priority: tightest deadline first, then oldest cause.
     * Returns null if queue is empty.
     */
    dequeue() {
        if (this.queue.length === 0)
            return null;
        // Remove expired causes first
        const now = Date.now();
        this.queue = this.queue.filter(c => c.deadlineMs === 0 || c.deadlineMs > now);
        if (this.queue.length === 0)
            return null;
        // Find highest priority: causes with deadlines first (sorted by deadline),
        // then causes without deadlines (sorted by emission time)
        let bestIdx = 0;
        let bestPriority = this.causePriority(this.queue[0]);
        for (let i = 1; i < this.queue.length; i++) {
            const p = this.causePriority(this.queue[i]);
            if (p < bestPriority) {
                bestPriority = p;
                bestIdx = i;
            }
        }
        const cause = this.queue[bestIdx];
        this.queue.splice(bestIdx, 1);
        this.totalDequeued++;
        return cause;
    }
    /**
     * Peek at the next cause without removing it.
     */
    peek() {
        if (this.queue.length === 0)
            return null;
        let bestIdx = 0;
        let bestPriority = this.causePriority(this.queue[0]);
        for (let i = 1; i < this.queue.length; i++) {
            const p = this.causePriority(this.queue[i]);
            if (p < bestPriority) {
                bestPriority = p;
                bestIdx = i;
            }
        }
        return this.queue[bestIdx];
    }
    /**
     * Check if the queue has pending causes.
     */
    get hasPending() {
        return this.queue.length > 0;
    }
    /**
     * Current queue size.
     */
    get size() {
        return this.queue.length;
    }
    /**
     * Drain all causes for a specific chain (for abort/backpressure).
     * Returns the number of causes removed.
     */
    drainChain(chainId) {
        const chainHex = toHex(chainId);
        const before = this.queue.length;
        this.queue = this.queue.filter(c => toHex(c.chainId) !== chainHex);
        return before - this.queue.length;
    }
    /**
     * Get queue statistics.
     */
    getStats() {
        const now = Date.now();
        const recent = this.recentEnqueues.filter(t => t > now - 1000);
        return {
            size: this.queue.length,
            totalEnqueued: this.totalEnqueued,
            totalDequeued: this.totalDequeued,
            totalRejected: this.totalRejected,
            totalBackpressured: this.totalBackpressured,
            currentRate: recent.length,
        };
    }
    /** Clear the queue */
    clear() {
        this.queue = [];
        this.recentEnqueues = [];
    }
    // ── Internals ──
    /**
     * Calculate priority for sorting.
     * Lower number = higher priority.
     */
    causePriority(cause) {
        if (cause.deadlineMs > 0) {
            // Deadline causes: priority = time remaining
            return cause.deadlineMs - Date.now();
        }
        // No deadline: priority = emission time (oldest first)
        return cause.emittedAt + 1e15; // Offset so deadlines always come first
    }
}
exports.CauseQueue = CauseQueue;
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
//# sourceMappingURL=cause-queue.js.map