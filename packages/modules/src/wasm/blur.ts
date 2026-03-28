/**
 * CMP Module: Image Box Blur
 * Applies a 3x3 box blur to RGB image data.
 * Input: [width: u16 BE bytes 0-1][height: u16 BE bytes 2-3][RGB pixels...]
 * Output: blurred pixels (in-place, starting at byte 4)
 *
 * Each output pixel = average of its 3x3 neighborhood.
 * Edge pixels are left unchanged.
 *
 * @author Agent Viscro
 */

export function process(ptr: i32, len: i32): i32 {
  if (len < 10) return 0; // need at least header + some pixels

  // Read width and height (big-endian u16)
  const width: i32 = ((load<u8>(ptr) as i32) << 8) | (load<u8>(ptr + 1) as i32);
  const height: i32 = ((load<u8>(ptr + 2) as i32) << 8) | (load<u8>(ptr + 3) as i32);

  const headerSize: i32 = 4;
  const dataStart: i32 = ptr + headerSize;
  const dataLen: i32 = len - headerSize;
  const stride: i32 = width * 3; // bytes per row

  if (dataLen < stride * height) return dataLen;

  // We need a temporary buffer — use memory after the input data
  const tempPtr: i32 = ptr + len;

  // Ensure we have enough memory
  const needed: i32 = len + dataLen;
  const pages: i32 = (needed + 65535) >> 16; // 64KB pages
  if (pages > memory.size()) {
    memory.grow(pages - memory.size() + 1);
  }

  // Copy original to temp
  memory.copy(tempPtr, dataStart, dataLen);

  // Apply 3x3 box blur (skip edges)
  for (let y: i32 = 1; y < height - 1; y++) {
    for (let x: i32 = 1; x < width - 1; x++) {
      for (let c: i32 = 0; c < 3; c++) {
        let sum: i32 = 0;
        for (let dy: i32 = -1; dy <= 1; dy++) {
          for (let dx: i32 = -1; dx <= 1; dx++) {
            const idx: i32 = (y + dy) * stride + (x + dx) * 3 + c;
            sum += load<u8>(tempPtr + idx) as i32;
          }
        }
        const outIdx: i32 = y * stride + x * 3 + c;
        store<u8>(dataStart + outIdx, (sum / 9) as u8);
      }
    }
  }

  return dataLen;
}
