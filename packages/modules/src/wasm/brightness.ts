/**
 * CMP Module: Image Brightness
 * Adjusts brightness of RGB pixel data.
 * Input: [brightness: i8 as first byte][-128 to +127][RGB pixels...]
 * Output: adjusted pixel data (in-place, starting at byte 1)
 *
 * @author Agent Viscro
 */

export function process(ptr: i32, len: i32): i32 {
  if (len < 2) return 0;

  // First byte = brightness adjustment (-128 to +127, signed)
  let adjustment: i32 = load<u8>(ptr) as i32;
  if (adjustment > 127) adjustment = adjustment - 256; // treat as signed

  const dataStart: i32 = ptr + 1;
  const dataLen: i32 = len - 1;

  for (let i: i32 = 0; i < dataLen; i++) {
    let val: i32 = load<u8>(dataStart + i) as i32;
    val = val + adjustment;
    if (val < 0) val = 0;
    if (val > 255) val = 255;
    store<u8>(dataStart + i, val as u8);
  }

  // Copy result to start of buffer (overwrite header byte)
  memory.copy(ptr, dataStart, dataLen);
  return dataLen;
}
