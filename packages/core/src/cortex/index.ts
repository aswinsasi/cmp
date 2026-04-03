/**
 * CMP v3.0 — Mesh Cortex (Layer 14)
 * Distributed neural network inference across mesh devices.
 *
 * @module cortex
 * @author Agent Viscro
 */

export { MeshCortex } from './mesh-cortex';
export type { CortexTransport } from './mesh-cortex';

export { partitionModel, rebalancePartitions } from './partitioner';
export type { DeviceCapacity } from './partitioner';

export { LayerExecutor, defaultLayerFunction } from './layer-executor';
export type { LayerFunction } from './layer-executor';
