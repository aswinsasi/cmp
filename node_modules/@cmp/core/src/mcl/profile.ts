/**
 * CMP MCL Profile
 * Builds the MCL capability profile that is exchanged during
 * mesh formation, advertising this device's learning capabilities
 * and available experience.
 *
 * The profile includes a bloom filter of task types with experience,
 * allowing peers to efficiently discover relevant MERs without
 * enumerating the entire MER store.
 *
 * @module mcl/profile
 * @author Agent Viscro
 */

import type { CMP_MCL_PROFILE, CMP_MER } from '../types/mcl';
import { BloomFilter } from './bloom';

/**
 * Build an MCL profile from the local MER store.
 *
 * @param mers - All MERs currently stored on this device
 * @param storageAvailable - Bytes available for MER exchange
 * @returns MCL profile ready for capability exchange
 */
export function buildMCLProfile(
  mers: CMP_MER[],
  storageAvailable: number = 256 * 1024 // 256 KB default
): CMP_MCL_PROFILE {
  // Build bloom filter of task types with experience
  const bloom = new BloomFilter();
  const originSet = new Set<string>();
  let oldestAge = 0;

  for (const mer of mers) {
    // Add task type to bloom filter (as single byte)
    bloom.add(new Uint8Array([mer.taskType]));

    // Track distinct origin meshes
    const originHex = Array.from(mer.originMeshHash)
      .map(b => b.toString(16).padStart(2, '0')).join('');
    originSet.add(originHex);

    // Track oldest MER age
    const ageDays = Math.floor((Date.now() - mer.createdAt) / (24 * 60 * 60 * 1000));
    if (ageDays > oldestAge) oldestAge = ageDays;
  }

  return {
    mclVersion: 1,
    merCount: mers.length,
    merCatalogBloom: bloom.toBytes(),
    oldestMerDays: oldestAge,
    crossMeshCount: originSet.size,
    storageAvailable,
  };
}

/**
 * Check if a peer's MCL profile indicates experience with a given task type.
 * Uses the bloom filter for efficient probabilistic matching.
 *
 * @param profile - Peer's MCL profile
 * @param taskType - Task type to check
 * @returns true if the peer probably has experience (may be false positive)
 */
export function profileHasExperience(
  profile: CMP_MCL_PROFILE,
  taskType: number
): boolean {
  if (profile.merCount === 0) return false;
  const bloom = BloomFilter.fromBytes(profile.merCatalogBloom);
  return bloom.test(new Uint8Array([taskType]));
}

/**
 * Convert MCL profile to wire format for JSON serialization.
 */
export function profileToWire(profile: CMP_MCL_PROFILE): any {
  return {
    mclVersion: profile.mclVersion,
    merCount: profile.merCount,
    merCatalogBloom: Array.from(profile.merCatalogBloom),
    oldestMerDays: profile.oldestMerDays,
    crossMeshCount: profile.crossMeshCount,
    storageAvailable: profile.storageAvailable,
  };
}

/**
 * Reconstruct MCL profile from wire format.
 */
export function profileFromWire(wire: any): CMP_MCL_PROFILE {
  return {
    mclVersion: wire.mclVersion,
    merCount: wire.merCount,
    merCatalogBloom: new Uint8Array(wire.merCatalogBloom),
    oldestMerDays: wire.oldestMerDays,
    crossMeshCount: wire.crossMeshCount,
    storageAvailable: wire.storageAvailable,
  };
}
