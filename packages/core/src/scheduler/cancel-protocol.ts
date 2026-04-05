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

import { Logger } from '../utils/logger';

const log = new Logger('CancelProto');

// ─── Wire Protocol ───

export const TASK_CANCEL_MSG = 0xFF;

// ─── Cancel Request ───

export interface CancelRequest {
  /** The task/chunk ID to cancel */
  taskId: string;
  /** The race this cancellation belongs to */
  raceId: string;
  /** Why the task was cancelled */
  reason: CancelReason;
  /** Timestamp of cancellation */
  timestamp: number;
}

export enum CancelReason {
  RACE_LOST    = 'race_lost',     // Another racer finished first
  TIMEOUT      = 'timeout',       // Exceeded deadline
  USER_CANCEL  = 'user_cancel',   // User requested cancellation
  REBALANCE    = 'rebalance',     // Task migrated to another device
}

// ─── Cancel Wire Format ───

export interface CancelWire {
  taskId: string;
  raceId: string;
  reason: string;
  ts: number;
}

// ─── Cancel Acknowledgement ───

export interface CancelAck {
  taskId: string;
  raceId: string;
  deviceId: string;
  /** Whether the device successfully stopped */
  stopped: boolean;
  /** Partial result (if any computation was done) */
  partialResultBytes: number;
  /** How long the device was computing before cancel (ms) */
  computeTimeMs: number;
}

export interface CancelAckWire {
  taskId: string;
  raceId: string;
  deviceId: string;
  stopped: boolean;
  partialBytes: number;
  computeMs: number;
}

// ─── Cancel Tracker ───

/**
 * Tracks pending cancellations and their acknowledgements.
 */
export class CancelTracker {
  /** Pending cancellations awaiting ack: raceId:taskId → CancelRequest */
  private pending = new Map<string, CancelRequest>();
  /** Received acks: raceId:taskId → CancelAck */
  private acks = new Map<string, CancelAck>();
  /** Send function */
  private sendFn: ((deviceId: string, msgType: number, payload: any) => void) | null = null;

  /**
   * Set the send function for transmitting cancel messages.
   */
  setTransport(sendFn: (deviceId: string, msgType: number, payload: any) => void): void {
    this.sendFn = sendFn;
  }

  /**
   * Send a TASK_CANCEL to a device.
   */
  cancel(deviceId: string, taskId: string, raceId: string, reason: CancelReason): void {
    const request: CancelRequest = {
      taskId,
      raceId,
      reason,
      timestamp: Date.now(),
    };

    const key = `${raceId}:${taskId}`;
    this.pending.set(key, request);

    if (this.sendFn) {
      const wire: CancelWire = {
        taskId: request.taskId,
        raceId: request.raceId,
        reason: request.reason,
        ts: request.timestamp,
      };
      this.sendFn(deviceId, TASK_CANCEL_MSG, wire);
      log.info(`TASK_CANCEL sent to ${deviceId}: task=${taskId}, race=${raceId}, reason=${reason}`);
    }
  }

  /**
   * Cancel all tasks in a race except the winner.
   */
  cancelLosers(
    raceId: string,
    winnerDeviceId: string,
    racers: Array<{ deviceId: string; taskId: string }>,
  ): number {
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
  handleAck(wire: CancelAckWire): void {
    const ack: CancelAck = {
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

    log.info(
      `Cancel ack from ${wire.deviceId}: task=${wire.taskId}, ` +
      `stopped=${wire.stopped}, partial=${wire.partialBytes}B, compute=${wire.computeMs}ms`
    );
  }

  /**
   * Check if all cancellations for a race have been acknowledged.
   */
  allAcked(raceId: string): boolean {
    for (const [key] of this.pending) {
      if (key.startsWith(`${raceId}:`)) return false;
    }
    return true;
  }

  /**
   * Get pending cancellations count.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Clear all tracking data for a race.
   */
  clearRace(raceId: string): void {
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(`${raceId}:`)) this.pending.delete(key);
    }
    for (const key of [...this.acks.keys()]) {
      if (key.startsWith(`${raceId}:`)) this.acks.delete(key);
    }
  }
}
