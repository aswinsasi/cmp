/**
 * CRC-32C (Castagnoli) Implementation
 * Used in CMP Frame headers for payload integrity verification.
 *
 * CRC-32C uses the Castagnoli polynomial (0x1EDC6F41), NOT the
 * standard CRC-32 polynomial. CRC-32C is hardware-accelerated
 * on modern ARM (CRC32C instruction) and x86 (SSE4.2) processors.
 *
 * This is a pure JS table-based implementation for portability.
 *
 * @module utils/crc32c
 * @author Agent Viscro
 */

// CRC-32C lookup table (Castagnoli polynomial 0x1EDC6F41)
const TABLE = new Uint32Array(256);

// Build lookup table
(function buildTable() {
  const POLY = 0x82F63B78; // Reversed Castagnoli polynomial
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ POLY;
      } else {
        crc = crc >>> 1;
      }
    }
    TABLE[i] = crc >>> 0;
  }
})();

/**
 * Compute CRC-32C checksum of data.
 *
 * @param data - Input bytes
 * @param initial - Initial CRC value (default: 0xFFFFFFFF)
 * @returns 32-bit CRC-32C checksum
 */
export function crc32c(data: Uint8Array, initial: number = 0xFFFFFFFF): number {
  let crc = initial >>> 0;

  for (let i = 0; i < data.length; i++) {
    const index = (crc ^ data[i]) & 0xFF;
    crc = (crc >>> 8) ^ TABLE[index];
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Verify CRC-32C checksum against expected value.
 *
 * @param data - Input bytes
 * @param expected - Expected CRC-32C value
 * @returns true if checksum matches
 */
export function verifyCRC32C(data: Uint8Array, expected: number): boolean {
  return crc32c(data) === (expected >>> 0);
}
