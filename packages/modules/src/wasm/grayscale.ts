/**
 * CMP Module: Image Grayscale
 * Converts RGB pixel data to grayscale using luminance formula.
 * Input: raw RGB bytes (3 bytes per pixel: R, G, B)
 * Output: same buffer with grayscale values (in-place)
 *
 * Luminance: 0.299R + 0.587G + 0.114B
 *
 * @author Agent Viscro
 */

// Entry point: process RGB pixels in linear memory
// ptr = pointer to pixel data, len = total bytes
// Returns: number of bytes written
export function process(ptr: i32, len: i32): i32 {
  for (let i: i32 = 0; i < len - 2; i += 3) {
    const r: i32 = load<u8>(ptr + i) as i32;
    const g: i32 = load<u8>(ptr + i + 1) as i32;
    const b: i32 = load<u8>(ptr + i + 2) as i32;

    // Luminance formula (fixed point: multiply by 1000, divide by 1000)
    const gray: i32 = (r * 299 + g * 587 + b * 114) / 1000;
    const clamped: u8 = (gray > 255 ? 255 : gray) as u8;

    store<u8>(ptr + i, clamped);
    store<u8>(ptr + i + 1, clamped);
    store<u8>(ptr + i + 2, clamped);
  }
  return len;
}
