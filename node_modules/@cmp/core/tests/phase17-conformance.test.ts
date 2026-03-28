/**
 * CMP Phase 17 Test Suite
 * Tests: Wire Protocol Conformance + Test Vectors
 *   TV-01: Beacon encoding (38 bytes, byte-exact)
 *   TV-02: CMP Frame header (16 bytes, field offsets, CRC-32C)
 *   TV-03: Ed25519 sign/verify
 *   TV-04: CRC-32C (Castagnoli)
 *   TV-05: X25519 key exchange
 *   TV-06: MER encoding round-trip
 *   TV-07: MER signature verification
 *   TV-08: Bloom filter false positive rate
 *   TV-09: Node state machine transitions
 *   TV-10: Error/message type completeness
 *   + CMP Frame backward compatibility with v1.0 TLV
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase17-conformance.test.ts
 *
 * @author Agent Viscro
 */

import {
  // Beacon
  encodeBeacon, decodeBeacon, createBeacon, isValidBeacon,
  BEACON_MAGIC, BEACON_SIZE, PROTOCOL_VERSION,
  // Serializer / Frame
  encodeMessage, decodeMessage, encodeJSON, decodeJSON,
  resetFrameSequence, FRAME_HEADER_SIZE,
  // Crypto
  generateSigningKeyPair, generateExchangeKeyPair, deriveSharedSecret,
  hash256, sign, verify, randomBytes, encrypt, decrypt,
  // CRC
  crc32c, verifyCRC32C,
  // Utilities
  toHex, fromHex, bytesEqual, concatBytes,
  // Types
  MessageType, TaskType,
} from '../src';

import {
  createMER, verifyMER, merToWire, merFromWire,
  BloomFilter, BLOOM_BYTES,
} from '../src/mcl';

import type { MERCreateParams } from '../src/mcl/mer';
import { DecompositionStrategy, BottleneckFlag } from '../src/types/mcl';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
function assertEqual(a: any, e: any, m: string): void { if (a !== e) throw new Error(`${m}: expected ${e}, got ${a}`); }

const kp = generateSigningKeyPair();

console.log('\n\x1b[1m── Phase 17: Wire Protocol Conformance ──\x1b[0m');

// ════════════════════════════════════════════
// TV-01: BEACON ENCODING
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-01: Beacon Encoding ──\x1b[0m');

test('TV-01a: beacon is exactly 38 bytes', () => {
  const beacon = createBeacon(randomBytes(16), randomBytes(8));
  const encoded = encodeBeacon(beacon);
  assertEqual(encoded.length, BEACON_SIZE, 'beacon size');
  assertEqual(encoded.length, 38, 'exactly 38 bytes');
});

test('TV-01b: magic bytes at offset 0x00 = 0x43 0x4D 0x50', () => {
  const beacon = createBeacon(randomBytes(16), randomBytes(8));
  const encoded = encodeBeacon(beacon);
  assertEqual(encoded[0], 0x43, 'magic[0] = C');
  assertEqual(encoded[1], 0x4D, 'magic[1] = M');
  assertEqual(encoded[2], 0x50, 'magic[2] = P');
});

test('TV-01c: version at offset 0x03', () => {
  const beacon = createBeacon(randomBytes(16), randomBytes(8));
  const encoded = encodeBeacon(beacon);
  assertEqual(encoded[3], PROTOCOL_VERSION, 'version');
});

test('TV-01d: meshId at offset 0x04, 16 bytes', () => {
  const meshId = new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
  const beacon = createBeacon(meshId, randomBytes(8));
  const encoded = encodeBeacon(beacon);
  for (let i = 0; i < 16; i++) {
    assertEqual(encoded[4 + i], meshId[i], `meshId[${i}]`);
  }
});

test('TV-01e: capabilityHash at offset 0x14, 8 bytes', () => {
  const capHash = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD, 0x11, 0x22, 0x33, 0x44]);
  const beacon = createBeacon(randomBytes(16), capHash);
  const encoded = encodeBeacon(beacon);
  for (let i = 0; i < 8; i++) {
    assertEqual(encoded[0x14 + i], capHash[i], `capHash[${i}]`);
  }
});

test('TV-01f: timestamp at offset 0x1C, 8 bytes big-endian', () => {
  const beacon = createBeacon(randomBytes(16), randomBytes(8));
  const encoded = encodeBeacon(beacon);
  // Timestamp is at bytes 0x1C-0x23 (8 bytes)
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const ts = view.getBigUint64(0x1C, false);
  assert(ts > 0n, 'timestamp > 0');
  // Should be close to current time
  const now = BigInt(Date.now());
  assert(ts >= now - 5000n && ts <= now + 5000n, 'timestamp near now');
});

test('TV-01g: ttl at offset 0x24, flags at offset 0x25', () => {
  const beacon = createBeacon(randomBytes(16), randomBytes(8));
  const encoded = encodeBeacon(beacon);
  assertEqual(encoded[0x24], 3, 'default TTL = 3');
  // Default flags: acceptingTasks=1, hasPending=0, relay=1, mcl=1 = 0b00001101 = 0x0D
  assertEqual(encoded[0x25], 0x0D, 'default flags');
});

test('TV-01h: encode/decode round-trip preserves all fields', () => {
  const meshId = randomBytes(16);
  const capHash = randomBytes(8);
  const beacon = createBeacon(meshId, capHash, { acceptingTasks: true, hasPendingTasks: true, relayCapable: false, mclCapable: true });
  const encoded = encodeBeacon(beacon);
  const decoded = decodeBeacon(encoded);
  assert(decoded !== null, 'decode succeeds');
  assertEqual(decoded!.magic, BEACON_MAGIC, 'magic');
  assertEqual(decoded!.version, PROTOCOL_VERSION, 'version');
  assert(bytesEqual(decoded!.meshId, meshId), 'meshId');
  assert(bytesEqual(decoded!.capabilityHash, capHash), 'capHash');
  assert(decoded!.flags.acceptingTasks, 'acceptingTasks');
  assert(decoded!.flags.hasPendingTasks, 'hasPendingTasks');
  assert(!decoded!.flags.relayCapable, 'relayCapable');
  assert(decoded!.flags.mclCapable, 'mclCapable');
});

test('TV-01i: invalid magic rejected', () => {
  const encoded = encodeBeacon(createBeacon(randomBytes(16), randomBytes(8)));
  encoded[0] = 0xFF; // corrupt magic
  assertEqual(decodeBeacon(encoded), null, 'rejected');
});

// ════════════════════════════════════════════
// TV-02: CMP FRAME HEADER
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-02: CMP Frame Header ──\x1b[0m');

test('TV-02a: frame header is 16 bytes', () => {
  assertEqual(FRAME_HEADER_SIZE, 16, 'header size');
});

test('TV-02b: frame starts with CMP magic 0x43 0x4D 0x50', () => {
  resetFrameSequence();
  const payload = new TextEncoder().encode('hello');
  const frame = encodeMessage(MessageType.HEARTBEAT, payload);
  assertEqual(frame[0], 0x43, 'C');
  assertEqual(frame[1], 0x4D, 'M');
  assertEqual(frame[2], 0x50, 'P');
});

test('TV-02c: version at offset 0x03 = 0x01', () => {
  const frame = encodeMessage(MessageType.HEARTBEAT, new Uint8Array(0));
  assertEqual(frame[3], 0x01, 'version');
});

test('TV-02d: msg_type at offset 0x04', () => {
  const frame = encodeMessage(MessageType.HEARTBEAT, new Uint8Array(0));
  assertEqual(frame[4], MessageType.HEARTBEAT, 'msg_type = HEARTBEAT');
  const frame2 = encodeMessage(MessageType.CHUNK_DATA, new Uint8Array(0));
  assertEqual(frame2[4], MessageType.CHUNK_DATA, 'msg_type = CHUNK_DATA');
});

test('TV-02e: flags at offset 0x05 (default 0x00)', () => {
  const frame = encodeMessage(MessageType.HEARTBEAT, new Uint8Array(0));
  assertEqual(frame[5], 0x00, 'flags = 0');
});

test('TV-02f: sequence at offset 0x06, 2 bytes big-endian, monotonic', () => {
  resetFrameSequence();
  const f1 = encodeMessage(MessageType.HEARTBEAT, new Uint8Array(0));
  const f2 = encodeMessage(MessageType.HEARTBEAT, new Uint8Array(0));
  const view1 = new DataView(f1.buffer, f1.byteOffset);
  const view2 = new DataView(f2.buffer, f2.byteOffset);
  const seq1 = view1.getUint16(6, false);
  const seq2 = view2.getUint16(6, false);
  assertEqual(seq1, 0, 'first seq = 0');
  assertEqual(seq2, 1, 'second seq = 1');
});

test('TV-02g: payload_len at offset 0x08, 4 bytes big-endian', () => {
  const payload = new Uint8Array(42);
  const frame = encodeMessage(MessageType.HEARTBEAT, payload);
  const view = new DataView(frame.buffer, frame.byteOffset);
  assertEqual(view.getUint32(8, false), 42, 'payload_len = 42');
});

test('TV-02h: CRC-32C at offset 0x0C, 4 bytes big-endian', () => {
  const payload = new TextEncoder().encode('test payload');
  const frame = encodeMessage(MessageType.HEARTBEAT, payload);
  const view = new DataView(frame.buffer, frame.byteOffset);
  const frameCRC = view.getUint32(12, false);
  const expectedCRC = crc32c(payload);
  assertEqual(frameCRC, expectedCRC, 'CRC matches');
});

test('TV-02i: payload starts at offset 0x10', () => {
  const payload = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
  const frame = encodeMessage(MessageType.HEARTBEAT, payload);
  assertEqual(frame[16], 0xDE, 'payload[0]');
  assertEqual(frame[17], 0xAD, 'payload[1]');
  assertEqual(frame[18], 0xBE, 'payload[2]');
  assertEqual(frame[19], 0xEF, 'payload[3]');
  assertEqual(frame.length, 16 + 4, 'total length');
});

test('TV-02j: encode/decode round-trip', () => {
  const payload = encodeJSON({ message: 'hello', count: 42 });
  const frame = encodeMessage(MessageType.TASK_REQUEST, payload);
  const decoded = decodeMessage(frame);
  assert(decoded !== null, 'decoded');
  assertEqual(decoded!.type, MessageType.TASK_REQUEST, 'type');
  assert(bytesEqual(decoded!.payload, payload), 'payload matches');
  const obj = decodeJSON(decoded!.payload);
  assertEqual(obj.message, 'hello', 'JSON content');
  assertEqual(obj.count, 42, 'JSON number');
});

test('TV-02k: corrupted CRC rejected', () => {
  const frame = encodeMessage(MessageType.HEARTBEAT, new TextEncoder().encode('test'));
  frame[12] ^= 0xFF; // corrupt CRC
  assertEqual(decodeMessage(frame), null, 'rejected');
});

test('TV-02l: truncated frame rejected', () => {
  const frame = encodeMessage(MessageType.HEARTBEAT, new Uint8Array(100));
  const truncated = frame.slice(0, 20); // cut off most of payload
  assertEqual(decodeMessage(truncated), null, 'rejected');
});

// ════════════════════════════════════════════
// TV-02 BONUS: BACKWARD COMPATIBILITY
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-02 Bonus: Backward Compatibility ──\x1b[0m');

test('decodeMessage: handles v1.0 TLV format', () => {
  // Manually construct v1.0 TLV: [type:1B][length:4B][payload]
  const payload = new TextEncoder().encode('old format');
  const tlv = new Uint8Array(5 + payload.length);
  tlv[0] = MessageType.HEARTBEAT;
  const view = new DataView(tlv.buffer);
  view.setUint32(1, payload.length, false);
  tlv.set(payload, 5);

  const decoded = decodeMessage(tlv);
  assert(decoded !== null, 'v1.0 TLV decoded');
  assertEqual(decoded!.type, MessageType.HEARTBEAT, 'type');
  assert(bytesEqual(decoded!.payload, payload), 'payload');
});

test('decodeMessage: distinguishes v1.0 and v1.2 by magic', () => {
  // v1.2 CMP Frame
  const framePayload = new TextEncoder().encode('v1.2');
  const frame = encodeMessage(MessageType.HEARTBEAT, framePayload);
  const d1 = decodeMessage(frame);
  assert(d1 !== null, 'v1.2 decoded');
  assert(d1!.sequence !== undefined, 'v1.2 has sequence');

  // v1.0 TLV (type byte != 0x43, so not confused with CMP magic)
  const tlvPayload = new TextEncoder().encode('v1.0');
  const tlv = new Uint8Array(5 + tlvPayload.length);
  tlv[0] = MessageType.HEARTBEAT; // 0x30, not 0x43
  new DataView(tlv.buffer).setUint32(1, tlvPayload.length, false);
  tlv.set(tlvPayload, 5);
  const d2 = decodeMessage(tlv);
  assert(d2 !== null, 'v1.0 decoded');
  assertEqual(d2!.sequence, undefined, 'v1.0 no sequence');
});

// ════════════════════════════════════════════
// TV-03: ED25519 SIGN/VERIFY
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-03: Ed25519 ──\x1b[0m');

test('TV-03a: sign produces 64-byte signature', () => {
  const msg = new TextEncoder().encode('test message');
  const sig = sign(msg, kp.secretKey);
  assertEqual(sig.length, 64, '64 bytes');
});

test('TV-03b: verify valid signature', () => {
  const msg = new TextEncoder().encode('test');
  const sig = sign(msg, kp.secretKey);
  assert(verify(msg, sig, kp.publicKey), 'valid');
});

test('TV-03c: reject wrong key', () => {
  const msg = new TextEncoder().encode('test');
  const sig = sign(msg, kp.secretKey);
  const other = generateSigningKeyPair();
  assert(!verify(msg, sig, other.publicKey), 'rejected');
});

test('TV-03d: reject tampered message', () => {
  const msg = new TextEncoder().encode('test');
  const sig = sign(msg, kp.secretKey);
  const tampered = new TextEncoder().encode('tset');
  assert(!verify(tampered, sig, kp.publicKey), 'rejected');
});

test('TV-03e: reject zeroed signature', () => {
  const msg = new TextEncoder().encode('test');
  assert(!verify(msg, new Uint8Array(64), kp.publicKey), 'rejected');
});

test('TV-03f: different messages produce different signatures', () => {
  const sig1 = sign(new TextEncoder().encode('msg1'), kp.secretKey);
  const sig2 = sign(new TextEncoder().encode('msg2'), kp.secretKey);
  assert(!bytesEqual(sig1, sig2), 'different sigs');
});

// ════════════════════════════════════════════
// TV-04: CRC-32C
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-04: CRC-32C (Castagnoli) ──\x1b[0m');

test('TV-04a: empty input = 0x00000000', () => {
  assertEqual(crc32c(new Uint8Array(0)), 0x00000000, 'empty');
});

test('TV-04b: known test vector "123456789"', () => {
  // Standard CRC-32C test vector: "123456789" → 0xE3069283
  const input = new TextEncoder().encode('123456789');
  assertEqual(crc32c(input), 0xE3069283, 'CRC-32C of "123456789"');
});

test('TV-04c: single byte', () => {
  const result = crc32c(new Uint8Array([0x00]));
  assert(result > 0, 'non-zero for single zero byte');
});

test('TV-04d: verifyCRC32C matches crc32c', () => {
  const data = new TextEncoder().encode('hello world');
  const expected = crc32c(data);
  assert(verifyCRC32C(data, expected), 'verify matches');
  assert(!verifyCRC32C(data, expected ^ 1), 'verify rejects mismatch');
});

test('TV-04e: different data produces different CRCs', () => {
  const crc1 = crc32c(new TextEncoder().encode('data1'));
  const crc2 = crc32c(new TextEncoder().encode('data2'));
  assert(crc1 !== crc2, 'different CRCs');
});

test('TV-04f: CRC is deterministic', () => {
  const data = randomBytes(100);
  const crc1 = crc32c(data);
  const crc2 = crc32c(data);
  assertEqual(crc1, crc2, 'deterministic');
});

// ════════════════════════════════════════════
// TV-05: X25519 KEY EXCHANGE
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-05: X25519 Key Exchange ──\x1b[0m');

test('TV-05a: key pairs are 32 bytes', () => {
  const kp = generateExchangeKeyPair();
  assertEqual(kp.publicKey.length, 32, 'public 32');
  assertEqual(kp.secretKey.length, 32, 'secret 32');
});

test('TV-05b: ECDH produces same shared secret on both sides', () => {
  const alice = generateExchangeKeyPair();
  const bob = generateExchangeKeyPair();
  const sharedA = deriveSharedSecret(alice.secretKey, bob.publicKey);
  const sharedB = deriveSharedSecret(bob.secretKey, alice.publicKey);
  assert(bytesEqual(sharedA, sharedB), 'shared secrets match');
  assertEqual(sharedA.length, 32, 'shared secret 32 bytes');
});

test('TV-05c: different key pairs produce different shared secrets', () => {
  const a1 = generateExchangeKeyPair();
  const a2 = generateExchangeKeyPair();
  const b = generateExchangeKeyPair();
  const s1 = deriveSharedSecret(a1.secretKey, b.publicKey);
  const s2 = deriveSharedSecret(a2.secretKey, b.publicKey);
  assert(!bytesEqual(s1, s2), 'different secrets');
});

test('TV-05d: shared secret usable as encryption key', () => {
  const alice = generateExchangeKeyPair();
  const bob = generateExchangeKeyPair();
  const shared = deriveSharedSecret(alice.secretKey, bob.publicKey);
  const plaintext = new TextEncoder().encode('secret message');
  const ciphertext = encrypt(plaintext, shared);
  const decrypted = decrypt(ciphertext, shared);
  assert(bytesEqual(decrypted, plaintext), 'encrypt/decrypt with shared key');
});

// ════════════════════════════════════════════
// TV-06: MER ENCODING ROUND-TRIP
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-06: MER Encoding ──\x1b[0m');

test('TV-06a: MER round-trip preserves all fields', () => {
  const mer = createMER({
    taskType: TaskType.INFERENCE, meshSignature: new Uint8Array([0x11,0x22,0x33,0x44,0x55,0x66,0x77,0x88]),
    deviceCount: 5, strategyUsed: DecompositionStrategy.DATA_PARALLEL,
    chunkCount: 8, avgChunkSizeKb: 5632,
    performance: { totalTimeMs: 12000, distributionOverheadPct: 12, executionEfficiency: 87, faultEvents: 1, reassignmentCount: 1 },
    learnedHints: { optimalChunkSizeKb: 4800, optimalDeviceCount: 6, bestTierMapping: new Uint8Array([0,1,2,2,1]), bottleneckFlags: BottleneckFlag.NETWORK },
    environmentHash: new Uint8Array([0xFE,0xDC,0xBA,0x98,0x76,0x54,0x32,0x10]),
    originMeshHash: new Uint8Array([0xAB,0xCD,0xEF,0x01,0x23,0x45,0x67,0x89]),
    confidence: 87, generation: 3,
  }, kp.secretKey);

  const wire = merToWire(mer);
  const json = JSON.stringify(wire);
  const parsed = JSON.parse(json);
  const restored = merFromWire(parsed);

  assertEqual(toHex(restored.merId), toHex(mer.merId), 'merId');
  assertEqual(restored.taskType, TaskType.INFERENCE, 'taskType');
  assertEqual(restored.deviceCount, 5, 'deviceCount');
  assertEqual(restored.chunkCount, 8, 'chunkCount');
  assertEqual(restored.avgChunkSizeKb, 5632, 'avgChunkSize');
  assertEqual(restored.confidence, 87, 'confidence');
  assertEqual(restored.generation, 3, 'generation');
  assertEqual(restored.performance.totalTimeMs, 12000, 'totalTimeMs');
  assertEqual(restored.performance.faultEvents, 1, 'faultEvents');
  assertEqual(restored.learnedHints.optimalChunkSizeKb, 4800, 'optimalChunk');
  assertEqual(restored.learnedHints.optimalDeviceCount, 6, 'optimalDevices');
  assertEqual(restored.learnedHints.bottleneckFlags, BottleneckFlag.NETWORK, 'bottleneck');
  assertEqual(toHex(restored.meshSignature), '1122334455667788', 'meshSig');
  assertEqual(toHex(restored.environmentHash), 'fedcba9876543210', 'envHash');
  assertEqual(toHex(restored.originMeshHash), 'abcdef0123456789', 'originHash');
});

// ════════════════════════════════════════════
// TV-07: MER SIGNATURE VERIFICATION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-07: MER Signature ──\x1b[0m');

test('TV-07a: valid MER signature verifies', () => {
  const mer = createMER({
    taskType: TaskType.INFERENCE, meshSignature: randomBytes(8), deviceCount: 5,
    strategyUsed: DecompositionStrategy.DATA_PARALLEL, chunkCount: 4, avgChunkSizeKb: 1024,
    performance: { totalTimeMs: 5000, distributionOverheadPct: 10, executionEfficiency: 90, faultEvents: 0, reassignmentCount: 0 },
    learnedHints: { optimalChunkSizeKb: 1000, optimalDeviceCount: 5, bestTierMapping: new Uint8Array(5), bottleneckFlags: 0 },
    environmentHash: randomBytes(8), originMeshHash: randomBytes(8),
  }, kp.secretKey);
  assert(verifyMER(mer, kp.publicKey), 'valid sig');
});

test('TV-07b: signature survives JSON wire round-trip', () => {
  const mer = createMER({
    taskType: TaskType.MAP_REDUCE, meshSignature: randomBytes(8), deviceCount: 3,
    strategyUsed: DecompositionStrategy.MAP_REDUCE, chunkCount: 6, avgChunkSizeKb: 2048,
    performance: { totalTimeMs: 10000, distributionOverheadPct: 15, executionEfficiency: 82, faultEvents: 0, reassignmentCount: 0 },
    learnedHints: { optimalChunkSizeKb: 2000, optimalDeviceCount: 3, bestTierMapping: new Uint8Array([0,1,1,2,0]), bottleneckFlags: BottleneckFlag.CPU },
    environmentHash: randomBytes(8), originMeshHash: randomBytes(8),
  }, kp.secretKey);
  const restored = merFromWire(JSON.parse(JSON.stringify(merToWire(mer))));
  assert(verifyMER(restored, kp.publicKey), 'sig valid after JSON');
});

test('TV-07c: any field tamper breaks signature', () => {
  const mer = createMER({
    taskType: TaskType.INFERENCE, meshSignature: randomBytes(8), deviceCount: 5,
    strategyUsed: DecompositionStrategy.DATA_PARALLEL, chunkCount: 8, avgChunkSizeKb: 4096,
    performance: { totalTimeMs: 8000, distributionOverheadPct: 10, executionEfficiency: 88, faultEvents: 0, reassignmentCount: 0 },
    learnedHints: { optimalChunkSizeKb: 4000, optimalDeviceCount: 5, bestTierMapping: new Uint8Array(5), bottleneckFlags: 0 },
    environmentHash: randomBytes(8), originMeshHash: randomBytes(8),
  }, kp.secretKey);

  // Tamper each critical field
  const tamperers = [
    (m: any) => { m.confidence = 99; },
    (m: any) => { m.deviceCount = 99; },
    (m: any) => { m.chunkCount = 99; },
    (m: any) => { m.learnedHints.optimalChunkSizeKb = 99999; },
    (m: any) => { m.performance.executionEfficiency = 99; },
    (m: any) => { m.taskType = TaskType.PIPELINE; },
    (m: any) => { m.generation = 99; },
  ];

  for (let i = 0; i < tamperers.length; i++) {
    const clone = merFromWire(merToWire(mer)); // deep copy
    tamperers[i](clone);
    assert(!verifyMER(clone, kp.publicKey), `tamper ${i} detected`);
  }
});

// ════════════════════════════════════════════
// TV-08: BLOOM FILTER
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-08: Bloom Filter ──\x1b[0m');

test('TV-08a: bloom filter is 32 bytes (256 bits)', () => {
  assertEqual(BLOOM_BYTES, 32, 'size');
  const b = new BloomFilter();
  assertEqual(b.toBytes().length, 32, 'instance size');
});

test('TV-08b: no false negatives', () => {
  const b = new BloomFilter();
  const items = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  items.forEach(i => b.add(i));
  items.forEach(i => assert(b.test(i), `${i} must be found`));
});

test('TV-08c: false positive rate < 15% with 10 items', () => {
  const b = new BloomFilter();
  for (let i = 0; i < 10; i++) b.add(`item-${i}`);
  let fp = 0;
  const trials = 1000;
  for (let i = 0; i < trials; i++) {
    if (b.test(`nonexistent-${i}`)) fp++;
  }
  const rate = fp / trials;
  assert(rate < 0.15, `FP rate ${(rate * 100).toFixed(1)}% exceeds 15%`);
});

test('TV-08d: fromBytes/toBytes preserves filter state', () => {
  const b1 = new BloomFilter();
  b1.add('test1'); b1.add('test2');
  const b2 = BloomFilter.fromBytes(b1.toBytes());
  assert(b2.test('test1'), 'preserved 1');
  assert(b2.test('test2'), 'preserved 2');
});

// ════════════════════════════════════════════
// TV-09: MESSAGE TYPE REGISTRY
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-09: Message Type Registry ──\x1b[0m');

test('TV-09a: all core message types defined', () => {
  const required: [string, number][] = [
    ['BEACON', 0x01], ['HANDSHAKE_INIT', 0x02], ['HANDSHAKE_RESPONSE', 0x03],
    ['CAPABILITY_EXCHANGE', 0x04], ['TASK_REQUEST', 0x10], ['BID', 0x11],
    ['ASSIGNMENT', 0x12], ['ASSIGNMENT_ACK', 0x13], ['CHUNK_DATA', 0x20],
    ['CHUNK_RESULT', 0x21], ['HEARTBEAT', 0x30], ['DEPARTURE_NOTICE', 0x31],
    ['CHECKPOINT_STORE', 0x40], ['CHECKPOINT_REQUEST', 0x41],
    ['CHECKPOINT_RESPONSE', 0x42], ['CODE_REQUEST', 0x50],
    ['CODE_RESPONSE', 0x51], ['CREDIT_RECEIPT', 0x60],
  ];
  for (const [name, value] of required) {
    assertEqual((MessageType as any)[name], value, `MessageType.${name}`);
  }
});

test('TV-09b: all MCL message types defined (v1.2)', () => {
  assertEqual(MessageType.MER_OFFER, 0x70, 'MER_OFFER');
  assertEqual(MessageType.MER_REQUEST, 0x71, 'MER_REQUEST');
  assertEqual(MessageType.MER_TRANSFER, 0x72, 'MER_TRANSFER');
  assertEqual(MessageType.MER_STORE, 0x73, 'MER_STORE');
  assertEqual(MessageType.MER_QUERY, 0x74, 'MER_QUERY');
});

test('TV-09c: no duplicate message type values', () => {
  const values = Object.values(MessageType).filter(v => typeof v === 'number') as number[];
  const unique = new Set(values);
  assertEqual(unique.size, values.length, 'no duplicates');
});

// ════════════════════════════════════════════
// TV-10: FRAME ENCODE/DECODE STRESS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── TV-10: Frame Stress Tests ──\x1b[0m');

test('TV-10a: empty payload', () => {
  const frame = encodeMessage(MessageType.HEARTBEAT, new Uint8Array(0));
  const decoded = decodeMessage(frame);
  assert(decoded !== null, 'decoded');
  assertEqual(decoded!.payload.length, 0, 'empty payload');
});

test('TV-10b: large payload (64KB)', () => {
  const payload = randomBytes(65536);
  const frame = encodeMessage(MessageType.CHUNK_DATA, payload);
  const decoded = decodeMessage(frame);
  assert(decoded !== null, 'decoded');
  assertEqual(decoded!.payload.length, 65536, '64KB payload');
  assert(bytesEqual(decoded!.payload, payload), 'payload matches');
});

test('TV-10c: all message types encode/decode', () => {
  const types = Object.values(MessageType).filter(v => typeof v === 'number') as number[];
  for (const t of types) {
    const payload = new TextEncoder().encode(`type-${t}`);
    const frame = encodeMessage(t as MessageType, payload);
    const decoded = decodeMessage(frame);
    assert(decoded !== null, `type ${t} decoded`);
    assertEqual(decoded!.type, t, `type ${t} correct`);
  }
});

test('TV-10d: JSON payload round-trip through frame', () => {
  const obj = { task: 'test', values: [1, 2, 3], nested: { a: true } };
  const payload = encodeJSON(obj);
  const frame = encodeMessage(MessageType.TASK_REQUEST, payload);
  const decoded = decodeMessage(frame);
  assert(decoded !== null, 'decoded');
  const restored = decodeJSON(decoded!.payload);
  assertEqual(restored.task, 'test', 'task');
  assertEqual(restored.values.length, 3, 'values');
  assertEqual(restored.nested.a, true, 'nested');
});

test('TV-10e: binary payload integrity', () => {
  // Every byte value 0x00-0xFF
  const payload = new Uint8Array(256);
  for (let i = 0; i < 256; i++) payload[i] = i;
  const frame = encodeMessage(MessageType.CHUNK_DATA, payload);
  const decoded = decodeMessage(frame);
  assert(decoded !== null, 'decoded');
  for (let i = 0; i < 256; i++) {
    assertEqual(decoded!.payload[i], i, `byte ${i}`);
  }
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 17: Wire Protocol Conformance\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
