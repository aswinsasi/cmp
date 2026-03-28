/**
 * CMP Module: Image Sepia
 * Applies sepia tone filter to RGB pixel data.
 * Input: raw RGB bytes (3 bytes per pixel)
 * Output: sepia-toned bytes (in-place)
 *
 * Sepia formula:
 *   newR = 0.393R + 0.769G + 0.189B
 *   newG = 0.349R + 0.686G + 0.168B
 *   newB = 0.272R + 0.534G + 0.131B
 *
 * @author Agent Viscro
 */

export function process(ptr: i32, len: i32): i32 {
  for (let i: i32 = 0; i < len - 2; i += 3) {
    const r: i32 = load<u8>(ptr + i) as i32;
    const g: i32 = load<u8>(ptr + i + 1) as i32;
    const b: i32 = load<u8>(ptr + i + 2) as i32;

    // Fixed-point: multiply by 1000
    let newR: i32 = (r * 393 + g * 769 + b * 189) / 1000;
    let newG: i32 = (r * 349 + g * 686 + b * 168) / 1000;
    let newB: i32 = (r * 272 + g * 534 + b * 131) / 1000;

    if (newR > 255) newR = 255;
    if (newG > 255) newG = 255;
    if (newB > 255) newB = 255;

    store<u8>(ptr + i, newR as u8);
    store<u8>(ptr + i + 1, newG as u8);
    store<u8>(ptr + i + 2, newB as u8);
  }
  return len;
}
