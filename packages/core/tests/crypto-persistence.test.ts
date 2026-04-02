/**
 * CMP v1.4 — Gap 4 (Crypto) + Gap 2 (Persistence) Test Suite
 *
 * Run: npx ts-node --transpile-only packages/core/tests/crypto-persistence.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';

import {
  generateKeypair, generateId, sign, verify,
  hash32, deriveCompositeId, hashGenome,
  signObject, verifyObject,
} from '../src/lifeform/crypto';
import { CmpDatabase } from '../src/persistence/db';

// ═══════════════════════════════════════
// Crypto Tests
// ═══════════════════════════════════════

describe('Lifeform Crypto', () => {
  it('should generate Ed25519 keypair with correct sizes', () => {
    const kp = generateKeypair();
    assert.equal(kp.publicKey.length, 32);
    assert.equal(kp.secretKey.length, 64);
  });

  it('should generate unique keypairs each time', () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    assert.notDeepEqual(kp1.publicKey, kp2.publicKey);
  });

  it('should generate 16-byte IDs', () => {
    const id = generateId();
    assert.equal(id.length, 16);
  });

  it('should sign and verify messages', () => {
    const kp = generateKeypair();
    const message = new TextEncoder().encode('hello CMP');
    const sig = sign(message, kp.secretKey);

    assert.equal(sig.length, 64);
    assert.equal(verify(message, sig, kp.publicKey), true);
  });

  it('should reject invalid signatures', () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const message = new TextEncoder().encode('hello');
    const sig = sign(message, kp1.secretKey);

    // Wrong key
    assert.equal(verify(message, sig, kp2.publicKey), false);

    // Tampered message
    const tampered = new TextEncoder().encode('hellO');
    assert.equal(verify(tampered, sig, kp1.publicKey), false);
  });

  it('should hash to 32 bytes', () => {
    const h = hash32(new TextEncoder().encode('test'));
    assert.equal(h.length, 32);
  });

  it('should produce deterministic hashes', () => {
    const data = new TextEncoder().encode('deterministic');
    const h1 = hash32(data);
    const h2 = hash32(data);
    assert.deepEqual(h1, h2);
  });

  it('should derive composite ID from two IDs', () => {
    const idA = generateId();
    const idB = generateId();
    const composite = deriveCompositeId(idA, idB);

    assert.equal(composite.length, 16);
    // Deterministic
    assert.deepEqual(composite, deriveCompositeId(idA, idB));
    // Order matters
    assert.notDeepEqual(composite, deriveCompositeId(idB, idA));
  });

  it('should hash genome (WASM bytes)', () => {
    const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
    const h = hashGenome(wasm);
    assert.equal(h.length, 32);
  });

  it('should sign and verify objects', () => {
    const kp = generateKeypair();
    const obj = { name: 'sensor-1', temp: 25, id: generateId() };
    const sig = signObject(obj, kp.secretKey);

    assert.equal(sig.length, 64);
    assert.equal(verifyObject(obj, sig, kp.publicKey), true);

    // Tampered object
    const tampered = { ...obj, temp: 30 };
    assert.equal(verifyObject(tampered, sig, kp.publicKey), false);
  });
});

// ═══════════════════════════════════════
// Persistence Tests
// ═══════════════════════════════════════

describe('CmpDatabase', () => {
  let db: CmpDatabase;
  const testDbPath = '/tmp/cmp-test.sqlite';

  beforeEach(async () => {
    // Clean up
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new CmpDatabase(testDbPath);
    await db.init();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('should initialize and create tables', () => {
    const stats = db.getStats();
    assert.equal(stats.lifeforms, 0);
    assert.equal(stats.intents, 0);
    assert.equal(stats.synapses, 0);
  });

  it('should save and load a Lifeform', () => {
    const soul = {
      id: generateId(),
      name: 'test-sensor',
      publicKey: generateKeypair().publicKey,
      secretKey: generateKeypair().secretKey,
      creatorId: generateId(),
      bornAt: Date.now(),
      generation: 0,
      parentId: null,
    };

    const instance = {
      soul,
      state: 'alive',
      config: { name: 'test-sensor', wasmModule: new Uint8Array([0, 0x61, 0x73, 0x6d]), initialCcu: 100 },
      genomeHash: hash32(new Uint8Array([0, 0x61, 0x73, 0x6d])),
      hostId: generateId(),
      ccuBalance: 95.5,
      causesProcessed: 42,
      ccuEarned: 10,
      ccuSpent: 14.5,
    };

    const idHex = Array.from(soul.id).map(b => b.toString(16).padStart(2, '0')).join('');
    db.saveLifeform(instance);

    const loaded = db.loadLifeform(idHex);
    assert.ok(loaded);
    assert.equal(loaded.name, 'test-sensor');
    assert.equal(loaded.state, 'alive');
    assert.equal(loaded.ccuBalance, 95.5);
    assert.equal(loaded.causesProcessed, 42);
    assert.equal(loaded.soul.name, 'test-sensor');
    assert.equal(loaded.soul.publicKey.length, 32);
  });

  it('should load all alive Lifeforms', () => {
    for (let i = 0; i < 3; i++) {
      const soul = { id: generateId(), name: `lf-${i}`, publicKey: new Uint8Array(32), secretKey: new Uint8Array(64), creatorId: generateId(), bornAt: Date.now(), generation: 0, parentId: null };
      db.saveLifeform({ soul, state: i < 2 ? 'alive' : 'dead', config: {}, genomeHash: null, hostId: generateId(), ccuBalance: 50, causesProcessed: 0, ccuEarned: 0, ccuSpent: 0 });
    }

    const alive = db.loadAllLifeforms();
    assert.equal(alive.length, 2); // Only alive, not dead
  });

  it('should update Lifeform state', () => {
    const soul = { id: generateId(), name: 'updater', publicKey: new Uint8Array(32), secretKey: new Uint8Array(64), creatorId: generateId(), bornAt: Date.now(), generation: 0, parentId: null };
    const idHex = Array.from(soul.id).map(b => b.toString(16).padStart(2, '0')).join('');
    db.saveLifeform({ soul, state: 'alive', config: {}, genomeHash: null, hostId: generateId(), ccuBalance: 100, causesProcessed: 0, ccuEarned: 0, ccuSpent: 0 });

    db.updateLifeformState(idHex, 'migrating', 88.5, 15);

    const loaded = db.loadLifeform(idHex);
    assert.equal(loaded!.state, 'migrating');
    assert.equal(loaded!.ccuBalance, 88.5);
    assert.equal(loaded!.causesProcessed, 15);
  });

  it('should save and load CRDT snapshots', () => {
    const lfId = 'test-lf-001';
    db.saveSnapshot(lfId, '{"key":"value"}', 128, 1);
    db.saveSnapshot(lfId, '{"key":"updated"}', 256, 2);

    const latest = db.loadLatestSnapshot(lfId);
    assert.ok(latest);
    assert.equal(latest.sequence, 2);
    assert.equal(latest.snapshotJson, '{"key":"updated"}');
  });

  it('should save and load intents', () => {
    const lfId = 'lf-abc';
    db.saveIntent('intent-1', lfId, '{"description":"temp < 30"}');
    db.saveIntent('intent-2', lfId, '{"description":"humidity > 40"}');

    const intents = db.loadIntentsForLifeform(lfId);
    assert.equal(intents.length, 2);
  });

  it('should delete intents', () => {
    db.saveIntent('intent-del', 'lf-1', '{}');
    db.deleteIntent('intent-del');
    assert.equal(db.loadIntentsForLifeform('lf-1').length, 0);
  });

  it('should save and load generations', () => {
    db.saveGeneration('lf-1', 1, '{"winner":"mutant"}');
    db.saveGeneration('lf-1', 2, '{"winner":"parent"}');

    const gens = db.loadGenerations('lf-1');
    assert.equal(gens.length, 2);
    assert.equal(gens[0].generation, 1);
  });

  it('should save and load synapses', () => {
    db.saveSynapse('syn-1', 'sensor', 'processor', 0.75, 42, 5.5);
    db.saveSynapse('syn-2', 'processor', 'monitor', 0.3, 10, 1.0);

    const synapses = db.loadAllSynapses();
    assert.equal(synapses.length, 2);
    assert.equal(synapses[0].fromName, 'sensor');
    assert.equal(synapses[0].strength, 0.75);
  });

  it('should save and load DNS records', () => {
    db.saveDnsRecord('sensor-1', 'lf-abc', 'host-xyz', null, 1);
    db.saveDnsRecord('sensor-2', 'lf-def', 'host-xyz', 'composite', 2);

    const records = db.loadAllDnsRecords();
    assert.equal(records.length, 2);
    assert.equal(records[1].redirect, 'composite');
  });

  it('should persist to disk and reload', async () => {
    const soul = { id: generateId(), name: 'persist-test', publicKey: new Uint8Array(32), secretKey: new Uint8Array(64), creatorId: generateId(), bornAt: Date.now(), generation: 0, parentId: null };
    db.saveLifeform({ soul, state: 'alive', config: {}, genomeHash: null, hostId: generateId(), ccuBalance: 77, causesProcessed: 5, ccuEarned: 0, ccuSpent: 0 });
    db.saveDnsRecord('persist-test', 'lf-1', 'host-1', null, 1);
    db.close();

    // Reload from disk
    const db2 = new CmpDatabase(testDbPath);
    await db2.init();

    const alive = db2.loadAllLifeforms();
    assert.equal(alive.length, 1);
    assert.equal(alive[0].name, 'persist-test');
    assert.equal(alive[0].ccuBalance, 77);

    const dns = db2.loadAllDnsRecords();
    assert.equal(dns.length, 1);

    db2.close();
    db = new CmpDatabase('/tmp/cmp-dummy.sqlite'); // Prevent afterEach from double-closing
    await db.init();
  });

  it('should clear all data', () => {
    db.saveDnsRecord('test', 'lf', 'host', null, 1);
    db.saveIntent('i1', 'lf', '{}');
    db.clear();

    const stats = db.getStats();
    assert.equal(stats.dns_records, 0);
    assert.equal(stats.intents, 0);
  });

  it('should get stats', () => {
    db.saveDnsRecord('a', 'lf', 'h', null, 1);
    db.saveDnsRecord('b', 'lf', 'h', null, 1);
    db.saveSynapse('s1', 'a', 'b', 0.5, 0, 0);

    const stats = db.getStats();
    assert.equal(stats.dns_records, 2);
    assert.equal(stats.synapses, 1);
  });
});

// ═══════════════════════════════════════
// Crypto + Manager Integration
// ═══════════════════════════════════════

describe('Manager with Real Crypto', () => {
  it('should spawn Lifeforms with real Ed25519 keys', async () => {
    const { LifeformManager } = await import('../src/lifeform/manager');

    const mgr = new LifeformManager({ deviceId: 'test-dev' });
    mgr.start();

    const hosted = mgr.spawn({
      name: 'crypto-test',
      wasmModule: new Uint8Array([0, 0x61, 0x73, 0x6d]),
      initialCcu: 100,
      minReplicas: 1, maxReplicas: 3, autoMigrate: true,
      mutationLibraryHash: null, maxCausesPerSecond: 100, maxStateSizeBytes: 1024 * 1024,
    });

    assert.ok(hosted);
    const soul = hosted.lifecycle.soul;

    // Real Ed25519 keys
    assert.equal(soul.publicKey.length, 32);
    assert.equal(soul.secretKey.length, 64);

    // Keys should be usable for signing
    const msg = new TextEncoder().encode('test');
    const sig = sign(msg, soul.secretKey);
    assert.equal(verify(msg, sig, soul.publicKey), true);

    mgr.stop();
  });
});
