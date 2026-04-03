/**
 * CMP v3.0 — Holographic State Tests
 *
 * Tests Reed-Solomon erasure coding and MeshMemory distributed storage.
 * Uses mock transport for deterministic testing.
 *
 * Run: npx tsx packages/core/tests/holographic.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  rsEncode,
  rsDecode,
  calculateShardCounts,
  simpleHash,
  verifyShard,
} from '../src/holographic/erasure';

import { MeshMemory } from '../src/holographic/mesh-memory';
import type { MeshMemoryPeer, MeshMemoryTransport } from '../src/holographic/mesh-memory';
import type { ShardDescriptor } from '../src/types/holographic';

// ─── Mock Transport ───

class MockTransport implements MeshMemoryTransport {
  private localId: string;
  private peers: MeshMemoryPeer[];
  /** Simulate remote storage: deviceId → (key:index → shard) */
  private remoteShards = new Map<string, Map<string, ShardDescriptor>>();

  constructor(localId: string, peerIds: string[]) {
    this.localId = localId;
    this.peers = peerIds.map(id => ({
      deviceId: id,
      availableBytes: 268435456,
      latencyMs: 5,
    }));
    for (const id of peerIds) {
      this.remoteShards.set(id, new Map());
    }
  }

  getPeers(): MeshMemoryPeer[] {
    return this.peers;
  }

  getLocalDeviceId(): string {
    return this.localId;
  }

  async sendShard(peerId: string, shard: ShardDescriptor): Promise<boolean> {
    const store = this.remoteShards.get(peerId);
    if (!store) return false;
    store.set(`${shard.key}:${shard.shardIndex}`, shard);
    return true;
  }

  async requestShard(peerId: string, key: string, shardIndex: number): Promise<ShardDescriptor | null> {
    const store = this.remoteShards.get(peerId);
    if (!store) return null;
    return store.get(`${key}:${shardIndex}`) ?? null;
  }

  async queryShardLocations() {
    return [];
  }

  /** Test helper: remove a peer's shard (simulate device failure) */
  removePeerShard(peerId: string, key: string, shardIndex: number): void {
    const store = this.remoteShards.get(peerId);
    if (store) store.delete(`${key}:${shardIndex}`);
  }

  /** Test helper: kill a peer (remove all shards) */
  killPeer(peerId: string): void {
    this.remoteShards.delete(peerId);
    this.peers = this.peers.filter(p => p.deviceId !== peerId);
  }

  /** Test helper: get shard count on a peer */
  getPeerShardCount(peerId: string): number {
    return this.remoteShards.get(peerId)?.size ?? 0;
  }
}

// ═══════════════════════════════════════
// Reed-Solomon Erasure Coding Tests
// ═══════════════════════════════════════

describe('Reed-Solomon Erasure Coding', () => {

  describe('Encode + Decode (basic)', () => {
    it('should encode and decode with k=2, m=1 (3 shards)', () => {
      const data = new Uint8Array([10, 20, 30, 40, 50, 60]);
      const shards = rsEncode(data, 2, 1);

      assert.equal(shards.length, 3, 'Should produce 3 shards');
      assert.equal(shards[0].length, shards[1].length, 'All shards same length');

      // Reconstruct from data shards only (indices 0, 1)
      const recovered = rsDecode(
        [{ index: 0, data: shards[0] }, { index: 1, data: shards[1] }],
        2, 3, data.length,
      );
      assert.deepEqual(recovered, data, 'Should recover original from data shards');
    });

    it('should reconstruct from any k=2 of n=3 shards', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const shards = rsEncode(data, 2, 1);

      // Using shards 0 and 2 (one data, one parity)
      const r1 = rsDecode(
        [{ index: 0, data: shards[0] }, { index: 2, data: shards[2] }],
        2, 3, data.length,
      );
      assert.deepEqual(r1, data, 'Recover from shards [0,2]');

      // Using shards 1 and 2 (one data, one parity)
      const r2 = rsDecode(
        [{ index: 1, data: shards[1] }, { index: 2, data: shards[2] }],
        2, 3, data.length,
      );
      assert.deepEqual(r2, data, 'Recover from shards [1,2]');
    });

    it('should handle k=1, m=1 (simplest case)', () => {
      const data = new Uint8Array([42, 99, 200]);
      const shards = rsEncode(data, 1, 1);

      assert.equal(shards.length, 2);

      // Recover from data shard
      const r1 = rsDecode([{ index: 0, data: shards[0] }], 1, 2, data.length);
      assert.deepEqual(r1, data);

      // Recover from parity shard
      const r2 = rsDecode([{ index: 1, data: shards[1] }], 1, 2, data.length);
      assert.deepEqual(r2, data);
    });

    it('should handle k=3, m=2 (5 total shards)', () => {
      const data = new Uint8Array(300);
      for (let i = 0; i < 300; i++) data[i] = i % 256;

      const shards = rsEncode(data, 3, 2);
      assert.equal(shards.length, 5);

      // Recover from shards [0, 2, 4] — skip shard 1 and 3
      const recovered = rsDecode(
        [
          { index: 0, data: shards[0] },
          { index: 2, data: shards[2] },
          { index: 4, data: shards[4] },
        ],
        3, 5, data.length,
      );
      assert.deepEqual(recovered, data);
    });
  });

  describe('Edge cases', () => {
    it('should handle single-byte data', () => {
      const data = new Uint8Array([77]);
      const shards = rsEncode(data, 1, 1);
      const recovered = rsDecode([{ index: 1, data: shards[1] }], 1, 2, 1);
      assert.deepEqual(recovered, data);
    });

    it('should handle data that needs padding', () => {
      // 7 bytes with k=3 → each shard = ceil(7/3) = 3 bytes → padded to 9
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
      const shards = rsEncode(data, 3, 1);
      assert.equal(shards.length, 4);
      assert.equal(shards[0].length, 3); // ceil(7/3)

      const recovered = rsDecode(
        [
          { index: 0, data: shards[0] },
          { index: 1, data: shards[1] },
          { index: 2, data: shards[2] },
        ],
        3, 4, data.length,
      );
      assert.deepEqual(recovered, data);
    });

    it('should handle all-zeros data', () => {
      const data = new Uint8Array(16);
      const shards = rsEncode(data, 2, 2);
      const recovered = rsDecode(
        [{ index: 1, data: shards[1] }, { index: 3, data: shards[3] }],
        2, 4, 16,
      );
      assert.deepEqual(recovered, data);
    });

    it('should handle all-255 data', () => {
      const data = new Uint8Array(10).fill(255);
      const shards = rsEncode(data, 2, 1);
      const recovered = rsDecode(
        [{ index: 0, data: shards[0] }, { index: 2, data: shards[2] }],
        2, 3, 10,
      );
      assert.deepEqual(recovered, data);
    });

    it('should reject decode with insufficient shards', () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const shards = rsEncode(data, 2, 1);

      assert.throws(() => {
        rsDecode([{ index: 0, data: shards[0] }], 2, 3, 4);
      }, /Need at least 2 shards/);
    });

    it('should reject k=0', () => {
      assert.throws(() => rsEncode(new Uint8Array([1]), 0, 1), /k must be >= 1/);
    });
  });

  describe('Larger data', () => {
    it('should handle 1KB data with k=4, m=2', () => {
      const data = new Uint8Array(1024);
      for (let i = 0; i < 1024; i++) data[i] = (i * 7 + 13) % 256;

      const shards = rsEncode(data, 4, 2);
      assert.equal(shards.length, 6);

      // Lose shards 1 and 3
      const recovered = rsDecode(
        [
          { index: 0, data: shards[0] },
          { index: 2, data: shards[2] },
          { index: 4, data: shards[4] },
          { index: 5, data: shards[5] },
        ],
        4, 6, data.length,
      );
      assert.deepEqual(recovered, data);
    });
  });

  describe('Shard integrity', () => {
    it('should generate and verify checksums', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const checksum = simpleHash(data);
      assert.equal(checksum.length, 4);
      assert.ok(verifyShard(data, checksum));

      // Corrupt one byte
      const corrupted = new Uint8Array(data);
      corrupted[2] = 99;
      assert.ok(!verifyShard(corrupted, checksum));
    });
  });

  describe('Shard count calculation', () => {
    it('should calculate k=1, n=2 for small data', () => {
      const { k, m } = calculateShardCounts(100, 1048576, 1.5);
      assert.equal(k, 1);
      assert.equal(m, 1);
    });

    it('should scale k with data size', () => {
      const { k, m } = calculateShardCounts(3000000, 1048576, 1.5);
      assert.equal(k, 3);
      assert.ok(m >= 1);
      assert.ok(k + m >= 5); // ceil(3 * 1.5) = 5
    });
  });
});

// ═══════════════════════════════════════
// Mesh Memory Tests
// ═══════════════════════════════════════

describe('MeshMemory', () => {
  function createMesh(peerCount: number): { memory: MeshMemory; transport: MockTransport } {
    const peerIds = Array.from({ length: peerCount }, (_, i) => `peer-${i}`);
    const transport = new MockTransport('local', peerIds);
    const memory = new MeshMemory(transport);
    return { memory, transport };
  }

  describe('Write + Read', () => {
    it('should write and read back data with 2 peers', async () => {
      const { memory } = createMesh(2);
      const data = new TextEncoder().encode('Hello, Holographic Memory!');

      const distributed = await memory.write('greeting', data);
      assert.ok(distributed >= 2, `Should distribute at least 2 shards, got ${distributed}`);

      const result = await memory.read('greeting');
      assert.deepEqual(result.data, data);
      assert.equal(result.key, 'greeting');
      assert.ok(result.shardsUsed >= 1);
      assert.ok(result.reconstructionMs >= 0);
    });

    it('should write and read 10KB data', async () => {
      const { memory } = createMesh(3);
      const data = new Uint8Array(10240);
      for (let i = 0; i < data.length; i++) data[i] = (i * 13 + 7) % 256;

      await memory.write('bigdata', data);
      const result = await memory.read('bigdata');
      assert.deepEqual(result.data, data);
    });

    it('should handle multiple keys', async () => {
      const { memory } = createMesh(2);

      const data1 = new TextEncoder().encode('First value');
      const data2 = new TextEncoder().encode('Second value');

      await memory.write('key1', data1);
      await memory.write('key2', data2);

      const r1 = await memory.read('key1');
      const r2 = await memory.read('key2');

      assert.deepEqual(r1.data, data1);
      assert.deepEqual(r2.data, data2);
    });
  });

  describe('Fault tolerance', () => {
    it('should survive one peer death with redundancy', async () => {
      const { memory, transport } = createMesh(3);
      const data = new TextEncoder().encode('Resilient data');

      await memory.write('resilient', data, { requiredShards: 2, totalShards: 4 });

      // Kill one peer
      transport.killPeer('peer-0');

      // Should still be able to read (need k=2 shards, have 3 remaining sources)
      const result = await memory.read('resilient');
      assert.deepEqual(result.data, data);
    });
  });

  describe('Key management', () => {
    it('should check key existence', async () => {
      const { memory } = createMesh(1);
      assert.ok(!memory.hasKey('nope'));

      await memory.write('exists', new Uint8Array([1, 2, 3]));
      assert.ok(memory.hasKey('exists'));
    });

    it('should delete keys', async () => {
      const { memory } = createMesh(1);
      await memory.write('temp', new Uint8Array([1, 2, 3]));
      assert.ok(memory.hasKey('temp'));

      memory.deleteKey('temp');
      assert.ok(!memory.hasKey('temp'));

      await assert.rejects(() => memory.read('temp'), /Key not found/);
    });

    it('should fail reading non-existent key', async () => {
      const { memory } = createMesh(1);
      await assert.rejects(() => memory.read('ghost'), /Key not found/);
    });
  });

  describe('TTL expiration', () => {
    it('should reject expired reads', async () => {
      const { memory } = createMesh(1);
      await memory.write('expiring', new Uint8Array([1]), { ttlMs: 1 });

      // Wait for expiry
      await new Promise(r => setTimeout(r, 50));

      await assert.rejects(() => memory.read('expiring'), /expired/);
    });

    it('should garbage collect expired shards', async () => {
      const { memory } = createMesh(1);
      await memory.write('gc-test', new Uint8Array([1, 2, 3]), { ttlMs: 1 });

      const before = memory.getStats();
      assert.ok(before.localShards > 0);

      await new Promise(r => setTimeout(r, 50));
      const removed = memory.gc();
      assert.ok(removed > 0);

      const after = memory.getStats();
      assert.equal(after.localShards, 0);
    });
  });

  describe('Stats', () => {
    it('should report accurate stats', async () => {
      const { memory } = createMesh(2);

      const before = memory.getStats();
      assert.equal(before.totalKeys, 0);
      assert.equal(before.localShards, 0);
      assert.equal(before.localBytes, 0);

      await memory.write('stats-test', new Uint8Array(100));

      const after = memory.getStats();
      assert.ok(after.totalKeys >= 1);
      assert.ok(after.localShards >= 1);
      assert.ok(after.localBytes > 0);
      assert.equal(after.contributingDevices, 3); // local + 2 peers
    });
  });

  describe('Capacity + eviction', () => {
    it('should evict LRU shards when at capacity', async () => {
      const peerIds = ['peer-0'];
      const transport = new MockTransport('local', peerIds);
      const memory = new MeshMemory(transport, {
        maxContributionBytes: 500,
        evictionPolicy: 'lru',
        defaultRedundancy: 1.5,
        maxShardSizeBytes: 1048576,
        defaultTtlMs: 0,
      });

      // Write data that fills local capacity
      await memory.write('first', new Uint8Array(200));
      await memory.write('second', new Uint8Array(200));

      // This should trigger eviction of 'first'
      await memory.write('third', new Uint8Array(200));

      const stats = memory.getStats();
      assert.ok(stats.localBytes <= 500, `Local bytes ${stats.localBytes} should be <= 500`);
    });
  });

  describe('Local shard operations', () => {
    it('should store and retrieve local shards directly', () => {
      const { memory } = createMesh(1);

      const shard: ShardDescriptor = {
        key: 'direct',
        shardIndex: 0,
        totalShards: 2,
        requiredShards: 1,
        data: new Uint8Array([10, 20, 30]),
        checksum: simpleHash(new Uint8Array([10, 20, 30])),
        originalSize: 3,
        writtenAt: Date.now(),
        ttlMs: 0,
      };

      const stored = memory.storeLocalShard(shard);
      assert.ok(stored);
      assert.ok(memory.hasLocalShard('direct', 0));
      assert.ok(!memory.hasLocalShard('direct', 1));

      const retrieved = memory.getLocalShard('direct', 0);
      assert.ok(retrieved !== null);
      assert.deepEqual(retrieved!.descriptor.data, shard.data);
    });
  });

  describe('Write options', () => {
    it('should respect custom shard counts', async () => {
      const { memory } = createMesh(4);
      const data = new Uint8Array(100);

      await memory.write('custom', data, { requiredShards: 2, totalShards: 5 });

      const meta = memory.getKeyMeta('custom');
      assert.ok(meta);
      assert.equal(meta!.k, 2);
      assert.equal(meta!.n, 5);
    });
  });
});
