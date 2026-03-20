/**
 * CMP Utility Functions
 * Byte manipulation, hex encoding, and timing helpers.
 *
 * @module utils
 * @author Agent Viscro
 */

/**
 * Convert Uint8Array to hex string.
 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array.
 */
export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Compare two Uint8Arrays for equality.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Concatenate multiple Uint8Arrays.
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
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
export function bigintToBytes(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, value, false);
  return new Uint8Array(buf);
}

/**
 * Convert 8-byte Uint8Array to BigInt (big-endian).
 */
export function bytesToBigint(bytes: Uint8Array): bigint {
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  return view.getBigUint64(0, false);
}

/**
 * Get current timestamp as BigInt milliseconds.
 */
export function now(): bigint {
  return BigInt(Date.now());
}

/**
 * Generate a short display ID from a MeshId (first 8 hex chars).
 */
export function shortId(meshId: Uint8Array): string {
  return toHex(meshId).substring(0, 8);
}

/**
 * Sleep for specified milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a deferred promise (externally resolvable).
 */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
