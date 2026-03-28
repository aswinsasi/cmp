/**
 * CMP v1.3 — Scheduled Task Queue
 * Queues tasks that are scheduled to execute against purchased futures.
 * When the delivery window opens, tasks are dispatched to the seller
 * who committed the resources.
 *
 * @module futures/scheduled-task-queue
 * @author Agent Viscro
 */

import { ComputeFuture, FutureStatus } from '../types/futures';
import { FutureMarket } from './future-market';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface ScheduledTask {
  /** Task identifier */
  taskId: Uint8Array;
  /** Future this task is scheduled against */
  futureId: Uint8Array;
  /** WASM module hash */
  moduleHash: Uint8Array;
  /** Input data */
  inputData: Uint8Array;
  /** Scheduled by (buyer mesh ID) */
  scheduledBy: Uint8Array;
  /** When this task was queued */
  queuedAt: number;
  /** Has this task been dispatched? */
  dispatched: boolean;
  /** Dispatch timestamp */
  dispatchedAt?: number;
}

export class ScheduledTaskQueue {
  /** futureId hex → queued tasks */
  private queue = new Map<string, ScheduledTask[]>();
  private market: FutureMarket;
  private dispatchTimer: ReturnType<typeof setInterval> | null = null;

  /** Callback when a task should be dispatched to the seller */
  private onDispatch: ((task: ScheduledTask, future: ComputeFuture) => void) | null = null;

  constructor(market: FutureMarket) {
    this.market = market;
  }

  /** Register dispatch callback */
  onTaskDispatch(fn: (task: ScheduledTask, future: ComputeFuture) => void): void {
    this.onDispatch = fn;
  }

  /** Start periodic dispatch check */
  start(): void {
    this.dispatchTimer = setInterval(() => this.processQueue(), 5000);
  }

  /** Stop dispatch timer */
  stop(): void {
    if (this.dispatchTimer) {
      clearInterval(this.dispatchTimer);
      this.dispatchTimer = null;
    }
  }

  /**
   * Schedule a task against a purchased future.
   * The task will be dispatched when the future's window opens.
   *
   * @returns true if scheduled successfully
   */
  scheduleTask(
    futureId: Uint8Array,
    taskId: Uint8Array,
    moduleHash: Uint8Array,
    inputData: Uint8Array,
    buyerId: Uint8Array,
  ): boolean {
    const fidHex = toHex(futureId);
    const future = this.market.getFuture(futureId);

    if (!future) return false;
    if (future.status !== FutureStatus.RESERVED && future.status !== FutureStatus.ACTIVE) return false;

    // Verify buyer owns this future
    if (!future.buyerId || toHex(future.buyerId) !== toHex(buyerId)) return false;

    const task: ScheduledTask = {
      taskId,
      futureId,
      moduleHash,
      inputData,
      scheduledBy: buyerId,
      queuedAt: Date.now(),
      dispatched: false,
    };

    if (!this.queue.has(fidHex)) {
      this.queue.set(fidHex, []);
    }
    this.queue.get(fidHex)!.push(task);
    return true;
  }

  /**
   * Get all queued tasks for a future.
   */
  getQueuedTasks(futureId: Uint8Array): ScheduledTask[] {
    return this.queue.get(toHex(futureId)) ?? [];
  }

  /**
   * Get total queued tasks across all futures.
   */
  getTotalQueued(): number {
    let total = 0;
    for (const tasks of this.queue.values()) {
      total += tasks.filter(t => !t.dispatched).length;
    }
    return total;
  }

  /**
   * Process the queue — dispatch tasks whose futures are now ACTIVE.
   */
  processQueue(): void {
    const now = Date.now();

    for (const [fidHex, tasks] of this.queue) {
      const future = this.market.getFuture(this.hexToBytes(fidHex));
      if (!future) continue;

      // Only dispatch during active window
      if (future.status !== FutureStatus.ACTIVE) {
        // Check if window just opened
        if (future.status === FutureStatus.RESERVED && now >= future.windowStart && now < future.windowEnd) {
          // Will be activated by market's processSettlements
          continue;
        }
        continue;
      }

      // Dispatch undispatched tasks
      for (const task of tasks) {
        if (!task.dispatched && this.onDispatch) {
          task.dispatched = true;
          task.dispatchedAt = now;
          this.onDispatch(task, future);
        }
      }
    }
  }

  /**
   * Clear dispatched tasks for a settled/defaulted future.
   */
  clearFuture(futureId: Uint8Array): number {
    const fidHex = toHex(futureId);
    const tasks = this.queue.get(fidHex);
    if (!tasks) return 0;
    const count = tasks.length;
    this.queue.delete(fidHex);
    return count;
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }
}
