/**
 * CMP v3.0 — Holographic State (Layer 15)
 * Erasure-coded distributed shared memory.
 *
 * @module holographic
 * @author Agent Viscro
 */

export { MeshMemory } from './mesh-memory';
export type { MeshMemoryPeer, MeshMemoryTransport } from './mesh-memory';

export {
  rsEncode,
  rsDecode,
  calculateShardCounts,
  simpleHash,
  verifyShard,
} from './erasure';
export type { ErasureConfig } from './erasure';
