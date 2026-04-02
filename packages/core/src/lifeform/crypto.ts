/**
 * CMP v1.4 — Lifeform Cryptography
 * Real Ed25519 keypairs, signing, verification, and hashing
 * for Lifeform souls, fusion proposals, intent commitments,
 * and sampling signatures.
 *
 * Uses tweetnacl (already in project).
 *
 * @module lifeform/crypto
 * @author Agent Viscro
 */

import nacl from 'tweetnacl';

// ─── Key Generation ───

export interface LifeformKeypair {
  publicKey: Uint8Array;  // 32 bytes
  secretKey: Uint8Array;  // 64 bytes
}

/**
 * Generate an Ed25519 keypair for a Lifeform soul.
 */
export function generateKeypair(): LifeformKeypair {
  const kp = nacl.sign.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * Generate a random 16-byte ID.
 */
export function generateId(): Uint8Array {
  return nacl.randomBytes(16);
}

// ─── Signing ───

/**
 * Sign a message with an Ed25519 secret key.
 * Returns a 64-byte detached signature.
 */
export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

/**
 * Verify a detached Ed25519 signature.
 */
export function verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  return nacl.sign.detached.verify(message, signature, publicKey);
}

// ─── Hashing ───

/**
 * SHA-512 hash (tweetnacl provides SHA-512).
 * Returns 64 bytes. We truncate to 32 for most uses.
 */
export function hash(data: Uint8Array): Uint8Array {
  return nacl.hash(data);
}

/**
 * SHA-512 hash truncated to 32 bytes.
 * Used for genome hashing, composite IDs, etc.
 */
export function hash32(data: Uint8Array): Uint8Array {
  return nacl.hash(data).slice(0, 32);
}

/**
 * Derive a composite ID from two component IDs.
 * compositeId = hash(componentA.id + componentB.id)[0:16]
 */
export function deriveCompositeId(idA: Uint8Array, idB: Uint8Array): Uint8Array {
  const combined = new Uint8Array(idA.length + idB.length);
  combined.set(idA, 0);
  combined.set(idB, idA.length);
  return hash(combined).slice(0, 16);
}

/**
 * Hash a WASM module binary to produce a genome hash.
 */
export function hashGenome(wasmBytes: Uint8Array): Uint8Array {
  return hash32(wasmBytes);
}

// ─── Serialization helpers ───

/**
 * Serialize an object to Uint8Array for signing.
 */
export function serializeForSigning(obj: Record<string, any>): Uint8Array {
  const json = JSON.stringify(obj, (key, value) => {
    // Convert Uint8Array to hex for deterministic serialization
    if (value instanceof Uint8Array) {
      return Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return value;
  });
  return new TextEncoder().encode(json);
}

/**
 * Sign an object with a secret key.
 */
export function signObject(obj: Record<string, any>, secretKey: Uint8Array): Uint8Array {
  return sign(serializeForSigning(obj), secretKey);
}

/**
 * Verify a signed object.
 */
export function verifyObject(obj: Record<string, any>, signature: Uint8Array, publicKey: Uint8Array): boolean {
  return verify(serializeForSigning(obj), signature, publicKey);
}
