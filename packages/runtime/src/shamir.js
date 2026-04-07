"use strict";
/**
 * Shamir's Secret Sharing over GF(256)
 * Information-theoretically secure (k, n) threshold secret sharing.
 *
 * Properties:
 *   - Any k shares can reconstruct the secret (threshold)
 *   - Any k-1 shares reveal ZERO information about the secret
 *   - Shares are same size as the secret (no expansion)
 *   - Works byte-by-byte: each byte gets its own random polynomial
 *
 * Algorithm:
 *   Split: For each byte of the secret, create a random polynomial
 *          f(x) of degree k-1 where f(0) = secret_byte.
 *          Share_i = (x_i, f(x_i)) for x_i = 1, 2, ..., n.
 *
 *   Reconstruct: Given k or more shares, use Lagrange interpolation
 *                at x=0 to recover each secret byte.
 *
 * @module runtime/shamir
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shamirSplit = shamirSplit;
exports.shamirReconstruct = shamirReconstruct;
exports.shamirVerify = shamirVerify;
exports.sharesToWire = sharesToWire;
exports.sharesFromWire = sharesFromWire;
const src_1 = require("../../core/src");
const gf256_1 = require("./gf256");
/**
 * Split a secret into n shares with threshold k.
 *
 * @param secret - The secret data to split
 * @param n - Total number of shares to create (2-255)
 * @param k - Threshold: minimum shares needed to reconstruct (2-n)
 * @returns Array of n ShamirShares
 *
 * @throws If n < 2, k < 2, k > n, or n > 255
 */
function shamirSplit(secret, n, k) {
    // Validate parameters
    if (n < 2 || n > 255)
        throw new Error(`n must be 2-255, got ${n}`);
    if (k < 2)
        throw new Error(`k must be >= 2, got ${k}`);
    if (k > n)
        throw new Error(`k must be <= n, got k=${k} n=${n}`);
    const secretLen = secret.length;
    // Pre-allocate shares
    const shares = [];
    for (let i = 0; i < n; i++) {
        shares.push({
            x: i + 1, // x-coordinates: 1, 2, ..., n (never 0, that's the secret)
            data: new Uint8Array(secretLen),
        });
    }
    // For each byte of the secret, create a random polynomial and evaluate at each x
    for (let byteIdx = 0; byteIdx < secretLen; byteIdx++) {
        // Build polynomial: coefficients[0] = secret byte, rest are random
        // Degree = k-1, so k coefficients total
        const poly = new Uint8Array(k);
        poly[0] = secret[byteIdx]; // f(0) = secret
        // Random coefficients for x^1 through x^(k-1)
        const randomCoeffs = (0, src_1.randomBytes)(k - 1);
        for (let c = 1; c < k; c++) {
            poly[c] = randomCoeffs[c - 1];
            // Ensure leading coefficient is non-zero (otherwise degree < k-1)
            if (c === k - 1 && poly[c] === 0) {
                poly[c] = 1;
            }
        }
        // Evaluate polynomial at each share's x-coordinate
        for (let i = 0; i < n; i++) {
            shares[i].data[byteIdx] = (0, gf256_1.gfPolyEval)(poly, shares[i].x);
        }
    }
    return shares;
}
/**
 * Reconstruct the secret from k or more shares.
 *
 * @param shares - At least k shares from shamirSplit()
 * @returns The reconstructed secret
 *
 * @throws If shares array is empty or shares have different lengths
 */
function shamirReconstruct(shares) {
    if (shares.length === 0)
        throw new Error('Need at least 1 share');
    const dataLen = shares[0].data.length;
    for (const share of shares) {
        if (share.data.length !== dataLen) {
            throw new Error('All shares must have same data length');
        }
    }
    const result = new Uint8Array(dataLen);
    // Extract x-coordinates
    const xs = new Uint8Array(shares.length);
    for (let i = 0; i < shares.length; i++) {
        xs[i] = shares[i].x;
    }
    // Reconstruct each byte using Lagrange interpolation at x=0
    const ys = new Uint8Array(shares.length);
    for (let byteIdx = 0; byteIdx < dataLen; byteIdx++) {
        for (let i = 0; i < shares.length; i++) {
            ys[i] = shares[i].data[byteIdx];
        }
        result[byteIdx] = (0, gf256_1.lagrangeInterpolateAt0)(xs, ys);
    }
    return result;
}
/**
 * Verify that a set of shares can reconstruct to a known secret.
 * Useful for testing and validation.
 *
 * @param shares - Shares to verify
 * @param expectedSecret - Expected secret after reconstruction
 * @returns true if reconstruction matches expected secret
 */
function shamirVerify(shares, expectedSecret) {
    try {
        const reconstructed = shamirReconstruct(shares);
        if (reconstructed.length !== expectedSecret.length)
            return false;
        for (let i = 0; i < reconstructed.length; i++) {
            if (reconstructed[i] !== expectedSecret[i])
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Convert ShamirShares to a wire-safe format (JSON-serializable).
 */
function sharesToWire(shares) {
    return shares.map(s => ({ x: s.x, data: Array.from(s.data) }));
}
/**
 * Reconstruct ShamirShares from wire format.
 */
function sharesFromWire(wire) {
    return wire.map(w => ({ x: w.x, data: new Uint8Array(w.data) }));
}
//# sourceMappingURL=shamir.js.map