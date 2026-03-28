/**
 * CMP Module: XOR Cipher
 * Symmetric XOR encryption/decryption.
 * Input: [key: first byte][data bytes...]
 * Output: XOR'd data (in-place, starting at byte 1)
 *
 * Encrypt: process(key + plaintext) → ciphertext
 * Decrypt: process(key + ciphertext) → plaintext
 *
 * @author Agent Viscro
 */

export function encrypt(ptr: i32, len: i32): i32 {
  if (len < 2) return 0;

  const key: u8 = load<u8>(ptr);
  const dataStart: i32 = ptr + 1;
  const dataLen: i32 = len - 1;

  for (let i: i32 = 0; i < dataLen; i++) {
    const val: u8 = load<u8>(dataStart + i);
    store<u8>(dataStart + i, val ^ key);
  }

  // Copy result to start of buffer (overwrite key byte)
  memory.copy(ptr, dataStart, dataLen);
  return dataLen;
}

// Default 0x42 key (backward compatible with existing CLI)
export function process(ptr: i32, len: i32): i32 {
  for (let i: i32 = 0; i < len; i++) {
    const val: u8 = load<u8>(ptr + i);
    store<u8>(ptr + i, val ^ 0x42);
  }
  return len;
}
