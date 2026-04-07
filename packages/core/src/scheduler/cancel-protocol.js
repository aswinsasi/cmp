"use strict";
/**
 * CMP v4.0 — Cancel Protocol
 *
 * Wire protocol for cancelling running tasks on remote devices.
 * Used by the Race Manager to stop losing racers once a winner
 * completes.
 *
 * Message: TASK_CANCEL (0xFF)
 *   Direction: requester → executor
 *   Payload: { taskId, raceId, reason }
 *   Effect: executor stops computation, frees resources, reports partial result
 *
 * @module scheduler/cancel-protocol
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancelTracker = exports.CancelReason = exports.TASK_CANCEL_MSG = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('CancelProto');
// ─── Wire Protocol ───
exports.TASK_CANCEL_MSG = 0xFF;
var CancelReason;
(function (CancelReason) {
    CancelReason["RACE_LOST"] = "race_lost";
    CancelReason["TIMEOUT"] = "timeout";
    CancelReason["USER_CANCEL"] = "user_cancel";
    CancelReason["REBALANCE"] = "rebalance";
})(CancelReason || (exports.CancelReason = CancelReason = {}));
// ─── Cancel Tracker ───
/**
 * Tracks pending cancellations and their acknowledgements.
 */
class CancelTracker {
    /** Pending cancellations awaiting ack: raceId:taskId → CancelRequest */
    pending = new Map();
    /** Received acks: raceId:taskId → CancelAck */
    acks = new Map();
    /** Send function */
    sendFn = null;
    /**
     * Set the send function for transmitting cancel messages.
     */
    setTransport(sendFn) {
        this.sendFn = sendFn;
    }
    /**
     * Send a TASK_CANCEL to a device.
     */
    cancel(deviceId, taskId, raceId, reason) {
        const request = {
            taskId,
            raceId,
            reason,
            timestamp: Date.now(),
        };
        const key = `${raceId}:${taskId}`;
        this.pending.set(key, request);
        if (this.sendFn) {
            const wire = {
                taskId: request.taskId,
                raceId: request.raceId,
                reason: request.reason,
                ts: request.timestamp,
            };
            this.sendFn(deviceId, exports.TASK_CANCEL_MSG, wire);
            log.info(`TASK_CANCEL sent to ${deviceId}: task=${taskId}, race=${raceId}, reason=${reason}`);
        }
    }
    /**
     * Cancel all tasks in a race except the winner.
     */
    cancelLosers(raceId, winnerDeviceId, racers) {
        let cancelled = 0;
        for (const racer of racers) {
            if (racer.deviceId !== winnerDeviceId) {
                this.cancel(racer.deviceId, racer.taskId, raceId, CancelReason.RACE_LOST);
                cancelled++;
            }
        }
        return cancelled;
    }
    /**
     * Handle a cancel acknowledgement from a device.
     */
    handleAck(wire) {
        const ack = {
            taskId: wire.taskId,
            raceId: wire.raceId,
            deviceId: wire.deviceId,
            stopped: wire.stopped,
            partialResultBytes: wire.partialBytes,
            computeTimeMs: wire.computeMs,
        };
        const key = `${wire.raceId}:${wire.taskId}`;
        this.acks.set(key, ack);
        this.pending.delete(key);
        log.info(`Cancel ack from ${wire.deviceId}: task=${wire.taskId}, ` +
            `stopped=${wire.stopped}, partial=${wire.partialBytes}B, compute=${wire.computeMs}ms`);
    }
    /**
     * Check if all cancellations for a race have been acknowledged.
     */
    allAcked(raceId) {
        for (const [key] of this.pending) {
            if (key.startsWith(`${raceId}:`))
                return false;
        }
        return true;
    }
    /**
     * Get pending cancellations count.
     */
    get pendingCount() {
        return this.pending.size;
    }
    /**
     * Clear all tracking data for a race.
     */
    clearRace(raceId) {
        for (const key of [...this.pending.keys()]) {
            if (key.startsWith(`${raceId}:`))
                this.pending.delete(key);
        }
        for (const key of [...this.acks.keys()]) {
            if (key.startsWith(`${raceId}:`))
                this.acks.delete(key);
        }
    }
}
exports.CancelTracker = CancelTracker;
//# sourceMappingURL=cancel-protocol.js.map