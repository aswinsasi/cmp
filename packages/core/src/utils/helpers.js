"use strict";
/**
 * CMP Utility Functions
 * Byte manipulation, hex encoding, and timing helpers.
 *
 * @module utils
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toHex = toHex;
exports.fromHex = fromHex;
exports.bytesEqual = bytesEqual;
exports.concatBytes = concatBytes;
exports.bigintToBytes = bigintToBytes;
exports.bytesToBigint = bytesToBigint;
exports.now = now;
exports.shortId = shortId;
exports.sleep = sleep;
exports.deferred = deferred;
/**
 * Convert Uint8Array to hex string.
 */
function toHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Convert hex string to Uint8Array.
 */
function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}
/**
 * Compare two Uint8Arrays for equality.
 */
function bytesEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
/**
 * Concatenate multiple Uint8Arrays.
 */
function concatBytes(...arrays) {
    const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}
/**
 * Convert BigInt to 8-byte Uint8Array (big-endian).
 */
function bigintToBytes(value) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setBigUint64(0, value, false);
    return new Uint8Array(buf);
}
/**
 * Convert 8-byte Uint8Array to BigInt (big-endian).
 */
function bytesToBigint(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    return view.getBigUint64(0, false);
}
/**
 * Get current timestamp as BigInt milliseconds.
 */
function now() {
    return BigInt(Date.now());
}
/**
 * Generate a short display ID from a MeshId (first 8 hex chars).
 */
function shortId(meshId) {
    return toHex(meshId).substring(0, 8);
}
/**
 * Sleep for specified milliseconds.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Create a deferred promise (externally resolvable).
 */
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
//# sourceMappingURL=helpers.js.map