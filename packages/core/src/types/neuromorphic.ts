/**
 * CMP v3.0 — Neuromorphic Routing Type Definitions
 * Spiking neural network routing where task pathways learn from success/failure.
 *
 * Replaces static routing tables with a biological neural model:
 *   - Tasks generate "spikes" that propagate through weighted connections
 *   - Successful paths get reinforced (long-term potentiation)
 *   - Failed paths get weakened (long-term depression)
 *   - The routing topology literally learns over time
 *
 * Combined with Stigmergy (L11):
 *   Stigmergy = global, slow, collective (pheromone trails)
 *   Neuromorphic = local, fast, connection-specific (synaptic weights)
 *
 * @module types/neuromorphic
 * @author Agent Viscro
 */

// ─── Spike ───

export interface Spike {
  /** Unique spike ID */
  id: string;
  /** Node that generated this spike */
  sourceNode: string;
  /** Task type that triggered the spike */
  taskType: string;
  /** Energy level (0.0-1.0), decays with each hop */
  energy: number;
  /** Timestamp of spike generation */
  timestamp: number;
  /** Nodes visited (path trace) */
  path: string[];
  /** Original task ID this spike is routing */
  taskId: string;
}

// ─── Synaptic Weight ───

export interface SynapticWeight {
  /** Source node (presynaptic) */
  from: string;
  /** Target node (postsynaptic) */
  to: string;
  /** Connection weight (0.0-1.0) */
  weight: number;
  /** Last time this connection fired */
  lastFired: number;
  /** Cumulative successful task completions through this connection */
  successCount: number;
  /** Cumulative failures through this connection */
  failureCount: number;
  /** Task types this connection has been used for */
  taskTypes: Set<string>;
}

// ─── Router Configuration ───

export interface NeuromorphicConfig {
  /** Minimum weight to consider a connection active (default: 0.05) */
  activationThreshold: number;
  /** Learning rate for reinforcement (default: 0.1) */
  learningRate: number;
  /** Weight decay per decay cycle (default: 0.01) */
  decayRate: number;
  /** Spike energy decay per hop (default: 0.15) */
  spikeDecayPerHop: number;
  /** Max hops before spike dies (default: 10) */
  maxHops: number;
  /** Initial weight for new connections (default: 0.5) */
  initialWeight: number;
  /** STDP time window in ms (default: 100) */
  stdpWindowMs: number;
  /** Decay interval in ms (default: 60000) */
  decayIntervalMs: number;
  /** Exploration factor: probability of taking a random path (default: 0.1) */
  explorationRate: number;
}

export const DEFAULT_NEUROMORPHIC_CONFIG: NeuromorphicConfig = {
  activationThreshold: 0.05,
  learningRate: 0.1,
  decayRate: 0.01,
  spikeDecayPerHop: 0.15,
  maxHops: 10,
  initialWeight: 0.5,
  stdpWindowMs: 100,
  decayIntervalMs: 60000,
  explorationRate: 0.1,
};

// ─── Route Result ───

export interface RouteResult {
  /** Ordered list of node IDs forming the route */
  path: string[];
  /** Total weight of the route (product of connection weights) */
  totalWeight: number;
  /** Whether exploration (random) was used */
  explored: boolean;
  /** Time taken to compute route in ms */
  routingMs: number;
}

// ─── Network Topology Snapshot ───

export interface NetworkTopology {
  /** All nodes in the network */
  nodes: string[];
  /** All active connections with weights */
  connections: Array<{
    from: string;
    to: string;
    weight: number;
    successRate: number;
  }>;
  /** Strongest pathway per task type */
  dominantPaths: Map<string, string[]>;
  /** Total connections */
  totalConnections: number;
  /** Average weight */
  avgWeight: number;
}

// ─── Learning Event ───

export interface LearningEvent {
  type: 'ltp' | 'ltd' | 'stdp' | 'decay';
  path: string[];
  taskType: string;
  weightDelta: number;
  timestamp: number;
}
