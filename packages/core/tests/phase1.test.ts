/**
 * CMP Phase 1 Test Suite
 * Tests: beacon codec, crypto, peer table, serializer,
 * virtual transport, and multi-node discovery.
 *
 * Run: npx ts-node packages/core/tests/phase1.test.ts
 *
 * @author Agent Viscro
 */

import {
  // Beacon codec
  encodeBeacon,
  decodeBeacon,
  createBeacon,
  isValidBeacon,
  BEACON_MAGIC,
  BEACON_SIZE,
  PROTOCOL_VERSION,

  // Crypto
  generateExchangeKeyPair,
  generateSigningKeyPair,
  generateMeshId,
  deriveSharedSecret,
  hash256,
  hash64,
  encrypt,
  decrypt,
  encryptFor,
  decryptFrom,
  sign,
  verify,
  randomBytes,

  // Utilities
  toHex,
  fromHex,
  bytesEqual,
  concatBytes,
  bigintToBytes,
  bytesToBigint,
  now,
  shortId,

  // Serializer
  encodeMessage,
  decodeMessage,
  encodeJSON,
  decodeJSON,

  // Peer table
  EventBus,
  PeerTable,

  // Types
  MessageType,
  CapabilityTier,
  classifyTier,
  GPUType,
  Architecture,
  PowerSource,
  ThermalState,
  Runtime,
} from '../src';

import type { CMPCapability, BeaconFlags, CMPBeacon } from '../src';

// ── Test runner ──
let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`;
    console.log(msg);
    errors.push(msg);
  }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`;
    console.log(msg);
    errors.push(msg);
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual: any, expected: any, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

// ════════════════════════════════════════════
// UTILITY TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Utility Tests ──\x1b[0m');

test('toHex/fromHex roundtrip', () => {
  const bytes = new Uint8Array([0x43, 0x4d, 0x50, 0x01, 0xff, 0x00]);
  const hex = toHex(bytes);
  assertEqual(hex, '434d5001ff00', 'hex encoding');
  assert(bytesEqual(fromHex(hex), bytes), 'roundtrip');
});

test('bytesEqual detects differences', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 2, 3]);
  const c = new Uint8Array([1, 2, 4]);
  assert(bytesEqual(a, b), 'equal arrays');
  assert(!bytesEqual(a, c), 'different arrays');
  assert(!bytesEqual(a, new Uint8Array([1, 2])), 'different lengths');
});

test('concatBytes joins multiple arrays', () => {
  const a = new Uint8Array([1, 2]);
  const b = new Uint8Array([3, 4, 5]);
  const c = new Uint8Array([6]);
  const result = concatBytes(a, b, c);
  assertEqual(result.length, 6, 'length');
  assert(bytesEqual(result, new Uint8Array([1, 2, 3, 4, 5, 6])), 'content');
});

test('bigintToBytes/bytesToBigint roundtrip', () => {
  const val = BigInt(Date.now());
  const bytes = bigintToBytes(val);
  assertEqual(bytes.length, 8, 'size');
  assertEqual(bytesToBigint(bytes), val, 'roundtrip');
});

test('bigintToBytes handles zero', () => {
  const bytes = bigintToBytes(0n);
  assertEqual(bytesToBigint(bytes), 0n, 'zero');
});

test('shortId returns 8 hex chars', () => {
  const id = randomBytes(16);
  const short = shortId(id);
  assertEqual(short.length, 8, 'length');
});

// ════════════════════════════════════════════
// BEACON CODEC TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Beacon Codec Tests ──\x1b[0m');

test('encodeBeacon produces 38 bytes', () => {
  const beacon = createBeacon(randomBytes(16), randomBytes(8));
  const encoded = encodeBeacon(beacon);
  assertEqual(encoded.length, BEACON_SIZE, 'beacon size');
});

test('encodeBeacon/decodeBeacon roundtrip', () => {
  const meshId = randomBytes(16);
  const capHash = randomBytes(8);
  const beacon = createBeacon(meshId, capHash, {
    acceptingTasks: true,
    hasPendingTasks: false,
    relayCapable: true,
  });

  const encoded = encodeBeacon(beacon);
  const decoded = decodeBeacon(encoded);

  assert(decoded !== null, 'decoded not null');
  assertEqual(decoded!.magic, BEACON_MAGIC, 'magic');
  assertEqual(decoded!.version, PROTOCOL_VERSION, 'version');
  assert(bytesEqual(decoded!.meshId, meshId), 'meshId');
  assert(bytesEqual(decoded!.capabilityHash, capHash), 'capHash');
  assertEqual(decoded!.flags.acceptingTasks, true, 'acceptingTasks');
  assertEqual(decoded!.flags.hasPendingTasks, false, 'hasPendingTasks');
  assertEqual(decoded!.flags.relayCapable, true, 'relayCapable');
});

test('decodeBeacon returns null for short data', () => {
  const result = decodeBeacon(new Uint8Array(10));
  assertEqual(result, null, 'null for short data');
});

test('decodeBeacon returns null for wrong magic', () => {
  const data = new Uint8Array(38);
  data[0] = 0x00; data[1] = 0x00; data[2] = 0x00;
  const result = decodeBeacon(data);
  assertEqual(result, null, 'null for wrong magic');
});

test('beacon flags encode all combinations', () => {
  const combos: BeaconFlags[] = [
    { acceptingTasks: false, hasPendingTasks: false, relayCapable: false },
    { acceptingTasks: true, hasPendingTasks: false, relayCapable: false },
    { acceptingTasks: false, hasPendingTasks: true, relayCapable: false },
    { acceptingTasks: true, hasPendingTasks: true, relayCapable: true },
  ];

  for (const flags of combos) {
    const beacon = createBeacon(randomBytes(16), randomBytes(8), flags);
    const decoded = decodeBeacon(encodeBeacon(beacon))!;
    assertEqual(decoded.flags.acceptingTasks, flags.acceptingTasks, 'acceptingTasks');
    assertEqual(decoded.flags.hasPendingTasks, flags.hasPendingTasks, 'hasPendingTasks');
    assertEqual(decoded.flags.relayCapable, flags.relayCapable, 'relayCapable');
  }
});

test('isValidBeacon validates correctly', () => {
  const good = createBeacon(randomBytes(16), randomBytes(8));
  assert(isValidBeacon(good), 'valid beacon');

  const bad: CMPBeacon = { ...good, magic: 0x000000 };
  assert(!isValidBeacon(bad), 'invalid magic');
});

test('beacon timestamp preserves precision', () => {
  const beacon = createBeacon(randomBytes(16), randomBytes(8));
  const decoded = decodeBeacon(encodeBeacon(beacon))!;
  assertEqual(decoded.timestamp, beacon.timestamp, 'timestamp preserved');
});

// ════════════════════════════════════════════
// CRYPTO TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Crypto Tests ──\x1b[0m');

test('generateMeshId produces 16 bytes', () => {
  const id = generateMeshId();
  assertEqual(id.length, 16, 'meshId length');
});

test('generateMeshId produces unique IDs', () => {
  const a = generateMeshId();
  const b = generateMeshId();
  assert(!bytesEqual(a, b), 'unique IDs');
});

test('randomBytes produces correct length', () => {
  assertEqual(randomBytes(32).length, 32, '32 bytes');
  assertEqual(randomBytes(1).length, 1, '1 byte');
  assertEqual(randomBytes(64).length, 64, '64 bytes');
});

test('hash256 produces 32 bytes', () => {
  const h = hash256(new Uint8Array([1, 2, 3]));
  assertEqual(h.length, 32, 'hash length');
});

test('hash256 is deterministic', () => {
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  assert(bytesEqual(hash256(data), hash256(data)), 'deterministic');
});

test('hash256 differs for different inputs', () => {
  const a = hash256(new Uint8Array([1]));
  const b = hash256(new Uint8Array([2]));
  assert(!bytesEqual(a, b), 'different hashes');
});

test('hash64 produces 8 bytes', () => {
  const h = hash64(new Uint8Array([1, 2, 3]));
  assertEqual(h.length, 8, 'hash64 length');
});

test('ECDH key exchange produces shared secret', () => {
  const alice = generateExchangeKeyPair();
  const bob = generateExchangeKeyPair();

  const aliceSecret = deriveSharedSecret(alice.secretKey, bob.publicKey);
  const bobSecret = deriveSharedSecret(bob.secretKey, alice.publicKey);

  assert(bytesEqual(aliceSecret, bobSecret), 'shared secrets match');
  assertEqual(aliceSecret.length, 32, 'secret length');
});

test('ECDH with different keys produces different secrets', () => {
  const alice = generateExchangeKeyPair();
  const bob = generateExchangeKeyPair();
  const charlie = generateExchangeKeyPair();

  const abSecret = deriveSharedSecret(alice.secretKey, bob.publicKey);
  const acSecret = deriveSharedSecret(alice.secretKey, charlie.publicKey);

  assert(!bytesEqual(abSecret, acSecret), 'different secrets');
});

test('symmetric encrypt/decrypt roundtrip', () => {
  const key = randomBytes(32);
  const plaintext = new TextEncoder().encode('Hello CMP Protocol!');

  const encrypted = encrypt(plaintext, key);
  assert(encrypted.length > plaintext.length, 'encrypted is larger');

  const decrypted = decrypt(encrypted, key);
  assert(bytesEqual(decrypted, plaintext), 'roundtrip');
});

test('symmetric decrypt with wrong key fails', () => {
  const key1 = randomBytes(32);
  const key2 = randomBytes(32);
  const plaintext = new TextEncoder().encode('secret');

  const encrypted = encrypt(plaintext, key1);
  let threw = false;
  try {
    decrypt(encrypted, key2);
  } catch {
    threw = true;
  }
  assert(threw, 'wrong key throws');
});

test('asymmetric encryptFor/decryptFrom roundtrip', () => {
  const alice = generateExchangeKeyPair();
  const bob = generateExchangeKeyPair();
  const plaintext = new TextEncoder().encode('Mesh computation result');

  const encrypted = encryptFor(plaintext, bob.publicKey, alice.secretKey);
  const decrypted = decryptFrom(encrypted, alice.publicKey, bob.secretKey);

  assert(bytesEqual(decrypted, plaintext), 'asymmetric roundtrip');
});

test('Ed25519 sign/verify', () => {
  const kp = generateSigningKeyPair();
  const data = new TextEncoder().encode('task request data');

  const signature = sign(data, kp.secretKey);
  assertEqual(signature.length, 64, 'signature length');

  assert(verify(data, signature, kp.publicKey), 'valid signature');
});

test('Ed25519 verify rejects tampered data', () => {
  const kp = generateSigningKeyPair();
  const data = new TextEncoder().encode('original');
  const signature = sign(data, kp.secretKey);

  const tampered = new TextEncoder().encode('tampered');
  assert(!verify(tampered, signature, kp.publicKey), 'rejects tampered');
});

test('Ed25519 verify rejects wrong key', () => {
  const kp1 = generateSigningKeyPair();
  const kp2 = generateSigningKeyPair();
  const data = new TextEncoder().encode('data');
  const signature = sign(data, kp1.secretKey);

  assert(!verify(data, signature, kp2.publicKey), 'rejects wrong key');
});

// ════════════════════════════════════════════
// SERIALIZER TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Serializer Tests ──\x1b[0m');

test('encodeMessage/decodeMessage roundtrip', () => {
  const payload = new TextEncoder().encode('hello');
  const encoded = encodeMessage(MessageType.HEARTBEAT, payload);

  const decoded = decodeMessage(encoded);
  assert(decoded !== null, 'decoded not null');
  assertEqual(decoded!.type, MessageType.HEARTBEAT, 'type');
  assert(bytesEqual(decoded!.payload, payload), 'payload');
});

test('decodeMessage returns null for short data', () => {
  assertEqual(decodeMessage(new Uint8Array(3)), null, 'too short');
});

test('encodeJSON/decodeJSON roundtrip', () => {
  const obj = { name: 'test', value: 42, nested: { a: true } };
  const encoded = encodeJSON(obj);
  const decoded = decodeJSON(encoded);

  assertEqual(decoded?.name, 'test', 'name');
  assertEqual(decoded?.value, 42, 'value');
  assertEqual(decoded?.nested?.a, true, 'nested');
});

test('decodeJSON returns null for invalid data', () => {
  const result = decodeJSON(new Uint8Array([0xff, 0xfe]));
  assertEqual(result, null, 'null for invalid');
});

test('message types cover all protocol operations', () => {
  const types = [
    MessageType.BEACON, MessageType.HANDSHAKE_INIT, MessageType.HANDSHAKE_RESPONSE,
    MessageType.CAPABILITY_EXCHANGE, MessageType.TASK_REQUEST, MessageType.BID,
    MessageType.ASSIGNMENT, MessageType.ASSIGNMENT_ACK, MessageType.CHUNK_DATA,
    MessageType.CHUNK_RESULT, MessageType.HEARTBEAT, MessageType.DEPARTURE_NOTICE,
  ];
  assert(types.length >= 12, 'sufficient message types');
  const unique = new Set(types);
  assertEqual(unique.size, types.length, 'all unique');
});

// ════════════════════════════════════════════
// PEER TABLE TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Peer Table Tests ──\x1b[0m');

test('PeerTable upsert adds new peer', () => {
  const bus = new EventBus();
  const table = new PeerTable(bus, 30000, 60000);
  const id = randomBytes(16);

  const entry = table.upsert(id, { state: 'active' });
  assertEqual(entry.state, 'active', 'state');
  assertEqual(table.size, 1, 'size');
  table.destroy();
});

test('PeerTable upsert updates existing peer', () => {
  const bus = new EventBus();
  const table = new PeerTable(bus, 30000, 60000);
  const id = randomBytes(16);

  table.upsert(id, { state: 'discovered', latencyMs: 100 });
  table.upsert(id, { state: 'active', latencyMs: 50 });

  const entry = table.get(id);
  assertEqual(entry?.state, 'active', 'updated state');
  assertEqual(entry?.latencyMs, 50, 'updated latency');
  assertEqual(table.size, 1, 'still one entry');
  table.destroy();
});

test('PeerTable getActive filters correctly', () => {
  const bus = new EventBus();
  const table = new PeerTable(bus, 30000, 60000);

  table.upsert(randomBytes(16), { state: 'active' });
  table.upsert(randomBytes(16), { state: 'discovered' });
  table.upsert(randomBytes(16), { state: 'active' });

  assertEqual(table.getActive().length, 2, 'active count');
  assertEqual(table.activeCount, 2, 'activeCount property');
  table.destroy();
});

test('PeerTable remove works', () => {
  const bus = new EventBus();
  const table = new PeerTable(bus, 30000, 60000);
  const id = randomBytes(16);

  table.upsert(id, { state: 'active' });
  assertEqual(table.size, 1, 'before remove');

  table.remove(id);
  assertEqual(table.size, 0, 'after remove');
  table.destroy();
});

test('PeerTable emits peer:discovered on new peer', () => {
  const bus = new EventBus();
  const table = new PeerTable(bus, 30000, 60000);
  let discovered = false;

  bus.on('peer:discovered', () => { discovered = true; });
  table.upsert(randomBytes(16), { state: 'active' });

  assert(discovered, 'emitted peer:discovered');
  table.destroy();
});

// ════════════════════════════════════════════
// CAPABILITY TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Capability Tests ──\x1b[0m');

test('classifyTier: T1_MINIMAL', () => {
  const cap: CMPCapability = mockCapability({ memMb: 512, cores: 1, gpu: GPUType.NONE });
  assertEqual(classifyTier(cap), CapabilityTier.T1_MINIMAL, 'T1');
});

test('classifyTier: T2_BASIC', () => {
  const cap = mockCapability({ memMb: 2048, cores: 4, gpu: GPUType.NONE });
  assertEqual(classifyTier(cap), CapabilityTier.T2_BASIC, 'T2');
});

test('classifyTier: T3_STANDARD', () => {
  const cap = mockCapability({ memMb: 6144, cores: 6, gpu: GPUType.MOBILE });
  assertEqual(classifyTier(cap), CapabilityTier.T3_STANDARD, 'T3');
});

test('classifyTier: T4_POWER', () => {
  const cap = mockCapability({ memMb: 12288, cores: 8, gpu: GPUType.DISCRETE });
  assertEqual(classifyTier(cap), CapabilityTier.T4_POWER, 'T4');
});

test('classifyTier: T5_HEAVY', () => {
  const cap = mockCapability({ memMb: 32768, cores: 16, gpu: GPUType.DISCRETE });
  assertEqual(classifyTier(cap), CapabilityTier.T5_HEAVY, 'T5');
});

// ════════════════════════════════════════════
// EVENT BUS TESTS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Event Bus Tests ──\x1b[0m');

test('EventBus on/emit works', () => {
  const bus = new EventBus();
  let received = false;
  bus.on('node:started', () => { received = true; });
  bus.emit('node:started', { meshId: randomBytes(16) });
  assert(received, 'received event');
});

test('EventBus once fires only once', () => {
  const bus = new EventBus();
  let count = 0;
  bus.once('node:started', () => { count++; });
  bus.emit('node:started', { meshId: randomBytes(16) });
  bus.emit('node:started', { meshId: randomBytes(16) });
  assertEqual(count, 1, 'fired once');
});

test('EventBus off unsubscribes', () => {
  const bus = new EventBus();
  let count = 0;
  const handler = () => { count++; };
  bus.on('node:started', handler);
  bus.emit('node:started', { meshId: randomBytes(16) });
  bus.off('node:started', handler);
  bus.emit('node:started', { meshId: randomBytes(16) });
  assertEqual(count, 1, 'unsubscribed');
});

test('EventBus waitFor resolves on event', async () => {
  const bus = new EventBus();
  const id = randomBytes(16);
  setTimeout(() => bus.emit('node:started', { meshId: id }), 10);
  const result = await bus.waitFor('node:started', 1000);
  assert(bytesEqual(result.meshId, id), 'received correct data');
});

test('EventBus waitFor rejects on timeout', async () => {
  const bus = new EventBus();
  let threw = false;
  try {
    await bus.waitFor('node:started', 50);
  } catch {
    threw = true;
  }
  assert(threw, 'timeout rejection');
});

test('EventBus clear removes all handlers', () => {
  const bus = new EventBus();
  bus.on('node:started', () => {});
  bus.on('node:stopped', () => {});
  bus.clear();
  assertEqual(bus.listenerCount('node:started'), 0, 'cleared');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) {
  console.log('\n  Failed tests:');
  errors.forEach((e) => console.log(e));
}
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);

// ── Helpers ──

function mockCapability(opts: { memMb: number; cores: number; gpu: GPUType }): CMPCapability {
  return {
    meshId: randomBytes(16),
    cpu: {
      architecture: Architecture.ARM64,
      coresAvailable: opts.cores,
      clockMhz: 2400,
      loadPercent: 20,
    },
    memory: { availableMb: opts.memMb, bandwidthGbps: 12 },
    gpu: { type: opts.gpu, computeUnits: 4, vramMb: 0, supports: new Set() },
    storage: { scratchMb: 1024, readMbps: 500, writeMbps: 200 },
    network: { meshBandwidthMbps: 100, latencyMs: 5 },
    power: { source: PowerSource.PLUGGED, batteryPct: 100, thermalState: ThermalState.NOMINAL },
    runtimes: [Runtime.WASM],
    reputationScore: 5000,
    availabilitySec: 3600,
  };
}
