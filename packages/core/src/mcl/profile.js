"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMCLProfile = buildMCLProfile;
exports.profileHasExperience = profileHasExperience;
exports.profileToWire = profileToWire;
exports.profileFromWire = profileFromWire;
const bloom_1 = require("./bloom");
/**
 * Build an MCL profile from the local MER store.
 *
 * @param mers - All MERs currently stored on this device
 * @param storageAvailable - Bytes available for MER exchange
 * @returns MCL profile ready for capability exchange
 */
function buildMCLProfile(mers, storageAvailable = 256 * 1024 // 256 KB default
) {
    // Build bloom filter of task types with experience
    const bloom = new bloom_1.BloomFilter();
    const originSet = new Set();
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
        if (ageDays > oldestAge)
            oldestAge = ageDays;
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
function profileHasExperience(profile, taskType) {
    if (profile.merCount === 0)
        return false;
    const bloom = bloom_1.BloomFilter.fromBytes(profile.merCatalogBloom);
    return bloom.test(new Uint8Array([taskType]));
}
/**
 * Convert MCL profile to wire format for JSON serialization.
 */
function profileToWire(profile) {
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
function profileFromWire(wire) {
    return {
        mclVersion: wire.mclVersion,
        merCount: wire.merCount,
        merCatalogBloom: new Uint8Array(wire.merCatalogBloom),
        oldestMerDays: wire.oldestMerDays,
        crossMeshCount: wire.crossMeshCount,
        storageAvailable: wire.storageAvailable,
    };
}
//# sourceMappingURL=profile.js.map