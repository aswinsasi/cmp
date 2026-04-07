"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateKeypair = generateKeypair;
exports.generateId = generateId;
exports.sign = sign;
exports.verify = verify;
exports.hash = hash;
exports.hash32 = hash32;
exports.deriveCompositeId = deriveCompositeId;
exports.hashGenome = hashGenome;
exports.serializeForSigning = serializeForSigning;
exports.signObject = signObject;
exports.verifyObject = verifyObject;
const tweetnacl_1 = __importDefault(require("tweetnacl"));
/**
 * Generate an Ed25519 keypair for a Lifeform soul.
 */
function generateKeypair() {
    const kp = tweetnacl_1.default.sign.keyPair();
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}
/**
 * Generate a random 16-byte ID.
 */
function generateId() {
    return tweetnacl_1.default.randomBytes(16);
}
// ─── Signing ───
/**
 * Sign a message with an Ed25519 secret key.
 * Returns a 64-byte detached signature.
 */
function sign(message, secretKey) {
    return tweetnacl_1.default.sign.detached(message, secretKey);
}
/**
 * Verify a detached Ed25519 signature.
 */
function verify(message, signature, publicKey) {
    return tweetnacl_1.default.sign.detached.verify(message, signature, publicKey);
}
// ─── Hashing ───
/**
 * SHA-512 hash (tweetnacl provides SHA-512).
 * Returns 64 bytes. We truncate to 32 for most uses.
 */
function hash(data) {
    return tweetnacl_1.default.hash(data);
}
/**
 * SHA-512 hash truncated to 32 bytes.
 * Used for genome hashing, composite IDs, etc.
 */
function hash32(data) {
    return tweetnacl_1.default.hash(data).slice(0, 32);
}
/**
 * Derive a composite ID from two component IDs.
 * compositeId = hash(componentA.id + componentB.id)[0:16]
 */
function deriveCompositeId(idA, idB) {
    const combined = new Uint8Array(idA.length + idB.length);
    combined.set(idA, 0);
    combined.set(idB, idA.length);
    return hash(combined).slice(0, 16);
}
/**
 * Hash a WASM module binary to produce a genome hash.
 */
function hashGenome(wasmBytes) {
    return hash32(wasmBytes);
}
// ─── Serialization helpers ───
/**
 * Serialize an object to Uint8Array for signing.
 */
function serializeForSigning(obj) {
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
function signObject(obj, secretKey) {
    return sign(serializeForSigning(obj), secretKey);
}
/**
 * Verify a signed object.
 */
function verifyObject(obj, signature, publicKey) {
    return verify(serializeForSigning(obj), signature, publicKey);
}
//# sourceMappingURL=crypto.js.map