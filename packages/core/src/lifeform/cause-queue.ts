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

import { Cause, CauseType } from '../types/causal';

export interface CauseQueueConfig {
  /** Maximum queue size (default: 1000) */
  maxSize: number;
  /** Maximum causes per second (default: 100) */
  maxCausesPerSecond: number;
  /** Maximum causal chain depth before backpressure (default: 64) */
  maxChainDepth: number;
}

const DEFAULT_CONFIG: CauseQueueConfig = {
  maxSize: 1000,
  maxCausesPerSecond: 100,
  maxChainDepth: 64,
};

export enum EnqueueResult {
  /** Successfully enqueued */
  OK = 'ok',
  /** Queue is full — backpressure */
  QUEUE_FULL = 'queue_full',
  /** Rate limit exceeded */
  RATE_LIMITED = 'rate_limited',
  /** Chain depth exceeded — backpressure on cascade */
  CHAIN_TOO_DEEP = 'chain_too_deep',
  /** Deadline already passed */
  DEADLINE_EXPIRED = 'deadline_expired',
}

export class CauseQueue {
  /** Queue stored as array, sorted by priority on dequeue */
  private queue: Cause[] = [];
  private config: CauseQueueConfig;

  /** Rate limiting: timestamps of recent enqueues */
  private recentEnqueues: number[] = [];

  /** Stats */
  private totalEnqueued = 0;
  private totalDequeued = 0;
  private totalRejected = 0;
  private totalBackpressured = 0;

  /** Callback when a cause is enqueued (wakes the executor) */
  private onCauseReady: (() => void) | null = null;

  constructor(config?: Partial<CauseQueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Set callback for when a cause is ready to process */
  onReady(fn: () => void): void {
    this.onCauseReady = fn;
  }

  /**
   * Enqueue a cause.
   * Validates: queue capacity, rate limit, chain depth, deadline.
   */
  enqueue(cause: Cause): EnqueueResult {
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
  dequeue(): Cause | null {
    if (this.queue.length === 0) return null;

    // Remove expired causes first
    const now = Date.now();
    this.queue = this.queue.filter(c =>
      c.deadlineMs === 0 || c.deadlineMs > now
    );

    if (this.queue.length === 0) return null;

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
  peek(): Cause | null {
    if (this.queue.length === 0) return null;

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
  get hasPending(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Current queue size.
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Drain all causes for a specific chain (for abort/backpressure).
   * Returns the number of causes removed.
   */
  drainChain(chainId: Uint8Array): number {
    const chainHex = toHex(chainId);
    const before = this.queue.length;
    this.queue = this.queue.filter(c => toHex(c.chainId) !== chainHex);
    return before - this.queue.length;
  }

  /**
   * Get queue statistics.
   */
  getStats(): {
    size: number;
    totalEnqueued: number;
    totalDequeued: number;
    totalRejected: number;
    totalBackpressured: number;
    currentRate: number;
  } {
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
  clear(): void {
    this.queue = [];
    this.recentEnqueues = [];
  }

  // ── Internals ──

  /**
   * Calculate priority for sorting.
   * Lower number = higher priority.
   */
  private causePriority(cause: Cause): number {
    if (cause.deadlineMs > 0) {
      // Deadline causes: priority = time remaining
      return cause.deadlineMs - Date.now();
    }
    // No deadline: priority = emission time (oldest first)
    return cause.emittedAt + 1e15; // Offset so deadlines always come first
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
