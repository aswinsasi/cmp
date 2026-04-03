/**
 * CMP v3.0 — Dream Manager
 * When the mesh is idle, runs background self-optimization phases.
 *
 * Integration:
 *   - CMPNode monitors task activity. After idleThresholdMs with no tasks,
 *     it calls dreamManager.startDreaming().
 *   - When any task arrives, CMPNode calls dreamManager.wake().
 *   - Each dream phase calls subsystem-specific optimizers via DreamSubsystems.
 *
 * @module dreaming/manager
 * @author Agent Viscro
 */

import {
  DreamPhase,
  DreamState,
  DEFAULT_DREAM_CONFIG,
} from '../types/dreaming';
import type {
  DreamConfig,
  DreamReport,
  PhaseResult,
  ComputationFossil,
} from '../types/dreaming';

function randomHex(n: number): string {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Subsystem Interfaces (injected by CMPNode) ───

export interface DreamSubsystems {
  /** Defragment: returns { lifeformsMoved, tombstonesRemoved, synapsesMerged } */
  defragment(): Promise<Record<string, number>>;
  /** Speculate: returns { predictionsGenerated, cachedResults } */
  speculate(): Promise<Record<string, number>>;
  /** Evolve: returns { mutationsEvaluated, improvementsFound } */
  evolve(): Promise<Record<string, number>>;
  /** Optimize: returns { connectionsPruned, organsAdjusted } */
  optimize(): Promise<Record<string, number>>;
  /** Discover: returns fossils found in MER history */
  discover(): Promise<ComputationFossil[]>;
}

/**
 * Default no-op subsystems (used when real subsystems aren't connected).
 */
export const NOOP_SUBSYSTEMS: DreamSubsystems = {
  async defragment() { return { lifeformsMoved: 0, tombstonesRemoved: 0, synapsesMerged: 0 }; },
  async speculate() { return { predictionsGenerated: 0, cachedResults: 0 }; },
  async evolve() { return { mutationsEvaluated: 0, improvementsFound: 0 }; },
  async optimize() { return { connectionsPruned: 0, organsAdjusted: 0 }; },
  async discover() { return []; },
};

// ═══════════════════════════════════════

export class DreamManager {
  private config: DreamConfig;
  private subsystems: DreamSubsystems;

  /** Current dream state */
  private state: DreamState = DreamState.AWAKE;

  /** Idle timer: fires when idle threshold reached */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Last activity timestamp */
  private lastActivityAt: number = Date.now();

  /** Dream execution state */
  private dreamAbort = false;
  private currentPhase: DreamPhase | null = null;

  /** Reports */
  private reports: DreamReport[] = [];
  private readonly maxReports = 100;

  /** Fossils discovered */
  private fossils: ComputationFossil[] = [];

  /** Stats */
  private totalDreams = 0;
  private totalPhases = 0;
  private totalDreamTimeMs = 0;

  /** Whether idle monitoring is active */
  private monitoring = false;

  constructor(
    subsystems?: DreamSubsystems,
    config?: Partial<DreamConfig>,
  ) {
    this.config = { ...DEFAULT_DREAM_CONFIG, ...config };
    this.subsystems = subsystems ?? NOOP_SUBSYSTEMS;
  }

  // ═══════════════════════════════════════
  // Activity Tracking
  // ═══════════════════════════════════════

  /**
   * Record activity (task received, cause processed, etc).
   * Resets the idle timer.
   */
  recordActivity(): void {
    this.lastActivityAt = Date.now();

    // If dreaming, wake up
    if (this.state === DreamState.DREAMING) {
      this.wake();
    }

    // Reset idle timer
    this.resetIdleTimer();
  }

  /**
   * Start monitoring for idle periods.
   */
  startMonitoring(): void {
    this.monitoring = true;
    this.resetIdleTimer();
  }

  /**
   * Stop monitoring and any active dream.
   */
  stopMonitoring(): void {
    this.monitoring = false;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.state === DreamState.DREAMING) {
      this.wake();
    }
  }

  private resetIdleTimer(): void {
    if (!this.monitoring) return;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.startDreaming();
    }, this.config.idleThresholdMs);
  }

  // ═══════════════════════════════════════
  // Dream Lifecycle
  // ═══════════════════════════════════════

  /**
   * Begin a dream cycle. Runs through enabled phases sequentially.
   */
  async startDreaming(): Promise<DreamReport> {
    if (this.state === DreamState.DREAMING) {
      return this.makeEmptyReport(true);
    }

    this.state = DreamState.FALLING_ASLEEP;
    this.dreamAbort = false;

    const startedAt = Date.now();
    const phasesCompleted: DreamPhase[] = [];
    const phaseResults = new Map<DreamPhase, PhaseResult>();

    this.state = DreamState.DREAMING;
    this.totalDreams++;

    // Run each enabled phase (with timeout and abort check)
    for (const phase of this.config.enabledPhases) {
      if (this.dreamAbort) break;
      if (Date.now() - startedAt > this.config.maxDreamDurationMs) break;

      this.currentPhase = phase;
      const phaseStart = Date.now();

      try {
        const result = await this.runPhaseWithTimeout(phase);
        const phaseDuration = Date.now() - phaseStart;

        phaseResults.set(phase, {
          phase,
          startedAt: phaseStart,
          durationMs: phaseDuration,
          metrics: result.metrics,
          summary: result.summary,
        });

        phasesCompleted.push(phase);
        this.totalPhases++;
      } catch (err) {
        // Phase failed — log and continue to next
        phaseResults.set(phase, {
          phase,
          startedAt: phaseStart,
          durationMs: Date.now() - phaseStart,
          metrics: { error: 1 },
          summary: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    this.currentPhase = null;
    this.state = DreamState.AWAKE;

    const endedAt = Date.now();
    const durationMs = endedAt - startedAt;
    this.totalDreamTimeMs += durationMs;

    const report: DreamReport = {
      startedAt,
      endedAt,
      durationMs,
      phasesCompleted,
      phaseResults,
      interrupted: this.dreamAbort,
    };

    this.reports.push(report);
    if (this.reports.length > this.maxReports) this.reports.shift();

    // Restart idle timer
    this.resetIdleTimer();

    return report;
  }

  /**
   * Wake up from dreaming (e.g., task arrived).
   */
  wake(): void {
    if (this.state !== DreamState.DREAMING && this.state !== DreamState.FALLING_ASLEEP) return;

    this.dreamAbort = true;
    this.state = DreamState.WAKING;

    // State transitions to AWAKE when the dream loop exits
    setImmediate(() => {
      if (this.state === DreamState.WAKING) {
        this.state = DreamState.AWAKE;
      }
    });
  }

  // ═══════════════════════════════════════
  // Phase Execution
  // ═══════════════════════════════════════

  private async runPhaseWithTimeout(
    phase: DreamPhase,
  ): Promise<{ metrics: Record<string, number>; summary: string }> {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({ metrics: { timedOut: 1 }, summary: `Phase ${phase} timed out` });
      }, this.config.phaseTimeMs);

      try {
        const result = await this.runPhase(phase);
        clearTimeout(timeout);
        resolve(result);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  private async runPhase(
    phase: DreamPhase,
  ): Promise<{ metrics: Record<string, number>; summary: string }> {
    switch (phase) {
      case 'defragment': {
        const m = await this.subsystems.defragment();
        return {
          metrics: m,
          summary: `Moved ${m.lifeformsMoved} Lifeforms, removed ${m.tombstonesRemoved} tombstones, merged ${m.synapsesMerged} synapses`,
        };
      }

      case 'speculate': {
        const m = await this.subsystems.speculate();
        return {
          metrics: m,
          summary: `Generated ${m.predictionsGenerated} predictions, cached ${m.cachedResults} results`,
        };
      }

      case 'evolve': {
        const m = await this.subsystems.evolve();
        return {
          metrics: m,
          summary: `Evaluated ${m.mutationsEvaluated} mutations, found ${m.improvementsFound} improvements`,
        };
      }

      case 'optimize': {
        const m = await this.subsystems.optimize();
        return {
          metrics: m,
          summary: `Pruned ${m.connectionsPruned} connections, adjusted ${m.organsAdjusted} organs`,
        };
      }

      case 'discover': {
        const newFossils = await this.subsystems.discover();
        for (const f of newFossils) this.fossils.push(f);
        return {
          metrics: { fossilsFound: newFossils.length },
          summary: `Discovered ${newFossils.length} computation fossils`,
        };
      }

      default:
        return { metrics: {}, summary: `Unknown phase: ${phase}` };
    }
  }

  private makeEmptyReport(interrupted: boolean): DreamReport {
    return {
      startedAt: Date.now(),
      endedAt: Date.now(),
      durationMs: 0,
      phasesCompleted: [],
      phaseResults: new Map(),
      interrupted,
    };
  }

  // ═══════════════════════════════════════
  // Query
  // ═══════════════════════════════════════

  /** Get current dream state */
  getState(): DreamState {
    return this.state;
  }

  /** Get current dream phase (null if not dreaming) */
  getCurrentPhase(): DreamPhase | null {
    return this.currentPhase;
  }

  /** Is the mesh currently dreaming? */
  get isDreaming(): boolean {
    return this.state === DreamState.DREAMING;
  }

  /** Get all dream reports */
  getReports(): DreamReport[] {
    return [...this.reports];
  }

  /** Get the latest dream report */
  getLastReport(): DreamReport | null {
    return this.reports.length > 0 ? this.reports[this.reports.length - 1] : null;
  }

  /** Get all discovered fossils */
  getFossils(): ComputationFossil[] {
    return [...this.fossils];
  }

  /** Get ms since last activity */
  getIdleTimeMs(): number {
    return Date.now() - this.lastActivityAt;
  }

  /** Get stats */
  getStats(): {
    state: DreamState;
    totalDreams: number;
    totalPhases: number;
    totalDreamTimeMs: number;
    fossils: number;
    idleMs: number;
  } {
    return {
      state: this.state,
      totalDreams: this.totalDreams,
      totalPhases: this.totalPhases,
      totalDreamTimeMs: this.totalDreamTimeMs,
      fossils: this.fossils.length,
      idleMs: this.getIdleTimeMs(),
    };
  }

  /** Set subsystems (for late binding) */
  setSubsystems(subsystems: DreamSubsystems): void {
    this.subsystems = subsystems;
  }
}
