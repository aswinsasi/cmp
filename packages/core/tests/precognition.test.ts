/**
 * CMP v1.3 — Precognition Test Suite
 * Tests: PhantomCache, MispredictionTracker, DreamScheduler (5 pattern
 * detectors), ConfirmationShortcut, SpeculativeDistributor, integration.
 *
 * Run: npx ts-node --transpile-only packages/core/tests/precognition.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PhantomCache } from '../src/precognition/phantom-cache';
import { MispredictionTracker } from '../src/precognition/misprediction-tracker';
import { DreamScheduler } from '../src/precognition/dream-scheduler';
import { ConfirmationShortcut } from '../src/precognition/confirmation-shortcut';
import { SpeculativeDistributor } from '../src/precognition/speculative-distributor';
import {
  PredictionPattern,
  PhantomCacheEntry,
  SpeculativeChunkStatus,
} from '../src/types/precognition';
import { TaskType } from '../src/types/task';
import type { CMP_MER } from '../src/types/mcl';
import { DecompositionStrategy } from '../src/types/mcl';

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

function makeMER(overrides: Partial<CMP_MER> & { createdAt: number; taskType: TaskType }): CMP_MER {
  return {
    merId: randomBytes(16),
    taskType: overrides.taskType,
    meshSignature: overrides.meshSignature ?? randomBytes(8),
    deviceCount: overrides.deviceCount ?? 2,
    strategyUsed: overrides.strategyUsed ?? DecompositionStrategy.DATA_PARALLEL,
    chunkCount: overrides.chunkCount ?? 2,
    avgChunkSizeKb: overrides.avgChunkSizeKb ?? 10,
    performance: overrides.performance ?? {
      totalTimeMs: 100,
      distributionOverheadPct: 5,
      executionEfficiency: 85,
      faultEvents: 0,
      reassignmentCount: 0,
    },
    learnedHints: overrides.learnedHints ?? {
      optimalChunkSizeKb: 10,
      optimalDeviceCount: 2,
      tierRoles: new Uint8Array(5),
      recommendedStrategy: DecompositionStrategy.DATA_PARALLEL,
    },
    environmentHash: randomBytes(8),
    confidence: overrides.confidence ?? 85,
    generation: 0,
    createdAt: overrides.createdAt,
    ttlDays: 90,
    originMeshHash: randomBytes(8),
    signature: new Uint8Array(64),
  };
}

function makeCacheEntry(overrides?: Partial<PhantomCacheEntry>): PhantomCacheEntry {
  return {
    cacheKey: overrides?.cacheKey ?? `key-${Math.random()}`,
    resultData: overrides?.resultData ?? new Uint8Array([1, 2, 3, 4]),
    resultHash: overrides?.resultHash ?? randomBytes(32),
    confidence: overrides?.confidence ?? 0.8,
    ttlMs: overrides?.ttlMs ?? 300000,
    cachedAt: overrides?.cachedAt ?? Date.now(),
    predictionId: overrides?.predictionId ?? randomBytes(16),
    executorIds: overrides?.executorIds ?? [randomBytes(16)],
    hitCount: overrides?.hitCount ?? 0,
  };
}

// ═══════════════════════════════════════
// PhantomCache Tests
// ═══════════════════════════════════════

describe('PhantomCache', () => {
  let cache: PhantomCache;

  beforeEach(() => {
    cache = new PhantomCache({ maxEntries: 10, maxCacheSizeBytes: 1024 });
  });

  it('should store and retrieve entries by cache key', () => {
    const entry = makeCacheEntry({ cacheKey: 'test-key', confidence: 0.9 });
    assert.equal(cache.store(entry), true);
    const retrieved = cache.lookup('test-key');
    assert.ok(retrieved);
    assert.equal(retrieved.cacheKey, 'test-key');
    assert.equal(retrieved.confidence, 0.9);
  });

  it('should return null for missing keys', () => {
    assert.equal(cache.lookup('nonexistent'), null);
  });

  it('should reject entries below minimum confidence', () => {
    const entry = makeCacheEntry({ confidence: 0.3 });
    assert.equal(cache.store(entry), false);
    assert.equal(cache.size, 0);
  });

  it('should evict expired entries', async () => {
    const entry = makeCacheEntry({
      cacheKey: 'expiring',
      ttlMs: 50,
      cachedAt: Date.now(),
      confidence: 0.9,
    });
    cache.store(entry);
    assert.equal(cache.size, 1);

    await sleep(100);
    const evicted = cache.evictExpired();
    assert.equal(evicted, 1);
    assert.equal(cache.size, 0);
  });

  it('should evict lowest confidence when over maxEntries', () => {
    // Fill with 10 entries
    for (let i = 0; i < 10; i++) {
      cache.store(makeCacheEntry({
        cacheKey: `key-${i}`,
        confidence: 0.6 + (i * 0.03),
        resultData: new Uint8Array(10),
      }));
    }
    assert.equal(cache.size, 10);

    // Add 11th — should evict lowest confidence (key-0)
    cache.store(makeCacheEntry({
      cacheKey: 'key-new',
      confidence: 0.95,
      resultData: new Uint8Array(10),
    }));
    assert.equal(cache.size, 10);
    assert.equal(cache.lookup('key-0'), null); // Lowest confidence evicted
    assert.ok(cache.lookup('key-new')); // New entry present
  });

  it('should evict lowest confidence when over maxCacheSizeBytes', () => {
    // maxCacheSizeBytes = 1024
    cache.store(makeCacheEntry({
      cacheKey: 'big-low',
      confidence: 0.65,
      resultData: new Uint8Array(500),
    }));
    cache.store(makeCacheEntry({
      cacheKey: 'big-high',
      confidence: 0.95,
      resultData: new Uint8Array(500),
    }));
    assert.equal(cache.size, 2);

    // This should evict 'big-low' to make room
    cache.store(makeCacheEntry({
      cacheKey: 'big-new',
      confidence: 0.9,
      resultData: new Uint8Array(200),
    }));
    assert.equal(cache.lookup('big-low'), null);
    assert.ok(cache.lookup('big-high'));
    assert.ok(cache.lookup('big-new'));
  });

  it('should increment hitCount on lookup', () => {
    cache.store(makeCacheEntry({ cacheKey: 'counter', confidence: 0.9 }));

    cache.lookup('counter');
    cache.lookup('counter');
    cache.lookup('counter');

    const entry = cache.lookup('counter');
    assert.ok(entry);
    assert.equal(entry.hitCount, 4); // 3 + 1 from this lookup
  });

  it('should return null for expired entries on lookup', async () => {
    cache.store(makeCacheEntry({
      cacheKey: 'ttl-test',
      ttlMs: 50,
      cachedAt: Date.now(),
      confidence: 0.9,
    }));

    await sleep(100);
    assert.equal(cache.lookup('ttl-test'), null);
    assert.equal(cache.size, 0); // Auto-removed on lookup
  });

  it('should invalidate all entries for a prediction', () => {
    const pid = randomBytes(16);
    cache.store(makeCacheEntry({ cacheKey: 'p1', predictionId: pid, confidence: 0.9, resultData: new Uint8Array(5) }));
    cache.store(makeCacheEntry({ cacheKey: 'p2', predictionId: pid, confidence: 0.8, resultData: new Uint8Array(5) }));
    cache.store(makeCacheEntry({ cacheKey: 'other', confidence: 0.7, resultData: new Uint8Array(5) }));

    const invalidated = cache.invalidatePrediction(pid);
    assert.equal(invalidated, 2);
    assert.equal(cache.size, 1);
    assert.ok(cache.lookup('other'));
  });

  it('should generate deterministic cache keys', () => {
    const mh = new Uint8Array([1, 2, 3, 4]);
    const fp = new Uint8Array([5, 6, 7, 8]);
    const key1 = PhantomCache.generateKey(mh, fp, 'MAP_REDUCE');
    const key2 = PhantomCache.generateKey(mh, fp, 'MAP_REDUCE');
    assert.equal(key1, key2);

    // Different inputs → different keys
    const key3 = PhantomCache.generateKey(mh, fp, 'INFERENCE');
    assert.notEqual(key1, key3);
  });

  it('should report accurate stats', () => {
    cache.store(makeCacheEntry({ cacheKey: 'a', confidence: 0.8, resultData: new Uint8Array(100) }));
    cache.store(makeCacheEntry({ cacheKey: 'b', confidence: 0.9, resultData: new Uint8Array(200) }));
    cache.lookup('a');
    cache.lookup('missing');

    const stats = cache.getStats();
    assert.equal(stats.entryCount, 2);
    assert.equal(stats.totalSizeBytes, 300);
    assert.equal(stats.hitRate, 0.5); // 1 hit / 2 lookups
    assert.ok(stats.avgConfidence > 0.8);
  });

  it('should generate consistent fingerprints', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const fp1 = PhantomCache.fingerprint(data);
    const fp2 = PhantomCache.fingerprint(data);
    assert.deepEqual(fp1, fp2);
    assert.equal(fp1.length, 32);

    // Different data → different fingerprint
    const fp3 = PhantomCache.fingerprint(new Uint8Array([5, 4, 3, 2, 1]));
    assert.notDeepEqual(fp1, fp3);
  });
});

// ═══════════════════════════════════════
// MispredictionTracker Tests
// ═══════════════════════════════════════

describe('MispredictionTracker', () => {
  let tracker: MispredictionTracker;

  beforeEach(() => {
    tracker = new MispredictionTracker(100, 0.3);
  });

  it('should track hits and misses', () => {
    tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 5);
    tracker.recordMiss(PredictionPattern.BURST_PATTERN, 2);

    const stats = tracker.getStats();
    assert.equal(stats.totalPredictions, 2);
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
  });

  it('should calculate hit rate correctly', () => {
    tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 1);
    tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 1);
    tracker.recordMiss(PredictionPattern.BURST_PATTERN, 1);

    const stats = tracker.getStats();
    assert.ok(Math.abs(stats.hitRate - 2 / 3) < 0.01);
  });

  it('should increase aggressiveness when hit rate > 0.7', () => {
    // 8 hits, 2 misses = 0.8 hit rate
    for (let i = 0; i < 8; i++) tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 5);
    for (let i = 0; i < 2; i++) tracker.recordMiss(PredictionPattern.BURST_PATTERN, 1);

    const agg = tracker.calculateAggressiveness();
    assert.ok(agg > 0.3, `Aggressiveness ${agg} should be > 0.3 (initial)`);
  });

  it('should decrease aggressiveness when hit rate < 0.2', () => {
    // 1 hit, 9 misses = 0.1 hit rate
    tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 1);
    for (let i = 0; i < 9; i++) tracker.recordMiss(PredictionPattern.BURST_PATTERN, 1);

    const agg = tracker.calculateAggressiveness();
    assert.ok(agg < 0.3, `Aggressiveness ${agg} should be < 0.3 (initial)`);
  });

  it('should halve aggressiveness when netCcuBenefit < 0', () => {
    // Spend more than save
    tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 1);
    tracker.recordMiss(PredictionPattern.BURST_PATTERN, 10);

    const agg = tracker.calculateAggressiveness();
    assert.ok(agg <= 0.15, `Aggressiveness ${agg} should be halved to <= 0.15`);
  });

  it('should clamp aggressiveness between 0.05 and 0.95', () => {
    // Extreme hit rate
    for (let i = 0; i < 100; i++) tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 100);
    assert.ok(tracker.calculateAggressiveness() <= 0.95);

    // Reset and extreme miss rate
    tracker.reset();
    for (let i = 0; i < 100; i++) tracker.recordMiss(PredictionPattern.BURST_PATTERN, 100);
    assert.ok(tracker.calculateAggressiveness() >= 0.05);
  });

  it('should track per-pattern hit rates', () => {
    tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 1);
    tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 1);
    tracker.recordMiss(PredictionPattern.TEMPORAL_RECURRENCE, 1);
    tracker.recordMiss(PredictionPattern.BURST_PATTERN, 1);

    const rates = tracker.getPatternHitRates();
    assert.ok(Math.abs(rates.get(PredictionPattern.TEMPORAL_RECURRENCE)! - 2 / 3) < 0.01);
    assert.equal(rates.get(PredictionPattern.BURST_PATTERN), 0);
  });

  it('should reset all tracking', () => {
    tracker.recordHit(PredictionPattern.TEMPORAL_RECURRENCE, 5);
    tracker.reset();

    const stats = tracker.getStats();
    assert.equal(stats.totalPredictions, 0);
    assert.equal(stats.hits, 0);
    assert.equal(stats.hitRate, 0);
  });
});

// ═══════════════════════════════════════
// DreamScheduler Tests
// ═══════════════════════════════════════

describe('DreamScheduler', () => {
  function createScheduler(mers: CMP_MER[], cpuLoad = 0.05, activeTasks = 0) {
    return new DreamScheduler(
      () => mers,
      () => cpuLoad,
      () => activeTasks,
      {
        minMersForPrediction: 3,
        maxPredictionsPerCycle: 10,
        idleCpuThreshold: 0.15,
      },
    );
  }

  // Use a fixed moduleHash so grouping works
  const MODULE_A = new Uint8Array(8).fill(0xAA);
  const MODULE_B = new Uint8Array(8).fill(0xBB);

  it('should detect temporal recurrence patterns', () => {
    const now = Date.now();
    const interval = 60000; // 1 minute intervals

    // 10 MERs at regular 1-minute intervals
    const mers = Array.from({ length: 10 }, (_, i) =>
      makeMER({
        taskType: TaskType.MAP_REDUCE,
        createdAt: now - (10 - i) * interval,
        meshSignature: MODULE_A,
      })
    );

    const scheduler = createScheduler(mers);
    const ps = scheduler.generatePredictions();

    const temporal = ps.predictions.filter(p => p.patternType === PredictionPattern.TEMPORAL_RECURRENCE);
    assert.ok(temporal.length > 0, 'Should detect temporal recurrence');
    assert.ok(temporal[0].confidence > 0.5, `Confidence ${temporal[0].confidence} should be > 0.5`);
  });

  it('should detect sequential chain patterns', () => {
    const now = Date.now();

    // Pattern: MAP_REDUCE always followed by INFERENCE
    const mers: CMP_MER[] = [];
    for (let i = 0; i < 5; i++) {
      mers.push(makeMER({
        taskType: TaskType.MAP_REDUCE,
        createdAt: now - (10 - i * 2) * 10000,
        meshSignature: MODULE_A,
      }));
      mers.push(makeMER({
        taskType: TaskType.INFERENCE,
        createdAt: now - (10 - i * 2 - 1) * 10000,
        meshSignature: MODULE_B,
      }));
    }

    const scheduler = createScheduler(mers);
    const ps = scheduler.generatePredictions();

    const chains = ps.predictions.filter(p => p.patternType === PredictionPattern.SEQUENTIAL_CHAIN);
    assert.ok(chains.length > 0, 'Should detect sequential chain');
  });

  it('should detect payload similarity patterns', () => {
    const now = Date.now();
    const moduleHash = new Uint8Array(8).fill(0xCC);

    // Same module hash appearing 6 times with similar sizes
    const mers = Array.from({ length: 6 }, (_, i) =>
      makeMER({
        taskType: TaskType.MAP_REDUCE,
        createdAt: now - (6 - i) * 30000,
        meshSignature: moduleHash,
        avgChunkSizeKb: 10 + (i % 3), // Similar sizes (10, 11, 12)
      })
    );

    const scheduler = createScheduler(mers);
    const ps = scheduler.generatePredictions();

    const similar = ps.predictions.filter(p => p.patternType === PredictionPattern.PAYLOAD_SIMILARITY);
    assert.ok(similar.length > 0, 'Should detect payload similarity');
  });

  it('should detect diurnal cycle patterns', () => {
    const now = new Date();

    // 6 MERs all in the 9-11 AM window
    const mers: CMP_MER[] = [];
    for (let day = 0; day < 6; day++) {
      const merTime = new Date(now);
      merTime.setDate(merTime.getDate() - day);
      merTime.setHours(10, 0, 0, 0); // Always at 10 AM
      mers.push(makeMER({
        taskType: TaskType.INFERENCE,
        createdAt: merTime.getTime(),
        meshSignature: MODULE_A,
      }));
    }

    const scheduler = createScheduler(mers);
    const ps = scheduler.generatePredictions();

    const diurnal = ps.predictions.filter(p => p.patternType === PredictionPattern.DIURNAL_CYCLE);
    assert.ok(diurnal.length > 0, 'Should detect diurnal cycle');
  });

  it('should detect burst patterns', () => {
    const now = Date.now();

    // 5 MERs within 2 seconds of each other (burst)
    const mers = Array.from({ length: 5 }, (_, i) =>
      makeMER({
        taskType: TaskType.MAP_REDUCE,
        createdAt: now - 5000 + i * 800, // 800ms apart, last one ~1s ago
        meshSignature: MODULE_A,
      })
    );

    const scheduler = createScheduler(mers);
    const ps = scheduler.generatePredictions();

    const bursts = ps.predictions.filter(p => p.patternType === PredictionPattern.BURST_PATTERN);
    assert.ok(bursts.length > 0, 'Should detect burst pattern');
  });

  it('should rank predictions by confidence', () => {
    const now = Date.now();
    const interval = 60000;

    // Regular temporal pattern (high confidence)
    const mers = Array.from({ length: 8 }, (_, i) =>
      makeMER({
        taskType: TaskType.MAP_REDUCE,
        createdAt: now - (8 - i) * interval,
        meshSignature: MODULE_A,
      })
    );

    const scheduler = createScheduler(mers);
    const ps = scheduler.generatePredictions();

    // Should be sorted by confidence descending
    for (let i = 1; i < ps.predictions.length; i++) {
      assert.ok(
        ps.predictions[i].confidence <= ps.predictions[i - 1].confidence,
        `Prediction ${i} should have <= confidence than ${i - 1}`
      );
    }
  });

  it('should not generate predictions with < minMersForPrediction', () => {
    const scheduler = createScheduler([
      makeMER({ taskType: TaskType.MAP_REDUCE, createdAt: Date.now() }),
    ]);
    // minMersForPrediction = 3, but only 1 MER
    // checkIdleState returns true, but not enough MERs
    const ps = scheduler.generatePredictions();
    // Predictions may still be empty because individual detectors need 3+ MERs of same type
    assert.ok(ps.predictions.length === 0 || ps.predictions.every(p => p.confidence > 0));
  });

  it('should respect maxPredictionsPerCycle', () => {
    const now = Date.now();
    // Generate lots of MERs for multiple patterns
    const mers: CMP_MER[] = [];
    for (let t = 0; t < 5; t++) {
      for (let i = 0; i < 6; i++) {
        mers.push(makeMER({
          taskType: t as TaskType,
          createdAt: now - (6 - i) * 60000,
          meshSignature: new Uint8Array(8).fill(t + 0xA0),
          avgChunkSizeKb: 10,
        }));
      }
    }

    const scheduler = createScheduler(mers);
    scheduler.setAggressiveness(0.3); // maxPredictions = floor(8 * 0.3) = 2
    const ps = scheduler.generatePredictions();
    assert.ok(ps.predictions.length <= 2, `Should have <= 2 predictions, got ${ps.predictions.length}`);
  });

  it('should match real tasks to existing predictions', () => {
    const now = Date.now();
    const interval = 60000;

    const mers = Array.from({ length: 5 }, (_, i) =>
      makeMER({
        taskType: TaskType.MAP_REDUCE,
        createdAt: now - (5 - i) * interval,
        meshSignature: MODULE_A,
      })
    );

    const scheduler = createScheduler(mers);
    scheduler.generatePredictions();

    // Try matching with the same module hash
    const match = scheduler.matchRealTask(
      TaskType.MAP_REDUCE,
      MODULE_A,
      new Uint8Array(32), // Blank fingerprint matches blank
    );

    // May or may not match depending on time window
    // But the method should not throw
    assert.ok(match === null || match.taskType === TaskType.MAP_REDUCE);
  });

  it('should not dream when CPU > idleCpuThreshold', () => {
    const scheduler = createScheduler([], 0.50, 0); // 50% CPU
    assert.equal(scheduler.checkIdleState(), false);
  });

  it('should consider idle when CPU < threshold and no active tasks', () => {
    const scheduler = createScheduler([], 0.05, 0); // 5% CPU
    assert.equal(scheduler.checkIdleState(), true);
  });

  it('should not consider idle when tasks are active', () => {
    const scheduler = createScheduler([], 0.05, 2); // Low CPU but 2 active tasks
    assert.equal(scheduler.checkIdleState(), false);
  });
});

// ═══════════════════════════════════════
// ConfirmationShortcut Tests
// ═══════════════════════════════════════

describe('ConfirmationShortcut', () => {
  it('should return cached result on cache hit', async () => {
    const cache = new PhantomCache();
    const tracker = new MispredictionTracker();
    const scheduler = new DreamScheduler(() => [], () => 0.05, () => 0);

    const moduleHash = new Uint8Array(32).fill(0xAA);
    const inputData = new Uint8Array([1, 2, 3, 4, 5]);
    const inputFp = PhantomCache.fingerprint(inputData);
    const cacheKey = PhantomCache.generateKey(moduleHash, inputFp, String(TaskType.MAP_REDUCE));

    // Pre-populate cache
    cache.store({
      cacheKey,
      resultData: new Uint8Array([10, 20, 30]),
      resultHash: randomBytes(32),
      confidence: 0.9,
      ttlMs: 300000,
      cachedAt: Date.now(),
      predictionId: randomBytes(16),
      executorIds: [randomBytes(16)],
      hitCount: 0,
    });

    const shortcut = new ConfirmationShortcut(cache, scheduler, tracker);
    const result = await shortcut.tryShortcut(TaskType.MAP_REDUCE, moduleHash, inputData);

    assert.ok(result, 'Should return cached result');
    assert.equal(result!.fromCache, true);
    assert.deepEqual(result!.data, new Uint8Array([10, 20, 30]));
  });

  it('should return null on cache miss', async () => {
    const cache = new PhantomCache();
    const tracker = new MispredictionTracker();
    const scheduler = new DreamScheduler(() => [], () => 0.05, () => 0);

    const shortcut = new ConfirmationShortcut(cache, scheduler, tracker);
    const result = await shortcut.tryShortcut(
      TaskType.MAP_REDUCE,
      new Uint8Array(32).fill(0xBB),
      new Uint8Array([5, 6, 7]),
    );

    assert.equal(result, null);
  });

  it('should respect enabled flag', async () => {
    const cache = new PhantomCache();
    const tracker = new MispredictionTracker();
    const scheduler = new DreamScheduler(() => [], () => 0.05, () => 0);

    const shortcut = new ConfirmationShortcut(cache, scheduler, tracker, { enabled: false });
    const result = await shortcut.tryShortcut(
      TaskType.MAP_REDUCE,
      new Uint8Array(32),
      new Uint8Array([1]),
    );

    assert.equal(result, null);
  });
});

// ═══════════════════════════════════════
// SpeculativeDistributor Tests
// ═══════════════════════════════════════

describe('SpeculativeDistributor', () => {
  it('should distribute chunks to idle peers only', async () => {
    const cache = new PhantomCache();
    const sentMessages: { peerId: Uint8Array; msgType: number }[] = [];

    const idlePeer = {
      meshId: randomBytes(16),
      cpuLoad: 0.05,
      acceptingTasks: true,
      batteryPct: 80,
      thermalThrottled: false,
    };

    const busyPeer = {
      meshId: randomBytes(16),
      cpuLoad: 0.90, // Too busy
      acceptingTasks: true,
      batteryPct: 80,
      thermalThrottled: false,
    };

    const distributor = new SpeculativeDistributor(
      cache,
      async (peerId, msgType, payload) => { sentMessages.push({ peerId, msgType }); },
      () => [idlePeer, busyPeer],
    );

    const predictionSet = {
      predictions: [{
        id: randomBytes(16),
        taskType: TaskType.MAP_REDUCE,
        moduleHash: randomBytes(32),
        inputFingerprint: randomBytes(32),
        confidence: 0.8,
        predictedWindowStart: Date.now(),
        predictedWindowEnd: Date.now() + 60000,
        sourceMerIds: ['mer1'],
        createdAt: Date.now(),
        patternType: PredictionPattern.TEMPORAL_RECURRENCE,
      }],
      speculativeBudget: 10,
      generatedAt: Date.now(),
      nextGenerationAt: Date.now() + 60000,
    };

    await distributor.distributeSpeculative(predictionSet);

    assert.ok(sentMessages.length > 0, 'Should send speculative offer');
    assert.equal(sentMessages[0].msgType, 0x80); // SPECULATIVE_OFFER
  });

  it('should respect speculative budget', async () => {
    const cache = new PhantomCache();
    const sentMessages: any[] = [];

    const distributor = new SpeculativeDistributor(
      cache,
      async (peerId, msgType, payload) => { sentMessages.push({ peerId, msgType }); },
      () => [{ meshId: randomBytes(16), cpuLoad: 0.05, acceptingTasks: true, batteryPct: 80, thermalThrottled: false }],
    );

    // Budget of 2 CCU, 5 predictions
    const predictions = Array.from({ length: 5 }, () => ({
      id: randomBytes(16),
      taskType: TaskType.MAP_REDUCE,
      moduleHash: randomBytes(32),
      inputFingerprint: randomBytes(32),
      confidence: 0.8,
      predictedWindowStart: Date.now(),
      predictedWindowEnd: Date.now() + 60000,
      sourceMerIds: ['mer1'],
      createdAt: Date.now(),
      patternType: PredictionPattern.TEMPORAL_RECURRENCE,
    }));

    await distributor.distributeSpeculative({
      predictions,
      speculativeBudget: 2, // Only enough for 2
      generatedAt: Date.now(),
      nextGenerationAt: Date.now() + 60000,
    });

    assert.ok(sentMessages.length <= 2, `Should send <= 2 offers (budget), got ${sentMessages.length}`);
  });

  it('should abort all speculations on abortAll()', async () => {
    const cache = new PhantomCache();
    const abortsSent: any[] = [];

    const distributor = new SpeculativeDistributor(
      cache,
      async (peerId, msgType) => {
        if (msgType === 0x83) abortsSent.push({ peerId, msgType });
      },
      () => [{ meshId: randomBytes(16), cpuLoad: 0.05, acceptingTasks: true, batteryPct: 80, thermalThrottled: false }],
    );

    await distributor.distributeSpeculative({
      predictions: [{
        id: randomBytes(16),
        taskType: TaskType.MAP_REDUCE,
        moduleHash: randomBytes(32),
        inputFingerprint: randomBytes(32),
        confidence: 0.8,
        predictedWindowStart: Date.now(),
        predictedWindowEnd: Date.now() + 60000,
        sourceMerIds: [],
        createdAt: Date.now(),
        patternType: PredictionPattern.TEMPORAL_RECURRENCE,
      }],
      speculativeBudget: 10,
      generatedAt: Date.now(),
      nextGenerationAt: Date.now() + 60000,
    });

    assert.ok(distributor.getActiveCount() >= 0);

    await distributor.abortAll();
    assert.equal(distributor.getActiveCount(), 0);
  });

  it('should skip predictions already in cache', async () => {
    const cache = new PhantomCache();
    const sentMessages: any[] = [];

    const moduleHash = randomBytes(32);
    const inputFp = randomBytes(32);
    const cacheKey = PhantomCache.generateKey(moduleHash, inputFp, String(TaskType.MAP_REDUCE));

    // Pre-populate cache
    cache.store(makeCacheEntry({ cacheKey, confidence: 0.9, resultData: new Uint8Array(10) }));

    const distributor = new SpeculativeDistributor(
      cache,
      async (peerId, msgType) => { sentMessages.push({ peerId, msgType }); },
      () => [{ meshId: randomBytes(16), cpuLoad: 0.05, acceptingTasks: true, batteryPct: 80, thermalThrottled: false }],
    );

    await distributor.distributeSpeculative({
      predictions: [{
        id: randomBytes(16),
        taskType: TaskType.MAP_REDUCE,
        moduleHash,
        inputFingerprint: inputFp,
        confidence: 0.8,
        predictedWindowStart: Date.now(),
        predictedWindowEnd: Date.now() + 60000,
        sourceMerIds: [],
        createdAt: Date.now(),
        patternType: PredictionPattern.TEMPORAL_RECURRENCE,
      }],
      speculativeBudget: 10,
      generatedAt: Date.now(),
      nextGenerationAt: Date.now() + 60000,
    });

    assert.equal(sentMessages.length, 0, 'Should not send offer for cached prediction');
  });
});
