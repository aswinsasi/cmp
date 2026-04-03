/**
 * CMP v3.0 — Mesh GPU (Layer 16)
 * GPU compute sharing across P2P mesh.
 *
 * @module gpu
 * @author Agent Viscro
 */

export { MeshGPU } from './mesh-gpu';
export type { MeshGPUTransport, GPUPeerInfo } from './mesh-gpu';

export { GPUExecutor } from './executor';
export type { CPUKernel } from './executor';
