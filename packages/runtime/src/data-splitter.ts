/**
 * CMP Data Splitter
 * Implements additive secret sharing for CONFIDENTIAL tasks.
 * No single executor can reconstruct the full input.
 *
 * @module runtime/data-splitter
 * @author Agent Viscro
 */

import { randomBytes } from '../../core/src';

export class DataSplitter {
  /**
   * Split data into N shares using XOR-based additive secret sharing.
   * XOR of all shares = original data.
   * Any subset of N-1 shares reveals nothing about the original.
   *
   * @param data - Original data
   * @param numShares - Number of shares (typically = number of executors)
   * @returns Array of N shares, each same length as data
   */
  split(data: Uint8Array, numShares: number): Uint8Array[] {
    if (numShares < 2) {
      return [new Uint8Array(data)];
    }

    const shares: Uint8Array[] = [];

    // Generate N-1 random shares
    for (let i = 0; i < numShares - 1; i++) {
      shares.push(randomBytes(data.length));
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
   * Reconstruct original data from all shares.
   * All shares must be provided; missing any one makes reconstruction impossible.
   *
   * @param shares - All N shares from split()
   * @returns Original data
   */
  reconstruct(shares: Uint8Array[]): Uint8Array {
    if (shares.length === 0) return new Uint8Array(0);
    if (shares.length === 1) return new Uint8Array(shares[0]);

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
  splitParallel(data: Uint8Array, numChunks: number): Uint8Array[] {
    if (numChunks <= 1) return [new Uint8Array(data)];

    const chunkSize = Math.ceil(data.length / numChunks);
    const chunks: Uint8Array[] = [];

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
  reassembleParallel(chunks: Uint8Array[]): Uint8Array {
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
