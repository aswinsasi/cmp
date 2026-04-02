/**
 * CMP v2.0 — Layer 12: Computation Spacetime
 *
 * Fork reality. Run parallel universes. Merge the best one back.
 *
 * Orchestrates:
 *   - CausalMerkleDAG: immutable content-addressed computation history
 *   - TemporalForker: timeline branching, racing, and merging
 *
 * Wire Protocol: 0xE6-0xEB
 *
 * @module spacetime
 * @author Agent Viscro
 */

import { CausalMerkleDAG } from './causal-dag';
import { TemporalForker, TemporalEvent } from './temporal-forker';
import {
  SpacetimeConfig,
  DEFAULT_SPACETIME_CONFIG,
  SpacetimeMessageType,
  FitnessMetric,
  BranchFitness,
  BranchState,
  TimelineForkWire,
  BranchStateSyncWire,
  BranchRaceStartWire,
  BranchMetricsWire,
  TimelineMergeWire,
  ArchaeologyQueryWire,
  DAGNode,
} from '../types/spacetime';

// ─── Spacetime Layer ───

export class SpacetimeLayer {
  /** The causal Merkle DAG */
  readonly dag: CausalMerkleDAG;
  /** The temporal forker */
  readonly forker: TemporalForker;

  private config: SpacetimeConfig;
  private lifeformId: string;

  /** Transport callback */
  private sendMessage: ((msgType: number, payload: any) => void) | null = null;

  /** Listeners */
  private listeners = new Set<(event: TemporalEvent) => void>();

  constructor(lifeformId: string, config?: Partial<SpacetimeConfig>) {
    this.lifeformId = lifeformId;
    this.config = { ...DEFAULT_SPACETIME_CONFIG, ...config };

    this.dag = new CausalMerkleDAG(config);
    this.forker = new TemporalForker(lifeformId, this.dag, config);

    // Forward forker events
    this.forker.onEvent((event) => {
      for (const listener of this.listeners) {
        try { listener(event); } catch {}
      }
    });
  }

  /** Set transport callback */
  setTransport(sendFn: (msgType: number, payload: any) => void): void {
    this.sendMessage = sendFn;
  }

  /** Subscribe to spacetime events */
  onEvent(listener: (event: TemporalEvent) => void): void {
    this.listeners.add(listener);
  }

  /** Stop all timers */
  stop(): void {
    this.forker.stop();
  }

  // ══════════════════════════════════════
  // High-Level API
  // ══════════════════════════════════════

  /**
   * Record a cause execution. Appends to DAG and updates branch fitness.
   * Call this after every cause handler execution.
   */
  recordExecution(
    branchId: string,
    causeId: string,
    stateHash: string,
    resultHash: string,
    executionTimeMs: number,
    ccuCost: number,
    stateMutations: number,
    stateSnapshot?: any,
  ): DAGNode {
    // Forker handles both DAG append AND fitness update
    this.forker.recordExecution(
      branchId, causeId, stateHash, resultHash,
      executionTimeMs, ccuCost, stateMutations, stateSnapshot,
    );

    // Get the node that was just appended
    const node = this.dag.getHead(branchId)!;

    // Broadcast state sync
    if (this.sendMessage) {
      const wire: BranchStateSyncWire = {
        branchId,
        headHash: node.hash,
        latestNode: node,
        fitness: this.forker.getBranch(branchId)?.fitness,
      };
      this.sendMessage(SpacetimeMessageType.BRANCH_STATE_SYNC, wire);
    }

    return node;
  }

  /**
   * Fork the current timeline. Creates a parallel universe.
   */
  fork(label: string, stateSnapshot?: any, parentBranchId?: string): string | null {
    const branch = this.forker.fork(label, parentBranchId, stateSnapshot);
    if (!branch) return null;

    // Broadcast fork
    if (this.sendMessage) {
      const wire: TimelineForkWire = {
        lifeformId: this.lifeformId,
        branchId: branch.id,
        label: branch.label,
        forkPointHash: branch.forkPointHash,
        parentBranchId: branch.parentBranchId,
        timestamp: Date.now(),
      };
      this.sendMessage(SpacetimeMessageType.TIMELINE_FORK, wire);
    }

    return branch.id;
  }

  /**
   * Start a race between branches.
   */
  startRace(
    branchIds: string[],
    metric: FitnessMetric = FitnessMetric.CCU_EFFICIENCY,
    maxDurationMs?: number,
  ): string | null {
    const race = this.forker.startRace(branchIds, metric, maxDurationMs);
    if (!race) return null;

    // Broadcast race start
    if (this.sendMessage) {
      const wire: BranchRaceStartWire = {
        raceId: race.id,
        lifeformId: this.lifeformId,
        branchIds: race.branchIds,
        maxDurationMs: race.maxDurationMs,
        minCausesPerBranch: race.minCausesPerBranch,
        fitnessMetric: race.fitnessMetric,
        startedAt: race.startedAt,
      };
      this.sendMessage(SpacetimeMessageType.BRANCH_RACE_START, wire);
    }

    return race.id;
  }

  /**
   * Merge a branch back into trunk.
   * Returns the snapshot for CRDT merge (caller does the actual state merge).
   */
  merge(branchId: string): { snapshot: any; fitness: BranchFitness } | null {
    const result = this.forker.merge(branchId);
    if (!result) return null;

    // Broadcast merge
    if (this.sendMessage) {
      const headHash = this.dag.getHead(branchId)?.hash || '';
      const wire: TimelineMergeWire = {
        sourceBranchId: branchId,
        targetBranchId: 'trunk',
        mergeNodeHash: headHash,
        timestamp: Date.now(),
      };
      this.sendMessage(SpacetimeMessageType.TIMELINE_MERGE, wire);
    }

    return result;
  }

  // ══════════════════════════════════════
  // Archaeology (Historical Queries)
  // ══════════════════════════════════════

  /**
   * Reconstruct the state at a specific point in history.
   * Finds the nearest snapshot and replays from there.
   */
  getHistoricalState(branchId: string, atSequence: number): any | null {
    const snapshot = this.dag.findNearestSnapshot(branchId, atSequence);
    return snapshot?.stateSnapshot || null;
  }

  /**
   * Get the computation timeline for a branch.
   */
  getTimeline(branchId: string, limit?: number): DAGNode[] {
    if (limit) {
      return this.dag.getRecentNodes(branchId, limit);
    }
    return this.dag.getBranchHistory(branchId);
  }

  /**
   * Verify the integrity of a branch's computation history.
   */
  verifyHistory(branchId: string): { valid: boolean; invalidAt?: string } {
    return this.dag.verifyBranch(branchId);
  }

  // ══════════════════════════════════════
  // Message Handling
  // ══════════════════════════════════════

  /**
   * Handle an incoming Layer 12 message from a peer.
   */
  handleMessage(msgType: number, payload: any): void {
    switch (msgType) {
      case SpacetimeMessageType.BRANCH_STATE_SYNC:
        // Could store peer's branch state for cross-device awareness
        break;

      case SpacetimeMessageType.TIMELINE_FORK:
        // Peer forked a timeline — informational
        break;

      case SpacetimeMessageType.BRANCH_RACE_START:
        // Peer started a race — informational
        break;

      case SpacetimeMessageType.BRANCH_METRICS:
        // Peer's branch fitness update
        break;

      case SpacetimeMessageType.TIMELINE_MERGE:
        // Peer merged a branch
        break;

      case SpacetimeMessageType.ARCHAEOLOGY_QUERY: {
        const query = payload as ArchaeologyQueryWire;
        // Respond with requested DAG nodes if we have them
        if (query.nodeHash) {
          const node = this.dag.getNode(query.nodeHash);
          if (node && this.sendMessage) {
            this.sendMessage(SpacetimeMessageType.BRANCH_STATE_SYNC, {
              branchId: node.branchId,
              headHash: node.hash,
              latestNode: node,
            });
          }
        }
        break;
      }
    }
  }

  // ══════════════════════════════════════
  // Status
  // ══════════════════════════════════════

  /** Get comprehensive Layer 12 status */
  getStatus(): SpacetimeStatus {
    const dagInfo = this.dag.getInfo();
    return {
      lifeformId: this.lifeformId,
      dagNodes: dagInfo.totalNodes,
      dagBranches: dagInfo.branchCount,
      totalComputeMs: dagInfo.totalComputeMs,
      totalCcu: dagInfo.totalCcu,
      activeBranches: this.forker.getActiveBranches().map(b => ({
        id: b.id,
        label: b.label,
        length: b.length,
        state: b.state,
        fitness: b.fitness,
      })),
      activeRaces: this.forker.getActiveRaces().length,
      stats: this.forker.getStats(),
    };
  }
}

export interface SpacetimeStatus {
  lifeformId: string;
  dagNodes: number;
  dagBranches: number;
  totalComputeMs: number;
  totalCcu: number;
  activeBranches: any[];
  activeRaces: number;
  stats: any;
}

// ─── Re-exports ───

export { CausalMerkleDAG } from './causal-dag';
export { TemporalForker, TemporalEvent } from './temporal-forker';
