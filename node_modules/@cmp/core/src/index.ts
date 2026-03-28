/**
 * CMP Core - Barrel Export
 *
 * Compute Mesh Protocol v1.0
 * Decentralized proximity-based distributed computation.
 *
 * @author Agent Viscro
 * @license MIT
 */

// Types
export * from './types';

// Crypto
export * from './crypto';

// Utilities
export * from './utils/helpers';
export { Logger, LogLevel } from './utils/logger';
export { CMPConfig, DEFAULT_CONFIG, resolveConfig } from './utils/config';

// Mesh
export { EventBus } from './mesh/event-bus';
export type { CMPEvents } from './mesh/event-bus';
export { PeerTable } from './mesh/peer-table';
export type { PeerEntry, PeerState } from './mesh/peer-table';

// Layers
export { encodeBeacon, decodeBeacon, createBeacon, isValidBeacon } from './layers/beacon-codec';
export { encodeMessage, decodeMessage, encodeCapability, decodeCapability, encodeJSON, decodeJSON, resetFrameSequence, getFrameSequence, FRAME_HEADER_SIZE, FRAME_MAX_PAYLOAD } from './layers/serializer';
export type { ChunkDataWire, ChunkResultWire, HeartbeatWire, DepartureNoticeWire, CheckpointStoreWire, FrameFlags } from './layers/serializer';
export { crc32c, verifyCRC32C } from './utils/crc32c';
export { DiscoveryLayer } from './layers/discovery';
export { DeviceProfiler } from './layers/profiler';
export type { ProfilerConfig } from './layers/profiler';
export { CapabilityMap } from './layers/capability-map';
export type { MeshResources, ScoredCandidate } from './layers/capability-map';
export { CapabilityExchange } from './layers/capability-exchange';
export { NegotiationEngine } from './layers/negotiation-engine';
export type { ComputeRequest, NegotiationResult, AssignmentRecord } from './layers/negotiation-engine';
export { BidHandler } from './layers/bid-handler';
export type { BidHandlerConfig } from './layers/bid-handler';

// Incentive
export { IncentiveLedger } from './incentive';
export type { LedgerAccount, LedgerConfig } from './incentive';

// Mesh Cognition Layer (v1.2)
export * from './mcl';

// Node
export { CMPNode } from './cmp-node';
export type { ComputeOptions, ComputeResult, MeshStatus, PeerInfo, CMPNodeConfig } from './cmp-node';