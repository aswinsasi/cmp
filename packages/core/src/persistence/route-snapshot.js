"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotConsciousness = snapshotConsciousness;
exports.restoreConsciousness = restoreConsciousness;
exports.snapshotSpacetime = snapshotSpacetime;
exports.restoreSpacetime = restoreSpacetime;
exports.snapshotWormhole = snapshotWormhole;
exports.restoreWormhole = restoreWormhole;
exports.snapshotPrecognition = snapshotPrecognition;
exports.restorePrecognition = restorePrecognition;
exports.snapshotImmune = snapshotImmune;
exports.restoreImmune = restoreImmune;
exports.snapshotMetabolism = snapshotMetabolism;
exports.restoreMetabolism = restoreMetabolism;
exports.snapshotMorphogenesis = snapshotMorphogenesis;
exports.restoreMorphogenesis = restoreMorphogenesis;
exports.snapshotEntanglement = snapshotEntanglement;
exports.restoreEntanglement = restoreEntanglement;
exports.snapshotHolographic = snapshotHolographic;
exports.restoreHolographic = restoreHolographic;
exports.snapshotMetaEvolution = snapshotMetaEvolution;
exports.restoreMetaEvolution = restoreMetaEvolution;
exports.snapshotAll = snapshotAll;
exports.restoreAll = restoreAll;
const logger_1 = require("../utils/logger");
const v3_state_store_1 = require("./v3-state-store");
const log = new logger_1.Logger('Snapshot');
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
function snapshotConsciousness(consciousness, store) {
    const start = Date.now();
    const entries = [];
    try {
        const status = consciousness.getStatus();
        entries.push({
            subsystem: v3_state_store_1.Subsystem.CONSCIOUSNESS,
            key: 'behavior',
            data: {
                currentBehavior: status.behavior,
                snapshotAt: Date.now(),
            },
        });
        entries.push({
            subsystem: v3_state_store_1.Subsystem.CONSCIOUSNESS,
            key: 'pheromone_summary',
            data: {
                pheromoneCount: status.pheromoneCount,
                dominantType: status.dominantPheromone?.type ?? null,
                dominantIntensity: status.dominantPheromone?.intensity ?? 0,
            },
        });
        entries.push({
            subsystem: v3_state_store_1.Subsystem.CONSCIOUSNESS,
            key: 'quorum_state',
            data: {
                quorumStates: status.quorumStates,
                activeDecisions: status.activeDecisions,
            },
        });
        const totalBytes = store.saveStateBatch(entries);
        return {
            subsystem: v3_state_store_1.Subsystem.CONSCIOUSNESS,
            keysWritten: entries.length,
            totalBytes,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Consciousness snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.CONSCIOUSNESS, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreConsciousness(store) {
    return {
        behavior: store.loadState(v3_state_store_1.Subsystem.CONSCIOUSNESS, 'behavior'),
        pheromones: store.loadState(v3_state_store_1.Subsystem.CONSCIOUSNESS, 'pheromone_summary'),
        quorum: store.loadState(v3_state_store_1.Subsystem.CONSCIOUSNESS, 'quorum_state'),
    };
}
// ═══════════════════════════════════════
// Spacetime (Layer 12)
// ═══════════════════════════════════════
/**
 * Snapshot spacetime DAG metadata and branch info.
 * Full DAG is too large — we save enough to resume branching.
 */
function snapshotSpacetime(spacetime, store) {
    const start = Date.now();
    const entries = [];
    try {
        const status = spacetime.getStatus();
        entries.push({
            subsystem: v3_state_store_1.Subsystem.SPACETIME,
            key: 'dag_summary',
            data: {
                dagNodes: status.dagNodes,
                trunkHead: status.trunkHead,
                snapshotAt: Date.now(),
            },
        });
        entries.push({
            subsystem: v3_state_store_1.Subsystem.SPACETIME,
            key: 'branches',
            data: {
                activeBranches: status.activeBranches,
                activeRaces: status.activeRaces,
            },
        });
        const totalBytes = store.saveStateBatch(entries);
        return {
            subsystem: v3_state_store_1.Subsystem.SPACETIME,
            keysWritten: entries.length,
            totalBytes,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Spacetime snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.SPACETIME, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreSpacetime(store) {
    return {
        dagSummary: store.loadState(v3_state_store_1.Subsystem.SPACETIME, 'dag_summary'),
        branches: store.loadState(v3_state_store_1.Subsystem.SPACETIME, 'branches'),
    };
}
// ═══════════════════════════════════════
// Wormholes (Layer 13)
// ═══════════════════════════════════════
function snapshotWormhole(wormhole, store) {
    const start = Date.now();
    const entries = [];
    try {
        const status = wormhole.getStatus();
        entries.push({
            subsystem: v3_state_store_1.Subsystem.WORMHOLE,
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
            subsystem: v3_state_store_1.Subsystem.WORMHOLE,
            keysWritten: entries.length,
            totalBytes,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Wormhole snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.WORMHOLE, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreWormhole(store) {
    return store.loadState(v3_state_store_1.Subsystem.WORMHOLE, 'registry');
}
// ═══════════════════════════════════════
// Precognition (Layer 9) + Dreaming
// ═══════════════════════════════════════
function snapshotPrecognition(dreamScheduler, phantomCache, mispredictionTracker, store) {
    const start = Date.now();
    const entries = [];
    try {
        // Dream scheduler state
        if (dreamScheduler) {
            entries.push({
                subsystem: v3_state_store_1.Subsystem.PRECOGNITION,
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
                subsystem: v3_state_store_1.Subsystem.PRECOGNITION,
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
                subsystem: v3_state_store_1.Subsystem.PRECOGNITION,
                key: 'misprediction_state',
                data: {
                    totalMispredictions: mispredictionTracker.getTotalMispredictions?.() ?? 0,
                    snapshotAt: Date.now(),
                },
            });
        }
        const totalBytes = entries.length > 0 ? store.saveStateBatch(entries) : 0;
        return {
            subsystem: v3_state_store_1.Subsystem.PRECOGNITION,
            keysWritten: entries.length,
            totalBytes,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Precognition snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.PRECOGNITION, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restorePrecognition(store) {
    return {
        dreamState: store.loadState(v3_state_store_1.Subsystem.PRECOGNITION, 'dream_state'),
        phantomSummary: store.loadState(v3_state_store_1.Subsystem.PRECOGNITION, 'phantom_summary'),
        mispredictionState: store.loadState(v3_state_store_1.Subsystem.PRECOGNITION, 'misprediction_state'),
    };
}
// ═══════════════════════════════════════
// Immune System
// ═══════════════════════════════════════
function snapshotImmune(threatDetector, antibodyGenerator, quarantineManager, store) {
    const start = Date.now();
    const entries = [];
    try {
        if (threatDetector) {
            const threats = threatDetector.getRecentThreats?.() ?? [];
            entries.push({
                subsystem: v3_state_store_1.Subsystem.IMMUNE,
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
                subsystem: v3_state_store_1.Subsystem.IMMUNE,
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
                subsystem: v3_state_store_1.Subsystem.IMMUNE,
                key: 'quarantine',
                data: {
                    devices: quarantined,
                    snapshotAt: Date.now(),
                },
            });
        }
        const totalBytes = entries.length > 0 ? store.saveStateBatch(entries) : 0;
        return {
            subsystem: v3_state_store_1.Subsystem.IMMUNE,
            keysWritten: entries.length,
            totalBytes,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Immune snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.IMMUNE, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreImmune(store) {
    return {
        threatLog: store.loadState(v3_state_store_1.Subsystem.IMMUNE, 'threat_log'),
        antibodies: store.loadState(v3_state_store_1.Subsystem.IMMUNE, 'antibodies'),
        quarantine: store.loadState(v3_state_store_1.Subsystem.IMMUNE, 'quarantine'),
    };
}
// ═══════════════════════════════════════
// Metabolism
// ═══════════════════════════════════════
function snapshotMetabolism(metabolismManager, meshBreathing, store) {
    const start = Date.now();
    const entries = [];
    try {
        if (metabolismManager) {
            const profile = metabolismManager.getProfile?.();
            if (profile) {
                entries.push({
                    subsystem: v3_state_store_1.Subsystem.METABOLISM,
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
                subsystem: v3_state_store_1.Subsystem.METABOLISM,
                key: 'breathing_state',
                data: {
                    phase: meshBreathing.getCurrentPhase?.() ?? 'unknown',
                    snapshotAt: Date.now(),
                },
            });
        }
        const totalBytes = entries.length > 0 ? store.saveStateBatch(entries) : 0;
        return {
            subsystem: v3_state_store_1.Subsystem.METABOLISM,
            keysWritten: entries.length,
            totalBytes,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Metabolism snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.METABOLISM, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreMetabolism(store) {
    return {
        profile: store.loadState(v3_state_store_1.Subsystem.METABOLISM, 'profile'),
        breathingState: store.loadState(v3_state_store_1.Subsystem.METABOLISM, 'breathing_state'),
    };
}
// ═══════════════════════════════════════
// Morphogenesis
// ═══════════════════════════════════════
function snapshotMorphogenesis(organManager, affinityTracker, store) {
    const start = Date.now();
    const entries = [];
    try {
        if (affinityTracker) {
            // Snapshot all device affinities
            const allAffinities = {};
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
                subsystem: v3_state_store_1.Subsystem.MORPHOGENESIS,
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
                subsystem: v3_state_store_1.Subsystem.MORPHOGENESIS,
                key: 'organs',
                data: {
                    organs: organs.map((o) => ({
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
            subsystem: v3_state_store_1.Subsystem.MORPHOGENESIS,
            keysWritten: entries.length,
            totalBytes,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Morphogenesis snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.MORPHOGENESIS, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreMorphogenesis(store) {
    return {
        affinities: store.loadState(v3_state_store_1.Subsystem.MORPHOGENESIS, 'affinities'),
        organs: store.loadState(v3_state_store_1.Subsystem.MORPHOGENESIS, 'organs'),
    };
}
// ═══════════════════════════════════════
// Entanglement
// ═══════════════════════════════════════
function snapshotEntanglement(entanglementPairs, store) {
    const start = Date.now();
    try {
        // Entanglement pairs are typically a Map<string, EntanglementPair>
        const pairsArray = entanglementPairs instanceof Map
            ? Array.from(entanglementPairs.entries()).map(([k, v]) => ({ pairId: k, ...v }))
            : Array.isArray(entanglementPairs) ? entanglementPairs : [];
        store.saveState(v3_state_store_1.Subsystem.ENTANGLEMENT, 'pairs', {
            pairs: pairsArray,
            count: pairsArray.length,
            snapshotAt: Date.now(),
        });
        return {
            subsystem: v3_state_store_1.Subsystem.ENTANGLEMENT,
            keysWritten: 1,
            totalBytes: 0, // Approximate
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Entanglement snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.ENTANGLEMENT, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreEntanglement(store) {
    return store.loadState(v3_state_store_1.Subsystem.ENTANGLEMENT, 'pairs');
}
// ═══════════════════════════════════════
// Holographic Memory (Shard Index)
// ═══════════════════════════════════════
function snapshotHolographic(shardIndex, store) {
    const start = Date.now();
    try {
        // Shard index: Map<key, { shardIds, deviceLocations }>
        const indexData = shardIndex instanceof Map
            ? Array.from(shardIndex.entries())
            : Array.isArray(shardIndex) ? shardIndex : [];
        store.saveState(v3_state_store_1.Subsystem.HOLOGRAPHIC, 'shard_index', {
            entries: indexData,
            count: indexData.length,
            snapshotAt: Date.now(),
        });
        return {
            subsystem: v3_state_store_1.Subsystem.HOLOGRAPHIC,
            keysWritten: 1,
            totalBytes: 0,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Holographic snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.HOLOGRAPHIC, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreHolographic(store) {
    return store.loadState(v3_state_store_1.Subsystem.HOLOGRAPHIC, 'shard_index');
}
// ═══════════════════════════════════════
// Meta-Evolution (Genome State)
// ═══════════════════════════════════════
function snapshotMetaEvolution(genomeMutator, generationTracker, store) {
    const start = Date.now();
    const entries = [];
    try {
        if (genomeMutator) {
            entries.push({
                subsystem: v3_state_store_1.Subsystem.META_EVOLUTION,
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
                subsystem: v3_state_store_1.Subsystem.META_EVOLUTION,
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
            subsystem: v3_state_store_1.Subsystem.META_EVOLUTION,
            keysWritten: entries.length,
            totalBytes,
            durationMs: Date.now() - start,
        };
    }
    catch (err) {
        log.warn(`Meta-evolution snapshot failed: ${err.message}`);
        return { subsystem: v3_state_store_1.Subsystem.META_EVOLUTION, keysWritten: 0, totalBytes: 0, durationMs: Date.now() - start };
    }
}
function restoreMetaEvolution(store) {
    return {
        genomeState: store.loadState(v3_state_store_1.Subsystem.META_EVOLUTION, 'genome_state'),
        generationState: store.loadState(v3_state_store_1.Subsystem.META_EVOLUTION, 'generation_state'),
    };
}
/**
 * Snapshot ALL subsystems in a single pass.
 * Tolerant: individual failures are logged but don't abort.
 */
function snapshotAll(refs, store) {
    const startMs = Date.now();
    const results = [];
    if (refs.consciousness) {
        results.push(snapshotConsciousness(refs.consciousness, store));
    }
    if (refs.spacetime) {
        results.push(snapshotSpacetime(refs.spacetime, store));
    }
    if (refs.wormhole) {
        results.push(snapshotWormhole(refs.wormhole, store));
    }
    results.push(snapshotPrecognition(refs.dreamScheduler, refs.phantomCache, refs.mispredictionTracker, store));
    results.push(snapshotImmune(refs.threatDetector, refs.antibodyGenerator, refs.quarantineManager, store));
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
function restoreAll(store) {
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
//# sourceMappingURL=route-snapshot.js.map