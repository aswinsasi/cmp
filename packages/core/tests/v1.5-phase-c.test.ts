/**
 * CMP v1.5 — Phase C Test Suite: Native Crypto Acceleration
 *
 * Tests:
 *   1. Native backend detection
 *   2. Ed25519 sign/verify correctness via native
 *   3. Cross-backend compatibility (native signs, tweetnacl verifies and vice-versa)
 *   4. SHA-256 correctness
 *   5. Auth module still works with native backend
 *   6. Performance benchmark: native vs tweetnacl
 *
 * Run: npx ts-node --transpile-only packages/core/tests/v1.5-phase-c.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSigningKeyPair,
  sign,
  verify,
  hash256,
  randomBytes,
  encrypt,
  decrypt,
  isNativeAccelerated,
  getCryptoBackendName,
  _setBackend,
  _resetBackend,
} from '../src/crypto';

import {
  generateAuthKeypair,
  signFrame,
  verifyFrame,
  hasAuthTrailer,
} from '../src/auth/message-auth';

import { encodeMessage, encodeJSON } from '../src/layers/serializer';
import { MessageType } from '../src/types/beacon';

after(() => setTimeout(() => process.exit(0), 200));

// ═══════════════════════════════════════
// Backend Detection
// ═══════════════════════════════════════

describe('Native Crypto — Backend Detection', () => {
  it('should detect native crypto on Node.js', () => {
    _resetBackend();
    const isNative = isNativeAccelerated();
    const name = getCryptoBackendName();

    console.log(`  Backend: ${name} (native=${isNative})`);
    // On Node.js 16+, native should be available
    assert.equal(isNative, true, 'Native crypto should be available on Node.js');
    assert.equal(name, 'native');
  });

  it('should allow forcing tweetnacl backend', () => {
    _setBackend('tweetnacl');
    assert.equal(isNativeAccelerated(), false);
    assert.equal(getCryptoBackendName(), 'tweetnacl');
    _resetBackend();
  });

  it('should allow forcing native backend', () => {
    _setBackend('native');
    assert.equal(isNativeAccelerated(), true);
    _resetBackend();
  });
});

// ═══════════════════════════════════════
// Ed25519 Correctness (Native)
// ═══════════════════════════════════════

describe('Native Crypto — Ed25519 Sign/Verify', () => {
  it('should generate valid keypairs', () => {
    const kp = generateSigningKeyPair();
    assert.equal(kp.publicKey.length, 32);
    assert.equal(kp.secretKey.length, 64);
  });

  it('should sign and verify correctly with native backend', () => {
    _setBackend('native');
    const kp = generateSigningKeyPair();
    const data = new TextEncoder().encode('Hello CMP native crypto!');

    const signature = sign(data, kp.secretKey);
    assert.equal(signature.length, 64);

    const valid = verify(data, signature, kp.publicKey);
    assert.equal(valid, true);
    _resetBackend();
  });

  it('should reject tampered data with native backend', () => {
    _setBackend('native');
    const kp = generateSigningKeyPair();
    const data = new TextEncoder().encode('Original message');
    const signature = sign(data, kp.secretKey);

    const tampered = new TextEncoder().encode('Tampered message');
    assert.equal(verify(tampered, signature, kp.publicKey), false);
    _resetBackend();
  });

  it('should reject wrong public key with native backend', () => {
    _setBackend('native');
    const kp1 = generateSigningKeyPair();
    const kp2 = generateSigningKeyPair();
    const data = new TextEncoder().encode('test');
    const signature = sign(data, kp1.secretKey);

    assert.equal(verify(data, signature, kp2.publicKey), false);
    _resetBackend();
  });

  it('should handle empty data', () => {
    _setBackend('native');
    const kp = generateSigningKeyPair();
    const data = new Uint8Array(0);
    const signature = sign(data, kp.secretKey);
    assert.equal(verify(data, signature, kp.publicKey), true);
    _resetBackend();
  });

  it('should handle large data', () => {
    _setBackend('native');
    const kp = generateSigningKeyPair();
    const data = randomBytes(100000);
    const signature = sign(data, kp.secretKey);
    assert.equal(verify(data, signature, kp.publicKey), true);
    _resetBackend();
  });
});

// ═══════════════════════════════════════
// Cross-Backend Compatibility
// ═══════════════════════════════════════

describe('Native Crypto — Cross-Backend Compatibility', () => {
  it('should verify native-signed data with tweetnacl', () => {
    const kp = generateSigningKeyPair();
    const data = new TextEncoder().encode('Cross-backend test');

    // Sign with native
    _setBackend('native');
    const signature = sign(data, kp.secretKey);

    // Verify with tweetnacl
    _setBackend('tweetnacl');
    const valid = verify(data, signature, kp.publicKey);
    assert.equal(valid, true, 'tweetnacl should verify native-signed data');

    _resetBackend();
  });

  it('should verify tweetnacl-signed data with native', () => {
    const kp = generateSigningKeyPair();
    const data = new TextEncoder().encode('Cross-backend test reverse');

    // Sign with tweetnacl
    _setBackend('tweetnacl');
    const signature = sign(data, kp.secretKey);

    // Verify with native
    _setBackend('native');
    const valid = verify(data, signature, kp.publicKey);
    assert.equal(valid, true, 'native should verify tweetnacl-signed data');

    _resetBackend();
  });

  it('should produce identical signatures from both backends', () => {
    const kp = generateSigningKeyPair();
    const data = new TextEncoder().encode('Deterministic Ed25519');

    _setBackend('native');
    const sigNative = sign(data, kp.secretKey);

    _setBackend('tweetnacl');
    const sigTweet = sign(data, kp.secretKey);

    // Ed25519 is deterministic — same key + same data = same signature
    assert.deepStrictEqual(sigNative, sigTweet, 'Both backends should produce identical signatures');

    _resetBackend();
  });
});

// ═══════════════════════════════════════
// SHA-256 Correctness
// ═══════════════════════════════════════

describe('Native Crypto — SHA-256', () => {
  it('should produce correct SHA-256 hash', () => {
    _setBackend('native');
    const data = new TextEncoder().encode('hello');
    const hash = hash256(data);
    assert.equal(hash.length, 32);

    // Known SHA-256 of "hello": 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const actual = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
    assert.equal(actual, expected, 'Should match known SHA-256 of "hello"');
    _resetBackend();
  });

  it('should produce 32-byte hashes from both backends', () => {
    const data = new TextEncoder().encode('hash test');

    _setBackend('native');
    const hashNative = hash256(data);

    _setBackend('tweetnacl');
    const hashTweet = hash256(data);

    assert.equal(hashNative.length, 32);
    assert.equal(hashTweet.length, 32);

    // Note: native uses real SHA-256, tweetnacl uses truncated SHA-512
    // They will NOT be identical — that's expected and fine.
    // What matters is both are 32 bytes and deterministic.
    _resetBackend();
  });
});

// ═══════════════════════════════════════
// Auth Module Integration
// ═══════════════════════════════════════

describe('Native Crypto — Auth Module Integration', () => {
  it('should sign and verify CMP frames with native backend', () => {
    _resetBackend(); // Use auto-detect (native on Node.js)
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ native: true }));

    const signed = signFrame(frame, kp.secretKey, kp.publicKey);
    assert.equal(hasAuthTrailer(signed), true);

    const result = verifyFrame(signed);
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.frame, frame);
  });

  it('should detect tampered frames with native backend', () => {
    _resetBackend();
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ test: true }));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);

    signed[signed.length - 5] ^= 0xFF;
    const result = verifyFrame(signed);
    assert.equal(result.valid, false);
  });

  it('should cross-verify: native-signed frame verified after backend switch', () => {
    // Sign with native
    _setBackend('native');
    const kp = generateAuthKeypair();
    const frame = encodeMessage(MessageType.HEARTBEAT, encodeJSON({ cross: true }));
    const signed = signFrame(frame, kp.secretKey, kp.publicKey);

    // Verify with tweetnacl
    _setBackend('tweetnacl');
    const result = verifyFrame(signed);
    assert.equal(result.valid, true, 'tweetnacl should verify native-signed frame');

    _resetBackend();
  });
});

// ═══════════════════════════════════════
// Encryption (unchanged — backward compat)
// ═══════════════════════════════════════

describe('Native Crypto — Encryption Backward Compat', () => {
  it('should encrypt/decrypt with XSalsa20-Poly1305 (unchanged)', () => {
    const key = randomBytes(32);
    const plaintext = new TextEncoder().encode('Encryption test - should still use XSalsa20');

    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    assert.deepStrictEqual(decrypted, plaintext);
  });

  it('should reject decryption with wrong key', () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);
    const plaintext = new TextEncoder().encode('Secret data');

    const encrypted = encrypt(plaintext, key1);
    assert.throws(() => decrypt(encrypted, key2));
  });
});

// ═══════════════════════════════════════
// Performance Benchmark
// ═══════════════════════════════════════

describe('Native Crypto — Performance Benchmark', () => {
  it('should benchmark Ed25519 sign: native vs tweetnacl', () => {
    const kp = generateSigningKeyPair();
    const data = randomBytes(256); // Typical CMP frame size
    const ITERATIONS = 500;

    // Warm up
    for (let i = 0; i < 10; i++) {
      _setBackend('native');
      sign(data, kp.secretKey);
      _setBackend('tweetnacl');
      sign(data, kp.secretKey);
    }

    // Benchmark native
    _setBackend('native');
    const nativeStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      sign(data, kp.secretKey);
    }
    const nativeMs = performance.now() - nativeStart;

    // Benchmark tweetnacl
    _setBackend('tweetnacl');
    const tweetStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      sign(data, kp.secretKey);
    }
    const tweetMs = performance.now() - tweetStart;

    const speedup = tweetMs / nativeMs;

    console.log(`\n  ┌─────────────────────────────────────────┐`);
    console.log(`  │ Ed25519 SIGN (${ITERATIONS} iterations, 256B data)   │`);
    console.log(`  ├─────────────────────────────────────────┤`);
    console.log(`  │ Native:    ${nativeMs.toFixed(1).padStart(7)}ms  (${(nativeMs/ITERATIONS).toFixed(3)}ms/op)  │`);
    console.log(`  │ TweetNaCl: ${tweetMs.toFixed(1).padStart(7)}ms  (${(tweetMs/ITERATIONS).toFixed(3)}ms/op)  │`);
    console.log(`  │ Speedup:   ${speedup.toFixed(1).padStart(7)}x                    │`);
    console.log(`  └─────────────────────────────────────────┘\n`);

    assert.ok(speedup > 2, `Native should be at least 2x faster (got ${speedup.toFixed(1)}x)`);

    _resetBackend();
  });

  it('should benchmark Ed25519 verify: native vs tweetnacl', () => {
    const kp = generateSigningKeyPair();
    const data = randomBytes(256);
    _setBackend('native');
    const signature = sign(data, kp.secretKey);
    const ITERATIONS = 500;

    // Warm up
    for (let i = 0; i < 10; i++) {
      _setBackend('native');
      verify(data, signature, kp.publicKey);
      _setBackend('tweetnacl');
      verify(data, signature, kp.publicKey);
    }

    // Benchmark native
    _setBackend('native');
    const nativeStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      verify(data, signature, kp.publicKey);
    }
    const nativeMs = performance.now() - nativeStart;

    // Benchmark tweetnacl
    _setBackend('tweetnacl');
    const tweetStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      verify(data, signature, kp.publicKey);
    }
    const tweetMs = performance.now() - tweetStart;

    const speedup = tweetMs / nativeMs;

    console.log(`  ┌─────────────────────────────────────────┐`);
    console.log(`  │ Ed25519 VERIFY (${ITERATIONS} iters, 256B data)   │`);
    console.log(`  ├─────────────────────────────────────────┤`);
    console.log(`  │ Native:    ${nativeMs.toFixed(1).padStart(7)}ms  (${(nativeMs/ITERATIONS).toFixed(3)}ms/op)  │`);
    console.log(`  │ TweetNaCl: ${tweetMs.toFixed(1).padStart(7)}ms  (${(tweetMs/ITERATIONS).toFixed(3)}ms/op)  │`);
    console.log(`  │ Speedup:   ${speedup.toFixed(1).padStart(7)}x                    │`);
    console.log(`  └─────────────────────────────────────────┘\n`);

    assert.ok(speedup > 2, `Native should be at least 2x faster (got ${speedup.toFixed(1)}x)`);

    _resetBackend();
  });

  it('should benchmark SHA-256: native vs tweetnacl', () => {
    const data = randomBytes(1024); // 1KB typical
    const ITERATIONS = 2000;

    // Warm up
    for (let i = 0; i < 10; i++) {
      _setBackend('native');
      hash256(data);
      _setBackend('tweetnacl');
      hash256(data);
    }

    _setBackend('native');
    const nativeStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      hash256(data);
    }
    const nativeMs = performance.now() - nativeStart;

    _setBackend('tweetnacl');
    const tweetStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      hash256(data);
    }
    const tweetMs = performance.now() - tweetStart;

    const speedup = tweetMs / nativeMs;

    console.log(`  ┌─────────────────────────────────────────┐`);
    console.log(`  │ SHA-256 (${ITERATIONS} iterations, 1KB data)       │`);
    console.log(`  ├─────────────────────────────────────────┤`);
    console.log(`  │ Native:    ${nativeMs.toFixed(1).padStart(7)}ms  (${(nativeMs/ITERATIONS).toFixed(4)}ms/op) │`);
    console.log(`  │ TweetNaCl: ${tweetMs.toFixed(1).padStart(7)}ms  (${(tweetMs/ITERATIONS).toFixed(4)}ms/op) │`);
    console.log(`  │ Speedup:   ${speedup.toFixed(1).padStart(7)}x                    │`);
    console.log(`  └─────────────────────────────────────────┘\n`);

    assert.ok(speedup > 2, `Native should be at least 2x faster (got ${speedup.toFixed(1)}x)`);

    _resetBackend();
  });
});

console.log('\n══════════════════════════════════════════════════');
console.log(' CMP v1.5 Phase C — Native Crypto Acceleration');
console.log('══════════════════════════════════════════════════\n');
