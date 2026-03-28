/**
 * CMP v1.3 — Speculative Distributor
 * Distributes speculative work for DreamScheduler predictions to idle peers.
 * Manages active speculations, handles ACK/RESULT/ABORT lifecycle.
 *
 * All speculative work is "soft-allocated" — can be aborted instantly
 * when a real task arrives and needs the resources.
 *
 * @module precognition/speculative-distributor
 * @author Agent Viscro
 */

import {
  Prediction,
  PredictionSet,
  SpeculativeChunk,
  SpeculativeChunkStatus,
  SpeculativeAbortReason,
} from '../types/precognition';
import { PhantomCache } from './phantom-cache';

// ── Helpers ──

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ── Peer Info for selection ──

export interface IdlePeerInfo {
  meshId: Uint8Array;
  cpuLoad: number;
  acceptingTasks: boolean;
  batteryPct: number;
  thermalThrottled: boolean;
}

export class SpeculativeDistributor {
  private phantomCache: PhantomCache;

  /** predictionId hex → active chunks */
  private activeSpeculations = new Map<string, SpeculativeChunk[]>();

  /** Total speculative CCU spent this cycle */
  private ccuSpentThisCycle = 0;

  /** Send function injected from CMPNode */
  private sendFn: (peerId: Uint8Array, msgType: number, payload: Uint8Array) => Promise<void>;

  /** Get idle peers function injected from CMPNode */
  private getIdlePeersFn: () => IdlePeerInfo[];

  constructor(
    phantomCache: PhantomCache,
    sendFn: (peerId: Uint8Array, msgType: number, payload: Uint8Array) => Promise<void>,
    getIdlePeersFn: () => IdlePeerInfo[],
  ) {
    this.phantomCache = phantomCache;
    this.sendFn = sendFn;
    this.getIdlePeersFn = getIdlePeersFn;
  }

  /**
   * Distribute speculative work for a prediction set.
   *
   * Algorithm:
   * 1. Filter predictions above minimum confidence threshold
   * 2. For each prediction (highest confidence first):
   *    a. Check if result already in PhantomCache → skip
   *    b. Find idle peers (CPU < 15%, accepting tasks, not throttled)
   *    c. Build speculative chunks (soft-allocation)
   *    d. Track in activeSpeculations map
   *    e. Deduct from speculative CCU budget
   *    f. Stop if budget exhausted
   */
  async distributeSpeculative(predictionSet: PredictionSet): Promise<void> {
    this.ccuSpentThisCycle = 0;

    for (const prediction of predictionSet.predictions) {
      if (this.ccuSpentThisCycle >= predictionSet.speculativeBudget) {
        break; // Budget exhausted
      }

      if (prediction.confidence < 0.3) continue; // Too low confidence

      // Check if already cached
      const cacheKey = PhantomCache.generateKey(
        prediction.moduleHash,
        prediction.inputFingerprint,
        String(prediction.taskType),
      );
      if (this.phantomCache.has(cacheKey)) continue;

      // Find idle peers
      const idlePeers = this.getIdlePeersFn().filter(p =>
        p.cpuLoad < 0.15 &&
        p.acceptingTasks &&
        p.batteryPct > 20 &&
        !p.thermalThrottled
      );

      if (idlePeers.length === 0) continue;

      // Select best idle peer (lowest CPU load)
      const selectedPeer = idlePeers.sort((a, b) => a.cpuLoad - b.cpuLoad)[0];

      // Build speculative chunk
      const chunk: SpeculativeChunk = {
        predictionId: prediction.id,
        chunkId: randomBytes(16),
        taskId: randomBytes(16),
        executorId: selectedPeer.meshId,
        status: SpeculativeChunkStatus.QUEUED,
        softAllocation: true,
        startedAt: Date.now(),
      };

      // Track
      const pidHex = toHex(prediction.id);
      if (!this.activeSpeculations.has(pidHex)) {
        this.activeSpeculations.set(pidHex, []);
      }
      this.activeSpeculations.get(pidHex)!.push(chunk);

      // Deduct from budget (1 CCU per speculative chunk — conservative)
      this.ccuSpentThisCycle += 1;

      // Send SPECULATIVE_OFFER (0x80)
      try {
        const payload = this.encodeSpeculativeOffer(prediction, chunk);
        await this.sendFn(selectedPeer.meshId, 0x80, payload);
        chunk.status = SpeculativeChunkStatus.QUEUED;
      } catch {
        chunk.status = SpeculativeChunkStatus.ABORTED;
      }
    }
  }

  /**
   * Handle SPECULATIVE_ACK from peer.
   */
  handleSpeculativeAck(
    peerId: Uint8Array,
    predictionId: Uint8Array,
    chunkId: Uint8Array,
    accepted: boolean,
  ): void {
    const pidHex = toHex(predictionId);
    const cidHex = toHex(chunkId);
    const chunks = this.activeSpeculations.get(pidHex);
    if (!chunks) return;

    const chunk = chunks.find(c => toHex(c.chunkId) === cidHex);
    if (!chunk) return;

    if (accepted) {
      chunk.status = SpeculativeChunkStatus.EXECUTING;
    } else {
      chunk.status = SpeculativeChunkStatus.ABORTED;
    }
  }

  /**
   * Handle SPECULATIVE_RESULT from peer.
   * Stores result in PhantomCache.
   */
  handleSpeculativeResult(
    peerId: Uint8Array,
    predictionId: Uint8Array,
    chunkId: Uint8Array,
    resultHash: Uint8Array,
    resultData: Uint8Array,
    executionTimeMs: number,
  ): void {
    const pidHex = toHex(predictionId);
    const cidHex = toHex(chunkId);
    const chunks = this.activeSpeculations.get(pidHex);
    if (!chunks) return;

    const chunk = chunks.find(c => toHex(c.chunkId) === cidHex);
    if (!chunk) return;

    chunk.status = SpeculativeChunkStatus.COMPLETED;
    chunk.completedAt = Date.now();

    // Find the prediction to get cache key parameters
    // We store moduleHash/inputFingerprint in the chunk's task context
    // For now, use prediction ID as part of the cache key
    const cacheKey = `speculative:${pidHex}`;

    this.phantomCache.store({
      cacheKey,
      resultData,
      resultHash,
      confidence: 0.7, // Default speculative confidence
      ttlMs: 300000, // 5 minutes
      cachedAt: Date.now(),
      predictionId,
      executorIds: [peerId],
      hitCount: 0,
    });
  }

  /**
   * Abort all speculative work for a prediction.
   * Sends SPECULATIVE_ABORT to all executing peers.
   */
  async abortPrediction(predictionId: Uint8Array, reason: SpeculativeAbortReason): Promise<void> {
    const pidHex = toHex(predictionId);
    const chunks = this.activeSpeculations.get(pidHex);
    if (!chunks) return;

    const abortPayload = this.encodeSpeculativeAbort(predictionId, reason);

    for (const chunk of chunks) {
      if (chunk.status === SpeculativeChunkStatus.QUEUED ||
          chunk.status === SpeculativeChunkStatus.EXECUTING) {
        chunk.status = SpeculativeChunkStatus.ABORTED;
        try {
          await this.sendFn(chunk.executorId, 0x83, abortPayload);
        } catch {}
      }
    }

    this.activeSpeculations.delete(pidHex);
  }

  /**
   * Abort ALL speculative work immediately.
   * Called when the device becomes busy with real tasks.
   */
  async abortAll(): Promise<void> {
    for (const [pidHex, chunks] of this.activeSpeculations) {
      const predictionId = this.hexToBytes(pidHex);
      await this.abortPrediction(predictionId, SpeculativeAbortReason.RESOURCE_NEEDED);
    }
    this.activeSpeculations.clear();
  }

  /** Get active speculation count */
  getActiveCount(): number {
    let count = 0;
    for (const chunks of this.activeSpeculations.values()) {
      count += chunks.filter(c =>
        c.status === SpeculativeChunkStatus.QUEUED ||
        c.status === SpeculativeChunkStatus.EXECUTING
      ).length;
    }
    return count;
  }

  /** Get all active speculations (for CLI) */
  getActiveSpeculations(): Map<string, SpeculativeChunk[]> {
    return new Map(this.activeSpeculations);
  }

  /** Get CCU spent this cycle */
  getCcuSpent(): number {
    return this.ccuSpentThisCycle;
  }

  // ── Wire Protocol Encoding ──

  private encodeSpeculativeOffer(prediction: Prediction, chunk: SpeculativeChunk): Uint8Array {
    // Simplified encoding — in production would use proper binary format
    const data = {
      predictionId: Array.from(prediction.id),
      chunkId: Array.from(chunk.chunkId),
      moduleHash: Array.from(prediction.moduleHash),
      taskType: prediction.taskType,
      confidence: prediction.confidence,
    };
    return new TextEncoder().encode(JSON.stringify(data));
  }

  private encodeSpeculativeAbort(predictionId: Uint8Array, reason: SpeculativeAbortReason): Uint8Array {
    const data = {
      predictionId: Array.from(predictionId),
      reason,
    };
    return new TextEncoder().encode(JSON.stringify(data));
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }
}
