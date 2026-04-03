/**
 * CMP v3.0 — Mesh Dreaming Type Definitions
 * When the mesh is idle, it "dreams" — running background self-optimization.
 *
 * 5 dream phases:
 *   1. DEFRAGMENT — rebalance Lifeform placement, compact CRDT tombstones
 *   2. SPECULATE — run Precognition predictions, pre-cache results
 *   3. EVOLVE — evaluate pending genome mutations on idle CPU
 *   4. OPTIMIZE — prune neuromorphic routing, adjust organ boundaries
 *   5. DISCOVER — mine MER history for patterns, store as Computation Fossils
 *
 * @module types/dreaming
 * @author Agent Viscro
 */

// ─── Dream Phases ───

export enum DreamPhase {
  /** Rebalance and compact */
  DEFRAGMENT = 'defragment',
  /** Pre-compute predicted tasks */
  SPECULATE = 'speculate',
  /** Run evolution evaluations without live traffic */
  EVOLVE = 'evolve',
  /** Prune weak neural pathways, adjust organs */
  OPTIMIZE = 'optimize',
  /** Mine execution history for undiscovered patterns */
  DISCOVER = 'discover',
}

// ─── Dream State ───

export enum DreamState {
  /** Not dreaming — mesh is active */
  AWAKE = 'awake',
  /** Entering dream state */
  FALLING_ASLEEP = 'falling_asleep',
  /** Actively dreaming */
  DREAMING = 'dreaming',
  /** Waking up (task arrived) */
  WAKING = 'waking',
}

// ─── Dream Configuration ───

export interface DreamConfig {
  /** Minimum idle time before dreaming starts (ms). Default: 30000 */
  idleThresholdMs: number;
  /** Maximum dream duration per cycle (ms). Default: 300000 (5 min) */
  maxDreamDurationMs: number;
  /** Time allocated per dream phase (ms). Default: 60000 (1 min) */
  phaseTimeMs: number;
  /** Which phases to run (and in what order) */
  enabledPhases: DreamPhase[];
  /** Max CPU usage during dreaming (0.0-1.0). Default: 0.3 */
  maxDreamCPU: number;
}

export const DEFAULT_DREAM_CONFIG: DreamConfig = {
  idleThresholdMs: 30000,
  maxDreamDurationMs: 300000,
  phaseTimeMs: 60000,
  enabledPhases: [
    DreamPhase.DEFRAGMENT,
    DreamPhase.SPECULATE,
    DreamPhase.EVOLVE,
    DreamPhase.OPTIMIZE,
    DreamPhase.DISCOVER,
  ],
  maxDreamCPU: 0.3,
};

// ─── Dream Report ───

export interface DreamReport {
  /** When the dream started */
  startedAt: number;
  /** When the dream ended */
  endedAt: number;
  /** Total dream duration in ms */
  durationMs: number;
  /** Phases completed */
  phasesCompleted: DreamPhase[];
  /** Phase results */
  phaseResults: Map<DreamPhase, PhaseResult>;
  /** Was the dream interrupted by incoming work? */
  interrupted: boolean;
}

export interface PhaseResult {
  phase: DreamPhase;
  startedAt: number;
  durationMs: number;
  /** Phase-specific metrics */
  metrics: Record<string, number>;
  /** Human-readable summary */
  summary: string;
}

// ─── Computation Fossil ───

export interface ComputationFossil {
  /** Unique fossil ID */
  id: string;
  /** Pattern type discovered */
  patternType: 'periodic' | 'correlation' | 'anomaly' | 'affinity' | 'bottleneck';
  /** Human-readable description */
  description: string;
  /** Confidence score 0.0-1.0 */
  confidence: number;
  /** When this was discovered */
  discoveredAt: number;
  /** Supporting data */
  evidence: Record<string, any>;
}
