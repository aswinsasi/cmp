/**
 * CMP v1.3 — Confirmation Shortcut
 * Inserted into the task submission pipeline between Layer 2 and Layer 3.
 * Intercepts task requests and checks PhantomCache before entering negotiation.
 *
 * On cache HIT: skip L3→L5, return cached result directly (near-zero latency).
 * On cache MISS: fall through to normal negotiation pipeline.
 *
 * @module precognition/confirmation-shortcut
 * @author Agent Viscro
 */

import { PhantomCache } from './phantom-cache';
import { DreamScheduler } from './dream-scheduler';
import { MispredictionTracker } from './misprediction-tracker';
import { TaskType } from '../types/task';

export interface ShortcutResult {
  data: Uint8Array;
  fromCache: true;
  predictionId: Uint8Array;
  confidence: number;
}

export interface ConfirmationShortcutConfig {
  /** Minimum confidence to accept a cached result (default: 0.6) */
  minConfidenceForHit: number;
  /** How long to wait for in-flight speculation to complete (ms, default: 500) */
  inflightWaitMs: number;
  /** Enable shortcut (can be disabled globally) */
  enabled: boolean;
}

const DEFAULT_CONFIG: ConfirmationShortcutConfig = {
  minConfidenceForHit: 0.6,
  inflightWaitMs: 500,
  enabled: true,
};

export class ConfirmationShortcut {
  private phantomCache: PhantomCache;
  private dreamScheduler: DreamScheduler;
  private mispredictionTracker: MispredictionTracker;
  private config: ConfirmationShortcutConfig;

  constructor(
    phantomCache: PhantomCache,
    dreamScheduler: DreamScheduler,
    mispredictionTracker: MispredictionTracker,
    config?: Partial<ConfirmationShortcutConfig>,
  ) {
    this.phantomCache = phantomCache;
    this.dreamScheduler = dreamScheduler;
    this.mispredictionTracker = mispredictionTracker;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Attempt to shortcut the pipeline.
   *
   * Called by CMPNode.compute() BEFORE entering NegotiationEngine.
   *
   * Steps:
   * 1. Generate input fingerprint: hash of inputData
   * 2. Look up PhantomCache by (moduleHash, inputFingerprint, taskType)
   * 3. If HIT and confidence >= threshold:
   *    a. Record hit in MispredictionTracker
   *    b. Return cached result directly (skip L3 → L5)
   * 4. If MISS:
   *    a. Check if DreamScheduler has a matching prediction
   *    b. If prediction exists but result not cached yet → wait briefly
   *    c. Record miss in MispredictionTracker
   *    d. Return null → CMPNode proceeds with normal negotiation
   *
   * @returns Cached result or null if cache miss
   */
  async tryShortcut(
    taskType: TaskType,
    moduleHash: Uint8Array,
    inputData: Uint8Array,
  ): Promise<ShortcutResult | null> {
    if (!this.config.enabled) return null;

    const inputFingerprint = PhantomCache.fingerprint(inputData);
    const taskTypeStr = String(taskType);

    // Step 1: Direct cache lookup
    const cached = this.phantomCache.lookupByTask(moduleHash, inputFingerprint, taskTypeStr);

    if (cached && cached.confidence >= this.config.minConfidenceForHit) {
      // Cache HIT — record and return
      this.mispredictionTracker.recordHit(
        this.findPredictionPattern(cached.predictionId) ?? 'payload_similarity' as any,
        1, // CCU saved (estimated)
      );

      return {
        data: cached.resultData,
        fromCache: true,
        predictionId: cached.predictionId,
        confidence: cached.confidence,
      };
    }

    // Step 2: Check if DreamScheduler has a matching prediction in flight
    const matchingPrediction = this.dreamScheduler.matchRealTask(
      taskType, moduleHash, inputFingerprint,
    );

    if (matchingPrediction) {
      // A prediction matches but the result isn't cached yet.
      // Wait briefly for the in-flight speculation to complete.
      const result = await this.waitForInflight(moduleHash, inputFingerprint, taskTypeStr);
      if (result) {
        this.mispredictionTracker.recordHit(matchingPrediction.patternType, 1);
        return {
          data: result.resultData,
          fromCache: true,
          predictionId: matchingPrediction.id,
          confidence: result.confidence,
        };
      }
    }

    // Cache MISS — fall through to normal pipeline
    return null;
  }

  /**
   * Wait briefly for an in-flight speculation to complete and populate the cache.
   */
  private async waitForInflight(
    moduleHash: Uint8Array,
    inputFingerprint: Uint8Array,
    taskTypeStr: string,
  ): Promise<{ resultData: Uint8Array; confidence: number } | null> {
    const deadline = Date.now() + this.config.inflightWaitMs;
    const checkInterval = 50; // Check every 50ms

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, checkInterval));

      const cached = this.phantomCache.lookupByTask(moduleHash, inputFingerprint, taskTypeStr);
      if (cached && cached.confidence >= this.config.minConfidenceForHit) {
        return { resultData: cached.resultData, confidence: cached.confidence };
      }
    }

    return null;
  }

  /**
   * Find the pattern type for a given prediction ID.
   */
  private findPredictionPattern(predictionId: Uint8Array): string | null {
    const ps = this.dreamScheduler.getCurrentPredictions();
    if (!ps) return null;

    const pidHex = Array.from(predictionId).map(b => b.toString(16).padStart(2, '0')).join('');
    for (const pred of ps.predictions) {
      const predHex = Array.from(pred.id).map(b => b.toString(16).padStart(2, '0')).join('');
      if (predHex === pidHex) return pred.patternType;
    }
    return null;
  }
}
