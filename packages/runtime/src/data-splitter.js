"use strict";
/**
 * CMP Data Splitter
 * Implements Shamir's Secret Sharing for CONFIDENTIAL tasks (v1.2).
 * No single executor can reconstruct the full input.
 *
 * v1.0: XOR-based additive sharing (n-of-n, all shares required)
 * v1.2: Shamir's SSS over GF(256) (k-of-n threshold, fault tolerant)
 *
 * The threshold k defaults to ceil(n/2)+1, providing:
 *   - Majority of executors can reconstruct (fault tolerance)
 *   - Minority cannot learn anything (privacy)
 *
 * For non-confidential tasks, splitParallel() simply divides data
 * into equal-sized chunks (no secret sharing involved).
 *
 * @module runtime/data-splitter
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataSplitter = void 0;
const src_1 = require("../../core/src");
const shamir_1 = require("./shamir");
class DataSplitter {
    /**
     * Split data into N shares using Shamir's Secret Sharing (v1.2).
     * Any k shares can reconstruct. k-1 shares reveal nothing.
     *
     * Default threshold: ceil(n/2) + 1 (majority required)
     *
     * @param data - Original data
     * @param numShares - Number of shares (typically = number of executors)
     * @param threshold - Minimum shares to reconstruct (default: ceil(n/2)+1)
     * @returns Array of N shares, each same length as data
     */
    split(data, numShares, threshold) {
        if (numShares < 2) {
            return [new Uint8Array(data)];
        }
        // Clamp to GF(256) max: 255 shares
        const n = Math.min(numShares, 255);
        const k = threshold ?? Math.ceil(n / 2) + 1;
        const shamirShares = (0, shamir_1.shamirSplit)(data, n, Math.min(k, n));
        return shamirShares.map(s => s.data);
    }
    /**
     * Split data and return full metadata (including x-coordinates).
     * Use this when you need to track which share belongs to which executor.
     *
     * @param data - Original data
     * @param numShares - Number of shares
     * @param threshold - Minimum shares to reconstruct
     * @returns SplitResult with shares, x-coordinates, and threshold
     */
    splitWithMetadata(data, numShares, threshold) {
        if (numShares < 2) {
            return { shares: [new Uint8Array(data)], scheme: 'shamir' };
        }
        const n = Math.min(numShares, 255);
        const k = threshold ?? Math.ceil(n / 2) + 1;
        const shamirShares = (0, shamir_1.shamirSplit)(data, n, Math.min(k, n));
        return {
            shares: shamirShares.map(s => s.data),
            xCoordinates: shamirShares.map(s => s.x),
            threshold: Math.min(k, n),
            scheme: 'shamir',
        };
    }
    /**
     * Reconstruct original data from Shamir shares.
     * Requires at least k shares (the threshold from split).
     *
     * @param shares - Share data arrays
     * @param xCoordinates - x-coordinates for each share (1-based)
     * @returns Original data
     */
    reconstruct(shares, xCoordinates) {
        if (shares.length === 0)
            return new Uint8Array(0);
        if (shares.length === 1)
            return new Uint8Array(shares[0]);
        // If x-coordinates provided, use Shamir reconstruction
        if (xCoordinates && xCoordinates.length === shares.length) {
            const shamirShares = shares.map((data, i) => ({
                x: xCoordinates[i],
                data,
            }));
            return (0, shamir_1.shamirReconstruct)(shamirShares);
        }
        // Fallback: assume sequential x-coordinates (1, 2, ..., n)
        const shamirShares = shares.map((data, i) => ({
            x: i + 1,
            data,
        }));
        return (0, shamir_1.shamirReconstruct)(shamirShares);
    }
    /**
     * Legacy XOR-based split (v1.0 compatibility).
     * All N shares are required for reconstruction — no fault tolerance.
     *
     * @param data - Original data
     * @param numShares - Number of shares
     * @returns Array of N shares
     */
    splitXOR(data, numShares) {
        if (numShares < 2) {
            return [new Uint8Array(data)];
        }
        const shares = [];
        // Generate N-1 random shares
        for (let i = 0; i < numShares - 1; i++) {
            shares.push((0, src_1.randomBytes)(data.length));
        }
        // Last share = data XOR all other shares
        const lastShare = new Uint8Array(data.length);
        for (let byte = 0; byte < data.length; byte++) {
            let xored = data[byte];
            for (const share of shares) {
                xored ^= share[byte];
            }
            lastShare[byte] = xored;
        }
        shares.push(lastShare);
        return shares;
    }
    /**
     * Legacy XOR reconstruction (v1.0 compatibility).
     * All shares must be provided.
     */
    reconstructXOR(shares) {
        if (shares.length === 0)
            return new Uint8Array(0);
        if (shares.length === 1)
            return new Uint8Array(shares[0]);
        const result = new Uint8Array(shares[0].length);
        for (let byte = 0; byte < result.length; byte++) {
            let xored = 0;
            for (const share of shares) {
                xored ^= share[byte];
            }
            result[byte] = xored;
        }
        return result;
    }
    /**
     * Split data into equal-sized chunks for data-parallel distribution.
     * Not secret sharing — each chunk is a slice of the original data.
     *
     * @param data - Original data
     * @param numChunks - Number of chunks
     * @returns Array of chunks (last chunk may be smaller)
     */
    splitParallel(data, numChunks) {
        if (numChunks <= 1)
            return [new Uint8Array(data)];
        const chunkSize = Math.ceil(data.length / numChunks);
        const chunks = [];
        for (let i = 0; i < numChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, data.length);
            if (start < data.length) {
                chunks.push(data.slice(start, end));
            }
        }
        return chunks;
    }
    /**
     * Reassemble data-parallel chunks back into original data.
     */
    reassembleParallel(chunks) {
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }
}
exports.DataSplitter = DataSplitter;
//# sourceMappingURL=data-splitter.js.map