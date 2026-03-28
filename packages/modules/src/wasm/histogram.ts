/**
 * CMP Module: Byte Histogram
 * Counts frequency of each byte value (0-255) in the input.
 * Useful for data analysis, compression estimation, entropy calculation.
 * Input: raw data bytes
 * Output: 256 × u32 LE values (1024 bytes) = count for each byte value
 *
 * @author Agent Viscro
 */

export function process(ptr: i32, len: i32): i32 {
  // Output goes after input data
  const outPtr: i32 = ptr + len;
  const outLen: i32 = 256 * 4; // 256 counters × 4 bytes each

  // Ensure memory is available
  const needed: i32 = outPtr + outLen;
  const pages: i32 = (needed + 65535) >> 16;
  if (pages > memory.size()) {
    memory.grow(pages - memory.size() + 1);
  }

  // Zero the output buffer
  memory.fill(outPtr, 0, outLen);

  // Count byte frequencies
  for (let i: i32 = 0; i < len; i++) {
    const val: i32 = load<u8>(ptr + i) as i32;
    const counterPtr: i32 = outPtr + val * 4;
    const count: u32 = load<u32>(counterPtr);
    store<u32>(counterPtr, count + 1);
  }

  // Copy output to start of buffer for CMP to pick up
  memory.copy(ptr, outPtr, outLen);

  return outLen;
}
