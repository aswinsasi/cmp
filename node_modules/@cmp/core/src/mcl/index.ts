/**
 * CMP Mesh Cognition Layer - Barrel Export
 * Layer 8: Distributed learning through device mobility.
 *
 * @module mcl
 * @author Agent Viscro
 */

export { BloomFilter, BLOOM_BYTES } from './bloom';
export {
  createMER, verifyMER, isMERExpired, merDHTKey,
  merToWire, merFromWire,
} from './mer';
export type { MERCreateParams } from './mer';
export {
  buildMCLProfile, profileHasExperience,
  profileToWire, profileFromWire,
} from './profile';
export {
  xorDistance, compareDistance, closestNodes,
  replicationTargets, createDHTNode,
  DHT_REPLICATION,
} from './dht';
export type { DHTNode } from './dht';
export {
  MERStore, DEFAULT_MER_STORE_CONFIG,
} from './dmm';
export type { MERStoreConfig, MERQueryResult } from './dmm';
export { Pollinator } from './pollinator';
export type { PollinationStats } from './pollinator';
export { evolveParams, didOutperform, efficiencyEMA } from './evolution';
export type { EvolvedParams } from './evolution';
export {
  generateHint, applyHint,
  hintToWire, hintFromWire,
} from './hints';
export { MCLEngine } from './engine';
export type { TaskCompletionData } from './engine';
export { SQLiteMERPersistence } from './persistence';
export type { IMERPersistence } from './persistence';
