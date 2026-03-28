/**
 * CMP Module: Image Threshold
 * Converts grayscale image to binary black/white.
 * Useful as OCR preprocessing step.
 * Input: [threshold: u8 as first byte][0-255][grayscale pixels...]
 * Output: binary pixels (0 or 255) (in-place, starting at byte 1)
 *
 * @author Agent Viscro
 */

export function process(ptr: i32, len: i32): i32 {
  if (len < 2) return 0;

  const threshold: i32 = load<u8>(ptr) as i32;
  const dataStart: i32 = ptr + 1;
  const dataLen: i32 = len - 1;

  for (let i: i32 = 0; i < dataLen; i++) {
    const val: i32 = load<u8>(dataStart + i) as i32;
    store<u8>(dataStart + i, val >= threshold ? 255 as u8 : 0 as u8);
  }

  // Copy result to start of buffer (overwrite header byte)
  memory.copy(ptr, dataStart, dataLen);
  return dataLen;
}
