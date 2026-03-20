/**
 * CMP Cryptographic Primitives
 * Key generation, ECDH, encryption, hashing, and signatures.
 * Uses tweetnacl for all crypto operations (pure JS, no native deps).
 *
 * @module crypto
 * @author Agent Viscro
 */

import nacl from 'tweetnacl';
import { PublicKey, SecretKey, SessionKey, Hash256, Hash64, Signature } from '../types/primitives';

// ── Key Management ──

export interface KeyPair {
  publicKey: PublicKey;
  secretKey: SecretKey;
}

/**
 * Generate an Ed25519 signing key pair.
 */
export function generateSigningKeyPair(): KeyPair {
  const kp = nacl.sign.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * Generate an X25519 key pair for key exchange.
 */
export function generateExchangeKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * Derive a shared session key using X25519 ECDH.
 *
 * @param mySecretKey - Our X25519 secret key
 * @param theirPublicKey - Peer's X25519 public key
 * @returns 32-byte shared secret
 */
export function deriveSharedSecret(
  mySecretKey: SecretKey,
  theirPublicKey: PublicKey
): SessionKey {
  return nacl.scalarMult(mySecretKey, theirPublicKey);
}

/**
 * Generate cryptographically secure random bytes.
 */
export function randomBytes(n: number): Uint8Array {
  return nacl.randomBytes(n);
}

/**
 * Generate a random MeshId (16 bytes).
 */
export function generateMeshId(): Uint8Array {
  return randomBytes(16);
}

// ── Hashing ──

/**
 * SHA-512 hash (tweetnacl uses SHA-512 internally).
 * We truncate to 32 bytes for SHA-256-equivalent usage.
 */
export function hash256(data: Uint8Array): Hash256 {
  return nacl.hash(data).slice(0, 32);
}

/**
 * Truncated hash for beacon capability summary (8 bytes).
 */
export function hash64(data: Uint8Array): Hash64 {
  return hash256(data).slice(0, 8);
}

// ── Encryption ──

/**
 * Encrypt data using NaCl secretbox (XSalsa20-Poly1305).
 * Returns nonce + ciphertext concatenated.
 *
 * @param plaintext - Data to encrypt
 * @param key - 32-byte symmetric key
 * @returns nonce (24 bytes) + ciphertext
 */
export function encrypt(plaintext: Uint8Array, key: SessionKey): Uint8Array {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  if (!ciphertext) throw new Error('Encryption failed');

  // Concat: [nonce (24 bytes)][ciphertext]
  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.length);
  return result;
}

/**
 * Decrypt data encrypted with encrypt().
 *
 * @param encrypted - nonce + ciphertext (from encrypt())
 * @param key - 32-byte symmetric key
 * @returns Decrypted plaintext
 */
export function decrypt(encrypted: Uint8Array, key: SessionKey): Uint8Array {
  const nonce = encrypted.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = encrypted.slice(nacl.secretbox.nonceLength);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('Decryption failed - invalid key or corrupted data');
  return plaintext;
}

/**
 * Encrypt data for a specific recipient using their public key.
 * Uses NaCl box (X25519-XSalsa20-Poly1305).
 *
 * @param plaintext - Data to encrypt
 * @param recipientPublicKey - Recipient's X25519 public key
 * @param senderSecretKey - Sender's X25519 secret key
 * @returns nonce (24 bytes) + ciphertext
 */
export function encryptFor(
  plaintext: Uint8Array,
  recipientPublicKey: PublicKey,
  senderSecretKey: SecretKey
): Uint8Array {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(plaintext, nonce, recipientPublicKey, senderSecretKey);
  if (!ciphertext) throw new Error('Asymmetric encryption failed');

  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.length);
  return result;
}

/**
 * Decrypt data encrypted with encryptFor().
 */
export function decryptFrom(
  encrypted: Uint8Array,
  senderPublicKey: PublicKey,
  recipientSecretKey: SecretKey
): Uint8Array {
  const nonce = encrypted.slice(0, nacl.box.nonceLength);
  const ciphertext = encrypted.slice(nacl.box.nonceLength);
  const plaintext = nacl.box.open(ciphertext, nonce, senderPublicKey, recipientSecretKey);
  if (!plaintext) throw new Error('Asymmetric decryption failed');
  return plaintext;
}

// ── Signatures ──

/**
 * Sign data with Ed25519.
 *
 * @param data - Data to sign
 * @param secretKey - 64-byte Ed25519 secret key
 * @returns 64-byte signature
 */
export function sign(data: Uint8Array, secretKey: SecretKey): Signature {
  return nacl.sign.detached(data, secretKey);
}

/**
 * Verify an Ed25519 signature.
 *
 * @param data - Original data
 * @param signature - 64-byte signature
 * @param publicKey - 32-byte public key
 * @returns true if signature is valid
 */
export function verify(
  data: Uint8Array,
  signature: Signature,
  publicKey: PublicKey
): boolean {
  return nacl.sign.detached.verify(data, signature, publicKey);
}
