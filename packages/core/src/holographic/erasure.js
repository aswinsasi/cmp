"use strict";
/**
 * CMP v3.0 — Reed-Solomon Erasure Coding
 * Encode data into n shards such that any k shards can reconstruct the original.
 *
 * Built on CMP's existing GF(256) arithmetic (packages/runtime/src/gf256.ts).
 *
 * Algorithm:
 *   ENCODE: Treat each byte position across k data shards as k points
 *           on a polynomial. Evaluate the polynomial at n-k additional
 *           points to produce parity shards.
 *
 *   DECODE: Given any k shards (data or parity), use Lagrange interpolation
 *           at the original k evaluation points to recover the data shards.
 *
 * Evaluation points:
 *   Data shards use x = 1, 2, ..., k
 *   Parity shards use x = k+1, k+2, ..., n
 *   (All non-zero, distinct values in GF(256))
 *
 * @module holographic/erasure
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalShards = totalShards;
exports.rsEncode = rsEncode;
exports.rsDecode = rsDecode;
exports.calculateShardCounts = calculateShardCounts;
exports.verifyShard = verifyShard;
exports.simpleHash = simpleHash;
const gf256_1 = require("../../../runtime/src/gf256");
/** Total shards = dataShards + parityShards */
function totalShards(config) {
    return config.dataShards + config.parityShards;
}
// ─── Encode ───
/**
 * Encode data into n shards (k data + m parity) using Reed-Solomon.
 *
 * @param data - Original data bytes
 * @param k - Number of data shards
 * @param m - Number of parity shards (total n = k + m)
 * @returns Array of n shards, each of equal length
 */
function rsEncode(data, k, m) {
    if (k < 1)
        throw new Error('k must be >= 1');
    if (m < 0)
        throw new Error('m must be >= 0');
    if (k + m > 254)
        throw new Error('Total shards must be <= 254 (GF(256) limit)');
    const n = k + m;
    // Pad data to be evenly divisible by k
    const shardLen = Math.ceil(data.length / k);
    const padded = new Uint8Array(shardLen * k);
    padded.set(data, 0);
    // Split into k data shards
    const shards = [];
    for (let i = 0; i < k; i++) {
        shards.push(padded.slice(i * shardLen, (i + 1) * shardLen));
    }
    // Generate m parity shards
    // For each byte position, the k data values define a degree-(k-1) polynomial.
    // Evaluate it at x = k+1, k+2, ..., n to get parity.
    for (let p = 0; p < m; p++) {
        const parityShard = new Uint8Array(shardLen);
        const x = k + p + 1; // evaluation point for this parity shard
        for (let bytePos = 0; bytePos < shardLen; bytePos++) {
            // Build polynomial coefficients from data values at this byte position
            // The k data shards give us points (1, d0), (2, d1), ..., (k, dk-1)
            // We need to interpolate and evaluate at x
            // Collect y-values from data shards
            const ys = new Uint8Array(k);
            for (let i = 0; i < k; i++) {
                ys[i] = shards[i][bytePos];
            }
            // Lagrange interpolation: evaluate polynomial at x
            parityShard[bytePos] = lagrangeEval(k, ys, x);
        }
        shards.push(parityShard);
    }
    return shards;
}
// ─── Decode ───
/**
 * Reconstruct original data from any k shards out of n.
 *
 * @param shardEntries - Array of { index, data } where index is the original shard position (0-based)
 * @param k - Number of data shards
 * @param n - Total shards
 * @param originalSize - Original data size before padding
 * @returns Reconstructed original data
 */
function rsDecode(shardEntries, k, n, originalSize) {
    if (shardEntries.length < k) {
        throw new Error(`Need at least ${k} shards, got ${shardEntries.length}`);
    }
    // Use exactly k shards
    const used = shardEntries.slice(0, k);
    const shardLen = used[0].data.length;
    // Evaluation points: shard at original index i was evaluated at x = i + 1
    const xs = new Uint8Array(k);
    for (let i = 0; i < k; i++) {
        xs[i] = used[i].index + 1;
    }
    // Reconstruct each data shard by interpolating at the data points x = 1..k
    const reconstructed = new Uint8Array(shardLen * k);
    for (let bytePos = 0; bytePos < shardLen; bytePos++) {
        // Collect y-values at this byte position from available shards
        const ys = new Uint8Array(k);
        for (let i = 0; i < k; i++) {
            ys[i] = used[i].data[bytePos];
        }
        // Interpolate at each data point x = 1, 2, ..., k
        for (let d = 0; d < k; d++) {
            const targetX = d + 1; // data shard d was at x = d + 1
            reconstructed[d * shardLen + bytePos] = lagrangeEvalAtPoint(xs, ys, targetX);
        }
    }
    // Trim to original size
    return reconstructed.slice(0, originalSize);
}
// ─── Lagrange Interpolation Helpers ───
/**
 * Evaluate the polynomial defined by k data points at evaluation point x.
 * Data points are at x = 1, 2, ..., k with values ys[0], ys[1], ..., ys[k-1].
 */
function lagrangeEval(k, ys, x) {
    // Build xs: [1, 2, ..., k]
    const xs = new Uint8Array(k);
    for (let i = 0; i < k; i++)
        xs[i] = i + 1;
    return lagrangeEvalAtPoint(xs, ys, x);
}
/**
 * General Lagrange interpolation: given points (xs[i], ys[i]),
 * evaluate the interpolating polynomial at targetX.
 */
function lagrangeEvalAtPoint(xs, ys, targetX) {
    const k = xs.length;
    let result = 0;
    for (let i = 0; i < k; i++) {
        // Compute Lagrange basis L_i(targetX) = prod_{j!=i} (targetX - xs[j]) / (xs[i] - xs[j])
        let num = 1;
        let den = 1;
        for (let j = 0; j < k; j++) {
            if (i === j)
                continue;
            num = (0, gf256_1.gfMul)(num, (0, gf256_1.gfSub)(targetX, xs[j]));
            den = (0, gf256_1.gfMul)(den, (0, gf256_1.gfSub)(xs[i], xs[j]));
        }
        const basis = (0, gf256_1.gfDiv)(num, den);
        result = (0, gf256_1.gfAdd)(result, (0, gf256_1.gfMul)(ys[i], basis));
    }
    return result;
}
// ─── Convenience ───
/**
 * Calculate shard count from redundancy factor.
 * redundancy = n / k. e.g., 1.5 means k=2, n=3.
 */
function calculateShardCounts(dataSize, maxShardSize, redundancy) {
    // k = number of data shards = ceil(dataSize / maxShardSize)
    const k = Math.max(1, Math.ceil(dataSize / maxShardSize));
    // n = ceil(k * redundancy)
    const n = Math.max(k + 1, Math.ceil(k * redundancy));
    const m = n - k;
    const shardSize = Math.ceil(dataSize / k);
    return { k, m, shardSize };
}
/**
 * Verify a shard's checksum.
 */
function verifyShard(data, expectedChecksum) {
    const actual = simpleHash(data);
    if (actual.length !== expectedChecksum.length)
        return false;
    for (let i = 0; i < actual.length; i++) {
        if (actual[i] !== expectedChecksum[i])
            return false;
    }
    return true;
}
/**
 * Simple hash for shard integrity (not crypto-strength, just integrity check).
 * Uses FNV-1a variant producing 4 bytes.
 */
function simpleHash(data) {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < data.length; i++) {
        h ^= data[i];
        h = Math.imul(h, 0x01000193); // FNV prime
    }
    const out = new Uint8Array(4);
    out[0] = (h >>> 24) & 0xFF;
    out[1] = (h >>> 16) & 0xFF;
    out[2] = (h >>> 8) & 0xFF;
    out[3] = h & 0xFF;
    return out;
}
//# sourceMappingURL=erasure.js.map