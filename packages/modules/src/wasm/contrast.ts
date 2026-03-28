/**
 * CMP Module: Image Contrast
 * Adjusts contrast of RGB pixel data.
 * Input: [contrast: u8 as first byte][0=min, 128=normal, 255=max][RGB pixels...]
 * Output: contrast-adjusted pixels (in-place, starting at byte 1)
 *
 * @author Agent Viscro
 */

export function process(ptr: i32, len: i32): i32 {
  if (len < 2) return 0;

  // First byte = contrast level (0-255, 128 = no change)
  const level: i32 = load<u8>(ptr) as i32;

  // Factor: map 0-255 to -128 to +127, then to multiplier
  // factor = (259 * (level + 255)) / (255 * (259 - level))
  // Using fixed-point with 1024 scale
  const c: i32 = level - 128;
  const factor: i32 = ((259 * (c + 255)) * 1024) / (255 * (259 - c));

  const dataStart: i32 = ptr + 1;
  const dataLen: i32 = len - 1;

  for (let i: i32 = 0; i < dataLen; i++) {
    let val: i32 = load<u8>(dataStart + i) as i32;
    val = ((factor * (val - 128)) / 1024) + 128;
    if (val < 0) val = 0;
    if (val > 255) val = 255;
    store<u8>(dataStart + i, val as u8);
  }

  // Copy result to start of buffer (overwrite header byte)
  memory.copy(ptr, dataStart, dataLen);
  return dataLen;
}
