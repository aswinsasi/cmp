/**
 * CMP v4.0 — Route Snapshot
 *
 * Snapshot and restore functions for all v3 subsystem state.
 * Each subsystem gets a pair of functions:
 *   snapshotXxx(instance) → saves state to V3StateStore
 *   restoreXxx(store) → returns state object for re-hydration
 *
 * Subsystems covered:
 *   - Consciousness (pheromone field, behavior, quorum state)
 *   - Spacetime (DAG metadata, branch info)
 *   - Wormholes (remote mesh registry, tunnel state)
 *   - Precognition (predictions, dream state)
 *   - Immune (antibodies, quarantine list, threat log)
 *   - Metabolism (profiles, energy budget)
 *   - Morphogenesis (affinities, organ definitions)
 *   - Entanglement (pair state)
 *   - Holographic Memory (shard index)
 *
 * MCL/MER persistence is handled separately by SQLiteMERPersistence
 * (already production). This module handles everything else.
 *
 * @module persistence/route-snapshot
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';
import { V3StateStore, Subsystem } from './v3-state-store';

const log = new Logger('Snapshot');

// ─── Snapshot Result ───

export interface SnapshotResult {
  subsystem: string;
  keysWritten: number;
  totalBytes: number;
  durationMs: number;
}

export interface FullSnapshotResult {
  subsystems: SnapshotResult[];
  totalKeysWritten: number;
  totalBytes: number;
  durationMs: number;
}

// ═══════════════════════════════════════
// Consciousness (Layer 11)
// ═══════════════════════════════════════

/**
 * Snapshot the consciousness layer state.
 * Captures: current behavior, pheromone field summary, quorum state.
 *
 * Note: Individual pheromones are ephemeral and decay — we only save
 * aggregate state (behavior + recent pheromone type counts).
 */
export function snapshotConsciousness(consciousness: any, store: V3StateStore): SnapshotResult {
  const start = Date.now();
  const entries: Array<{ subsystem: string; key: string; data: any }> = [];

  try {
    const status = consciousness.getStatus();

    entries.push({
      subsystem: Subsystem.CONSCIOUSNESS,
      key: 'behavior',
      data: {
        currentBehavior: status.behavior,
        snapshotAt: Date.now(),
      },
    });

    entries.push({
      subsystem: Subsystem.CONSCIOUSNESS,
      key: 'pheromone_summary',
      data: {
        pheromoneCount: status.pheromoneCount,
        dominantType: status.dominantPheromone?.type ?? null,
        dominantIntensity: status.dominantPheromone?.intensity ?? 0,
      },
    });

    entries.push({
      subsystem: Subsystem.CONSCIOUSNESS,
      key: 'quorum_state',
      data: {
        quorumStates: status.quorumStates,
        activeDecisions: status.activeDecisions,
      },
    });

    const totalBytes = store.saveStateBatch(entries);

    return {
      subsystem: Subsystem.CONSCIOUSNESS,
      keysWritten: entries.length,
      totalBytes,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Consciousness snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.CONSCIOUSNESS, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreConsciousness(store: V3StateStore): {
  behavior: string | null;
  pheromones: any;
  quorum: any;
} {
  return {
    behavior: store.loadState(Subsystem.CONSCIOUSNESS, 'behavior'),
    pheromones: store.loadState(Subsystem.CONSCIOUSNESS, 'pheromone_summary'),
    quorum: store.loadState(Subsystem.CONSCIOUSNESS, 'quorum_state'),
  };
}

// ═══════════════════════════════════════
// Spacetime (Layer 12)
// ═══════════════════════════════════════

/**
 * Snapshot spacetime DAG metadata and branch info.
 * Full DAG is too large — we save enough to resume branching.
 */
export function snapshotSpacetime(spacetime: any, store: V3StateStore): SnapshotResult {
  const start = Date.now();
  const entries: Array<{ subsystem: string; key: string; data: any }> = [];

  try {
    const status = spacetime.getStatus();

    entries.push({
      subsystem: Subsystem.SPACETIME,
      key: 'dag_summary',
      data: {
        dagNodes: status.dagNodes,
        trunkHead: status.trunkHead,
        snapshotAt: Date.now(),
      },
    });

    entries.push({
      subsystem: Subsystem.SPACETIME,
      key: 'branches',
      data: {
        activeBranches: status.activeBranches,
        activeRaces: status.activeRaces,
      },
    });

    const totalBytes = store.saveStateBatch(entries);

    return {
      subsystem: Subsystem.SPACETIME,
      keysWritten: entries.length,
      totalBytes,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Spacetime snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.SPACETIME, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreSpacetime(store: V3StateStore): {
  dagSummary: any;
  branches: any;
} {
  return {
    dagSummary: store.loadState(Subsystem.SPACETIME, 'dag_summary'),
    branches: store.loadState(Subsystem.SPACETIME, 'branches'),
  };
}

// ═══════════════════════════════════════
// Wormholes (Layer 13)
// ═══════════════════════════════════════

export function snapshotWormhole(wormhole: any, store: V3StateStore): SnapshotResult {
  const start = Date.now();
  const entries: Array<{ subsystem: string; key: string; data: any }> = [];

  try {
    const status = wormhole.getStatus();

    entries.push({
      subsystem: Subsystem.WORMHOLE,
      key: 'registry',
      data: {
        remoteMeshes: status.remoteMeshes,
        activeWormholes: status.activeWormholes,
        crossSynapses: status.crossSynapses,
        snapshotAt: Date.now(),
      },
    });

    const totalBytes = store.saveStateBatch(entries);

    return {
      subsystem: Subsystem.WORMHOLE,
      keysWritten: entries.length,
      totalBytes,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Wormhole snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.WORMHOLE, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreWormhole(store: V3StateStore): any {
  return store.loadState(Subsystem.WORMHOLE, 'registry');
}

// ═══════════════════════════════════════
// Precognition (Layer 9) + Dreaming
// ═══════════════════════════════════════

export function snapshotPrecognition(
  dreamScheduler: any,
  phantomCache: any,
  mispredictionTracker: any,
  store: V3StateStore,
): SnapshotResult {
  const start = Date.now();
  const entries: Array<{ subsystem: string; key: string; data: any }> = [];

  try {
    // Dream scheduler state
    if (dreamScheduler) {
      entries.push({
        subsystem: Subsystem.PRECOGNITION,
        key: 'dream_state',
        data: {
          running: !!dreamScheduler.running,
          snapshotAt: Date.now(),
        },
      });
    }

    // Phantom cache summary (individual phantoms are ephemeral)
    if (phantomCache) {
      entries.push({
        subsystem: Subsystem.PRECOGNITION,
        key: 'phantom_summary',
        data: {
          cacheSize: phantomCache.size?.() ?? 0,
          snapshotAt: Date.now(),
        },
      });
    }

    // Misprediction tracker state
    if (mispredictionTracker) {
      entries.push({
        subsystem: Subsystem.PRECOGNITION,
        key: 'misprediction_state',
        data: {
          totalMispredictions: mispredictionTracker.getTotalMispredictions?.() ?? 0,
          snapshotAt: Date.now(),
        },
      });
    }

    const totalBytes = entries.length > 0 ? store.saveStateBatch(entries) : 0;

    return {
      subsystem: Subsystem.PRECOGNITION,
      keysWritten: entries.length,
      totalBytes,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Precognition snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.PRECOGNITION, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restorePrecognition(store: V3StateStore): {
  dreamState: any;
  phantomSummary: any;
  mispredictionState: any;
} {
  return {
    dreamState: store.loadState(Subsystem.PRECOGNITION, 'dream_state'),
    phantomSummary: store.loadState(Subsystem.PRECOGNITION, 'phantom_summary'),
    mispredictionState: store.loadState(Subsystem.PRECOGNITION, 'misprediction_state'),
  };
}

// ═══════════════════════════════════════
// Immune System
// ═══════════════════════════════════════

export function snapshotImmune(
  threatDetector: any,
  antibodyGenerator: any,
  quarantineManager: any,
  store: V3StateStore,
): SnapshotResult {
  const start = Date.now();
  const entries: Array<{ subsystem: string; key: string; data: any }> = [];

  try {
    if (threatDetector) {
      const threats = threatDetector.getRecentThreats?.() ?? [];
      entries.push({
        subsystem: Subsystem.IMMUNE,
        key: 'threat_log',
        data: {
          recentThreats: threats.slice(-50), // Keep last 50
          snapshotAt: Date.now(),
        },
      });
    }

    if (antibodyGenerator) {
      const antibodies = antibodyGenerator.getLoadedAntibodies?.() ?? [];
      entries.push({
        subsystem: Subsystem.IMMUNE,
        key: 'antibodies',
        data: {
          loaded: antibodies,
          snapshotAt: Date.now(),
        },
      });
    }

    if (quarantineManager) {
      const quarantined = quarantineManager.getQuarantinedDevices?.() ?? [];
      entries.push({
        subsystem: Subsystem.IMMUNE,
        key: 'quarantine',
        data: {
          devices: quarantined,
          snapshotAt: Date.now(),
        },
      });
    }

    const totalBytes = entries.length > 0 ? store.saveStateBatch(entries) : 0;

    return {
      subsystem: Subsystem.IMMUNE,
      keysWritten: entries.length,
      totalBytes,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Immune snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.IMMUNE, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreImmune(store: V3StateStore): {
  threatLog: any;
  antibodies: any;
  quarantine: any;
} {
  return {
    threatLog: store.loadState(Subsystem.IMMUNE, 'threat_log'),
    antibodies: store.loadState(Subsystem.IMMUNE, 'antibodies'),
    quarantine: store.loadState(Subsystem.IMMUNE, 'quarantine'),
  };
}

// ═══════════════════════════════════════
// Metabolism
// ═══════════════════════════════════════

export function snapshotMetabolism(
  metabolismManager: any,
  meshBreathing: any,
  store: V3StateStore,
): SnapshotResult {
  const start = Date.now();
  const entries: Array<{ subsystem: string; key: string; data: any }> = [];

  try {
    if (metabolismManager) {
      const profile = metabolismManager.getProfile?.();
      if (profile) {
        entries.push({
          subsystem: Subsystem.METABOLISM,
          key: 'profile',
          data: {
            state: profile.state,
            energyBudget: profile.energyBudget,
            cpuAllocation: profile.cpuAllocation,
            memoryAllocation: profile.memoryAllocation,
            snapshotAt: Date.now(),
          },
        });
      }
    }

    if (meshBreathing) {
      entries.push({
        subsystem: Subsystem.METABOLISM,
        key: 'breathing_state',
        data: {
          phase: meshBreathing.getCurrentPhase?.() ?? 'unknown',
          snapshotAt: Date.now(),
        },
      });
    }

    const totalBytes = entries.length > 0 ? store.saveStateBatch(entries) : 0;

    return {
      subsystem: Subsystem.METABOLISM,
      keysWritten: entries.length,
      totalBytes,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Metabolism snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.METABOLISM, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreMetabolism(store: V3StateStore): {
  profile: any;
  breathingState: any;
} {
  return {
    profile: store.loadState(Subsystem.METABOLISM, 'profile'),
    breathingState: store.loadState(Subsystem.METABOLISM, 'breathing_state'),
  };
}

// ═══════════════════════════════════════
// Morphogenesis
// ═══════════════════════════════════════

export function snapshotMorphogenesis(
  organManager: any,
  affinityTracker: any,
  store: V3StateStore,
): SnapshotResult {
  const start = Date.now();
  const entries: Array<{ subsystem: string; key: string; data: any }> = [];

  try {
    if (affinityTracker) {
      // Snapshot all device affinities
      const allAffinities: Record<string, any> = {};
      const devices = affinityTracker.getAllDevices?.() ?? [];
      for (const deviceId of devices) {
        const affinity = affinityTracker.getAffinity?.(deviceId);
        if (affinity) {
          allAffinities[deviceId] = {
            specialization: affinity.specialization,
            taskHistory: (affinity.taskHistory ?? []).slice(-20), // Keep last 20
            score: affinity.specializationScore,
          };
        }
      }

      entries.push({
        subsystem: Subsystem.MORPHOGENESIS,
        key: 'affinities',
        data: {
          devices: allAffinities,
          snapshotAt: Date.now(),
        },
      });
    }

    if (organManager) {
      const organs = organManager.getOrgans?.() ?? [];
      entries.push({
        subsystem: Subsystem.MORPHOGENESIS,
        key: 'organs',
        data: {
          organs: organs.map((o: any) => ({
            id: o.id,
            organType: o.organType,
            members: Array.from(o.members ?? []),
            state: o.state,
            health: o.health,
          })),
          snapshotAt: Date.now(),
        },
      });
    }

    const totalBytes = entries.length > 0 ? store.saveStateBatch(entries) : 0;

    return {
      subsystem: Subsystem.MORPHOGENESIS,
      keysWritten: entries.length,
      totalBytes,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Morphogenesis snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.MORPHOGENESIS, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreMorphogenesis(store: V3StateStore): {
  affinities: any;
  organs: any;
} {
  return {
    affinities: store.loadState(Subsystem.MORPHOGENESIS, 'affinities'),
    organs: store.loadState(Subsystem.MORPHOGENESIS, 'organs'),
  };
}

// ═══════════════════════════════════════
// Entanglement
// ═══════════════════════════════════════

export function snapshotEntanglement(entanglementPairs: any, store: V3StateStore): SnapshotResult {
  const start = Date.now();

  try {
    // Entanglement pairs are typically a Map<string, EntanglementPair>
    const pairsArray = entanglementPairs instanceof Map
      ? Array.from(entanglementPairs.entries()).map(([k, v]: [string, any]) => ({ pairId: k, ...v }))
      : Array.isArray(entanglementPairs) ? entanglementPairs : [];

    store.saveState(Subsystem.ENTANGLEMENT, 'pairs', {
      pairs: pairsArray,
      count: pairsArray.length,
      snapshotAt: Date.now(),
    });

    return {
      subsystem: Subsystem.ENTANGLEMENT,
      keysWritten: 1,
      totalBytes: 0, // Approximate
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Entanglement snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.ENTANGLEMENT, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreEntanglement(store: V3StateStore): any {
  return store.loadState(Subsystem.ENTANGLEMENT, 'pairs');
}

// ═══════════════════════════════════════
// Holographic Memory (Shard Index)
// ═══════════════════════════════════════

export function snapshotHolographic(shardIndex: any, store: V3StateStore): SnapshotResult {
  const start = Date.now();

  try {
    // Shard index: Map<key, { shardIds, deviceLocations }>
    const indexData = shardIndex instanceof Map
      ? Array.from(shardIndex.entries())
      : Array.isArray(shardIndex) ? shardIndex : [];

    store.saveState(Subsystem.HOLOGRAPHIC, 'shard_index', {
      entries: indexData,
      count: indexData.length,
      snapshotAt: Date.now(),
    });

    return {
      subsystem: Subsystem.HOLOGRAPHIC,
      keysWritten: 1,
      totalBytes: 0,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Holographic snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.HOLOGRAPHIC, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreHolographic(store: V3StateStore): any {
  return store.loadState(Subsystem.HOLOGRAPHIC, 'shard_index');
}

// ═══════════════════════════════════════
// Meta-Evolution (Genome State)
// ═══════════════════════════════════════

export function snapshotMetaEvolution(
  genomeMutator: any,
  generationTracker: any,
  store: V3StateStore,
): SnapshotResult {
  const start = Date.now();
  const entries: Array<{ subsystem: string; key: string; data: any }> = [];

  try {
    if (genomeMutator) {
      entries.push({
        subsystem: Subsystem.META_EVOLUTION,
        key: 'genome_state',
        data: {
          mutationHistory: genomeMutator.getHistory?.()?.slice(-50) ?? [],
          currentGenome: genomeMutator.getCurrentGenome?.() ?? null,
          snapshotAt: Date.now(),
        },
      });
    }

    if (generationTracker) {
      entries.push({
        subsystem: Subsystem.META_EVOLUTION,
        key: 'generation_state',
        data: {
          currentGeneration: generationTracker.getCurrentGeneration?.() ?? 0,
          fitnessHistory: generationTracker.getFitnessHistory?.()?.slice(-50) ?? [],
          snapshotAt: Date.now(),
        },
      });
    }

    const totalBytes = entries.length > 0 ? store.saveStateBatch(entries) : 0;

    return {
      subsystem: Subsystem.META_EVOLUTION,
      keysWritten: entries.length,
      totalBytes,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    log.warn(`Meta-evolution snapshot failed: ${err.message}`);
    return { subsystem: Subsystem.META_EVOLUTION, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
  }
}

export function restoreMetaEvolution(store: V3StateStore): {
  genomeState: any;
  generationState: any;
} {
  return {
    genomeState: store.loadState(Subsystem.META_EVOLUTION, 'genome_state'),
    generationState: store.loadState(Subsystem.META_EVOLUTION, 'generation_state'),
  };
}

// ═══════════════════════════════════════
// Full Snapshot / Restore
// ═══════════════════════════════════════

export interface SubsystemRefs {
  consciousness?: any;
  spacetime?: any;
  wormhole?: any;
  dreamScheduler?: any;
  phantomCache?: any;
  mispredictionTracker?: any;
  threatDetector?: any;
  antibodyGenerator?: any;
  quarantineManager?: any;
  metabolismManager?: any;
  meshBreathing?: any;
  organManager?: any;
  affinityTracker?: any;
  entanglementPairs?: any;
  holographicShardIndex?: any;
  genomeMutator?: any;
  generationTracker?: any;
}

/**
 * Snapshot ALL subsystems in a single pass.
 * Tolerant: individual failures are logged but don't abort.
 */
export function snapshotAll(refs: SubsystemRefs, store: V3StateStore): FullSnapshotResult {
  const startMs = Date.now();
  const results: SnapshotResult[] = [];

  if (refs.consciousness) {
    results.push(snapshotConsciousness(refs.consciousness, store));
  }

  if (refs.spacetime) {
    results.push(snapshotSpacetime(refs.spacetime, store));
  }

  if (refs.wormhole) {
    results.push(snapshotWormhole(refs.wormhole, store));
  }

  results.push(snapshotPrecognition(
    refs.dreamScheduler, refs.phantomCache, refs.mispredictionTracker, store,
  ));

  results.push(snapshotImmune(
    refs.threatDetector, refs.antibodyGenerator, refs.quarantineManager, store,
  ));

  results.push(snapshotMetabolism(refs.metabolismManager, refs.meshBreathing, store));

  results.push(snapshotMorphogenesis(refs.organManager, refs.affinityTracker, store));

  if (refs.entanglementPairs) {
    results.push(snapshotEntanglement(refs.entanglementPairs, store));
  }

  if (refs.holographicShardIndex) {
    results.push(snapshotHolographic(refs.holographicShardIndex, store));
  }

  results.push(snapshotMetaEvolution(refs.genomeMutator, refs.generationTracker, store));

  // Flush to disk
  store.forceSave();

  const totalKeysWritten = results.reduce((s, r) => s + r.keysWritten, 0);
  const totalBytes = results.reduce((s, r) => s + r.totalBytes, 0);
  const durationMs = Date.now() - startMs;

  // Record in save history
  store.recordSave('full', totalKeysWritten, totalBytes, durationMs);

  log.info(`Full snapshot: ${totalKeysWritten} keys, ${(totalBytes / 1024).toFixed(1)} KB in ${durationMs}ms`);

  return { subsystems: results, totalKeysWritten, totalBytes, durationMs };
}

/**
 * Restore ALL subsystem state from the store.
 * Returns a plain object — callers re-hydrate their subsystems.
 */
export function restoreAll(store: V3StateStore): {
  consciousness: ReturnType<typeof restoreConsciousness>;
  spacetime: ReturnType<typeof restoreSpacetime>;
  wormhole: any;
  precognition: ReturnType<typeof restorePrecognition>;
  immune: ReturnType<typeof restoreImmune>;
  metabolism: ReturnType<typeof restoreMetabolism>;
  morphogenesis: ReturnType<typeof restoreMorphogenesis>;
  entanglement: any;
  holographic: any;
  metaEvolution: ReturnType<typeof restoreMetaEvolution>;
} {
  return {
    consciousness: restoreConsciousness(store),
    spacetime: restoreSpacetime(store),
    wormhole: restoreWormhole(store),
    precognition: restorePrecognition(store),
    immune: restoreImmune(store),
    metabolism: restoreMetabolism(store),
    morphogenesis: restoreMorphogenesis(store),
    entanglement: restoreEntanglement(store),
    holographic: restoreHolographic(store),
    metaEvolution: restoreMetaEvolution(store),
  };
}
