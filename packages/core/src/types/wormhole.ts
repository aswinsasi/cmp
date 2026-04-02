/**
 * CMP v2.0 — Layer 13: Cross-Mesh Wormholes Types
 *
 * Bridge separate meshes. Teleport Lifeforms across reality boundaries.
 *
 * When a device has both mesh connectivity AND internet, it becomes
 * a wormhole node bridging two separate physical meshes. Lifeforms
 * can be teleported between meshes with full state, causal history,
 * and economic balance preserved.
 *
 * Wire Protocol: 0xEC-0xF1
 *
 * @module types/wormhole
 * @author Agent Viscro
 */

// ═══════════════════════════════════════
// Wire Protocol Messages (0xEC-0xF1)
// ═══════════════════════════════════════

export enum WormholeMessageType {
  /** This node can bridge to a remote mesh */
  WORMHOLE_ANNOUNCE = 0xEC,
  /** Directory of known remote meshes */
  WORMHOLE_DIRECTORY = 0xED,
  /** Initiate lifeform teleportation */
  TELEPORT_INITIATE = 0xEE,
  /** Teleportation payload (soul + state + history) */
  TELEPORT_PAYLOAD = 0xEF,
  /** Teleportation acknowledged by destination */
  TELEPORT_ACK = 0xF0,
  /** Cross-mesh synapse relay */
  CROSS_SYNAPSE_RELAY = 0xF1,
}

// ═══════════════════════════════════════
// Wormhole Node
// ═══════════════════════════════════════

/** A device that can bridge two meshes */
export interface WormholeNode {
  /** Device mesh ID (hex) in the local mesh */
  localMeshId: string;
  /** Remote mesh fingerprint this wormhole connects to */
  remoteMeshFingerprint: string;
  /** Human-readable label for the remote mesh */
  remoteMeshLabel: string;
  /** Wormhole quality (0.0-1.0 based on latency, bandwidth) */
  quality: number;
  /** Estimated latency to remote mesh (ms) */
  latencyMs: number;
  /** When this wormhole was discovered */
  discoveredAt: number;
  /** Last heartbeat from this wormhole */
  lastSeenAt: number;
  /** Whether the wormhole is currently active */
  active: boolean;
}

/** Wire format for WORMHOLE_ANNOUNCE */
export interface WormholeAnnounceWire {
  localMeshId: string;
  remoteMeshFingerprint: string;
  remoteMeshLabel: string;
  quality: number;
  latencyMs: number;
  /** Bloom filter of capability types available on remote mesh */
  capabilityBloom: number[];
  timestamp: number;
}

// ═══════════════════════════════════════
// Mesh Directory
// ═══════════════════════════════════════

/** A known remote mesh */
export interface RemoteMeshEntry {
  /** Unique fingerprint of the remote mesh */
  fingerprint: string;
  /** Human-readable label */
  label: string;
  /** Wormhole nodes that can reach this mesh */
  wormholeNodes: string[];
  /** Estimated capability summary */
  estimatedPeers: number;
  /** Best latency through any wormhole (ms) */
  bestLatencyMs: number;
  /** Bloom filter of capabilities */
  capabilityBloom: number[];
  /** When first discovered */
  firstSeen: number;
  /** Last updated */
  lastUpdated: number;
}

/** Wire format for WORMHOLE_DIRECTORY */
export interface WormholeDirectoryWire {
  entries: {
    fingerprint: string;
    label: string;
    estimatedPeers: number;
    bestLatencyMs: number;
    capabilityBloom: number[];
  }[];
  senderId: string;
  timestamp: number;
}

// ═══════════════════════════════════════
// Lifeform Teleportation
// ═══════════════════════════════════════

/** Teleportation request */
export interface TeleportRequest {
  /** Unique teleport ID */
  id: string;
  /** Lifeform being teleported */
  lifeformName: string;
  lifeformId: string;
  /** Source mesh fingerprint */
  sourceMeshFingerprint: string;
  /** Destination mesh fingerprint */
  destMeshFingerprint: string;
  /** Wormhole node relaying the teleport */
  wormholeNodeId: string;
  /** Reason for teleportation */
  reason: TeleportReason;
  /** State */
  state: TeleportState;
  /** Timestamps */
  initiatedAt: number;
  completedAt?: number;
}

export enum TeleportReason {
  /** User-initiated move */
  MANUAL = 'manual',
  /** Better resources on remote mesh */
  RESOURCE_SEEKING = 'resource_seeking',
  /** Following a cross-mesh synapse partner */
  SYNAPSE_FOLLOW = 'synapse_follow',
  /** Load balancing across meshes */
  LOAD_BALANCE = 'load_balance',
  /** Escaping a degraded local mesh */
  ESCAPE = 'escape',
}

export enum TeleportState {
  /** Teleport initiated, preparing payload */
  PREPARING = 'preparing',
  /** Payload being transmitted through wormhole */
  IN_TRANSIT = 'in_transit',
  /** Destination mesh received and is reconstituting */
  RECONSTITUTING = 'reconstituting',
  /** Teleport complete, Lifeform alive on destination */
  COMPLETE = 'complete',
  /** Teleport failed */
  FAILED = 'failed',
}

/** The full payload transmitted during teleportation */
export interface TeleportPayload {
  /** Teleport ID */
  teleportId: string;
  /** Full soul (identity, keys, generation) */
  soul: {
    id: string;
    name: string;
    publicKey: string;
    secretKey: string;
    creatorId: string;
    bornAt: number;
    generation: number;
    parentId: string | null;
  };
  /** CRDT state snapshot */
  stateSnapshot: any;
  /** WASM genome binary (base64) */
  wasmModuleB64: string;
  /** CCU balance */
  ccuBalance: number;
  /** Synapse connections (for cross-mesh relay setup) */
  synapses: {
    targetName: string;
    targetMeshFingerprint: string;
    weight: number;
  }[];
  /** Causal DAG summary (recent history) */
  dagSummary: {
    branchId: string;
    headHash: string;
    recentNodes: number;
    totalCcu: number;
    totalComputeMs: number;
  };
  /** Intent contracts to preserve */
  intents: any[];
  /** Source mesh fingerprint */
  sourceMeshFingerprint: string;
  /** Timestamp */
  timestamp: number;
}

/** Wire format for TELEPORT_INITIATE */
export interface TeleportInitiateWire {
  teleportId: string;
  lifeformName: string;
  lifeformId: string;
  sourceMeshFingerprint: string;
  destMeshFingerprint: string;
  reason: TeleportReason;
  payloadSizeEstimate: number;
  timestamp: number;
}

/** Wire format for TELEPORT_ACK */
export interface TeleportAckWire {
  teleportId: string;
  success: boolean;
  newHostId?: string;
  error?: string;
  timestamp: number;
}

// ═══════════════════════════════════════
// Cross-Mesh Synapse
// ═══════════════════════════════════════

/** A synapse that spans two meshes via a wormhole */
export interface CrossMeshSynapse {
  /** Synapse ID */
  id: string;
  /** Local Lifeform name */
  localLifeformName: string;
  /** Remote Lifeform name */
  remoteLifeformName: string;
  /** Remote mesh fingerprint */
  remoteMeshFingerprint: string;
  /** Wormhole node relaying signals */
  wormholeNodeId: string;
  /** Synapse weight (Hebbian) */
  weight: number;
  /** Signal count */
  signalCount: number;
  /** Created at */
  createdAt: number;
  /** Last signal */
  lastSignalAt: number;
}

/** Wire format for CROSS_SYNAPSE_RELAY */
export interface CrossSynapseRelayWire {
  synapseId: string;
  fromLifeform: string;
  toLifeform: string;
  fromMeshFingerprint: string;
  toMeshFingerprint: string;
  payload: string;
  weight: number;
  timestamp: number;
}

// ═══════════════════════════════════════
// Configuration
// ═══════════════════════════════════════

export interface WormholeConfig {
  /** How often to announce wormhole capability (ms, default: 15000) */
  announceIntervalMs: number;
  /** Wormhole node timeout (ms, default: 45000) */
  wormholeTimeoutMs: number;
  /** Max remote meshes to track (default: 20) */
  maxRemoteMeshes: number;
  /** Max active teleports simultaneously (default: 3) */
  maxActiveTeleports: number;
  /** Teleport timeout (ms, default: 30000) */
  teleportTimeoutMs: number;
  /** Max cross-mesh synapses per Lifeform (default: 10) */
  maxCrossSynapses: number;
  /** Bloom filter size for capability advertisement (bits, default: 256) */
  bloomFilterSize: number;
  /** Minimum wormhole quality to use (default: 0.3) */
  minWormholeQuality: number;
}

export const DEFAULT_WORMHOLE_CONFIG: WormholeConfig = {
  announceIntervalMs: 15000,
  wormholeTimeoutMs: 45000,
  maxRemoteMeshes: 20,
  maxActiveTeleports: 3,
  teleportTimeoutMs: 30000,
  maxCrossSynapses: 10,
  bloomFilterSize: 256,
  minWormholeQuality: 0.3,
};
