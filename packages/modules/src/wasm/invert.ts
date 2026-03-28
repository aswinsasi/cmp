/**
 * CMP Module: Image Invert
 * Inverts all pixel values (creates negative image).
 * Input: raw RGB bytes
 * Output: inverted bytes (in-place)
 *
 * @author Agent Viscro
 */

export function process(ptr: i32, len: i32): i32 {
  for (let i: i32 = 0; i < len; i++) {
    const val: u8 = load<u8>(ptr + i);
    store<u8>(ptr + i, (255 - val) as u8);
  }
  return len;
}
