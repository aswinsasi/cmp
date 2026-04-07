"use strict";
/**
 * CMP v1.3 — Scheduled Task Queue
 * Queues tasks that are scheduled to execute against purchased futures.
 * When the delivery window opens, tasks are dispatched to the seller
 * who committed the resources.
 *
 * @module futures/scheduled-task-queue
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduledTaskQueue = void 0;
const futures_1 = require("../types/futures");
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
class ScheduledTaskQueue {
    /** futureId hex → queued tasks */
    queue = new Map();
    market;
    dispatchTimer = null;
    /** Callback when a task should be dispatched to the seller */
    onDispatch = null;
    constructor(market) {
        this.market = market;
    }
    /** Register dispatch callback */
    onTaskDispatch(fn) {
        this.onDispatch = fn;
    }
    /** Start periodic dispatch check */
    start() {
        this.dispatchTimer = setInterval(() => this.processQueue(), 5000);
    }
    /** Stop dispatch timer */
    stop() {
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
    scheduleTask(futureId, taskId, moduleHash, inputData, buyerId) {
        const fidHex = toHex(futureId);
        const future = this.market.getFuture(futureId);
        if (!future)
            return false;
        if (future.status !== futures_1.FutureStatus.RESERVED && future.status !== futures_1.FutureStatus.ACTIVE)
            return false;
        // Verify buyer owns this future
        if (!future.buyerId || toHex(future.buyerId) !== toHex(buyerId))
            return false;
        const task = {
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
        this.queue.get(fidHex).push(task);
        return true;
    }
    /**
     * Get all queued tasks for a future.
     */
    getQueuedTasks(futureId) {
        return this.queue.get(toHex(futureId)) ?? [];
    }
    /**
     * Get total queued tasks across all futures.
     */
    getTotalQueued() {
        let total = 0;
        for (const tasks of this.queue.values()) {
            total += tasks.filter(t => !t.dispatched).length;
        }
        return total;
    }
    /**
     * Process the queue — dispatch tasks whose futures are now ACTIVE.
     */
    processQueue() {
        const now = Date.now();
        for (const [fidHex, tasks] of this.queue) {
            const future = this.market.getFuture(this.hexToBytes(fidHex));
            if (!future)
                continue;
            // Only dispatch during active window
            if (future.status !== futures_1.FutureStatus.ACTIVE) {
                // Check if window just opened
                if (future.status === futures_1.FutureStatus.RESERVED && now >= future.windowStart && now < future.windowEnd) {
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
    clearFuture(futureId) {
        const fidHex = toHex(futureId);
        const tasks = this.queue.get(fidHex);
        if (!tasks)
            return 0;
        const count = tasks.length;
        this.queue.delete(fidHex);
        return count;
    }
    hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
    }
}
exports.ScheduledTaskQueue = ScheduledTaskQueue;
//# sourceMappingURL=scheduled-task-queue.js.map