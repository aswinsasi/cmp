/**
 * CMP v4.0 — Phase 8: Security Hardening + MeshFS Tests
 *
 * 32 tests covering:
 *   - V3 Encryption: session key management, encrypt/decrypt, enable/disable
 *   - Access Control: open/whitelist/reputation/deposit modes, combined modes
 *   - Rate Limiter: sliding window, burst, reset, stats
 *   - MeshFS: write/read/ls/rm/info/mkdir, path resolution, MIME types
 *
 * Run: npx tsx packages/core/tests/v4-security-meshfs.test.ts
 *
 * @author Agent Viscro
 */

import { V3MessageEncryptor } from '../src/security/v3-encryption';
import { AccessController, ACLMode } from '../src/security/access-control';
import { RateLimiter } from '../src/security/rate-limiter';
import { MeshFS } from '../src/meshfs/meshfs';
import { PathResolver } from '../src/meshfs/path-resolver';

// ─── Test Runner ───

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual: any, expected: any, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

// ─── Mock Encrypt/Decrypt (XOR-based for testing) ───

function mockEncrypt(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  const result = new Uint8Array(plaintext.length);
  for (let i = 0; i < plaintext.length; i++) {
    result[i] = plaintext[i] ^ key[i % key.length];
  }
  return result;
}

function mockDecrypt(ciphertext: Uint8Array, key: Uint8Array): Uint8Array {
  return mockEncrypt(ciphertext, key); // XOR is symmetric
}

function encode(s: string): Uint8Array { return new TextEncoder().encode(s); }
function decode(b: Uint8Array): string { return new TextDecoder().decode(b); }

// ─── Main ───

async function main() {

// ════════════════════════════════════════════
// V3 Message Encryption
// ════════════════════════════════════════════
console.log('\n\x1b[1m── V3 Message Encryption ──\x1b[0m');

test('1. encrypt/decrypt round-trip with session key', () => {
  const enc = new V3MessageEncryptor(mockEncrypt, mockDecrypt);
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = i + 1;
  enc.setSessionKey('peer-A', key);

  const plaintext = encode('hello mesh');
  const ciphertext = enc.encrypt('peer-A', plaintext);
  assert(ciphertext !== null, 'encrypted');
  assert(decode(ciphertext!) !== 'hello mesh', 'ciphertext differs from plaintext');

  const decrypted = enc.decrypt('peer-A', ciphertext!);
  assert(decrypted !== null, 'decrypted');
  assertEqual(decode(decrypted!), 'hello mesh', 'round-trip matches');
});

test('2. encrypt without session key returns payload as-is', () => {
  const enc = new V3MessageEncryptor(mockEncrypt, mockDecrypt);
  const plaintext = encode('no key');
  const result = enc.encrypt('unknown-peer', plaintext);
  assertEqual(decode(result!), 'no key', 'passthrough when no key');
});

test('3. decrypt without session key returns null', () => {
  const enc = new V3MessageEncryptor(mockEncrypt, mockDecrypt);
  const result = enc.decrypt('unknown-peer', encode('data'));
  assertEqual(result, null, 'null without key');
});

test('4. shouldEncrypt checks message type ranges', () => {
  const enc = new V3MessageEncryptor(mockEncrypt, mockDecrypt);
  assert(enc.shouldEncrypt(0xF2), '0xF2 in v3 range');
  assert(enc.shouldEncrypt(0xFC), '0xFC in v3 range');
  assert(enc.shouldEncrypt(0xD0), '0xD0 in v4 range');
  assert(!enc.shouldEncrypt(0x01), '0x01 not encrypted');
});

test('5. encryption can be disabled', () => {
  const enc = new V3MessageEncryptor(mockEncrypt, mockDecrypt, false);
  assert(!enc.isEnabled(), 'disabled');
  assert(!enc.shouldEncrypt(0xF5), 'no encryption when disabled');

  const key = new Uint8Array(32).fill(0x42);
  enc.setSessionKey('peer-A', key);
  const result = enc.encrypt('peer-A', encode('plain'));
  assertEqual(decode(result!), 'plain', 'passthrough when disabled');
});

test('6. encryption stats tracked', () => {
  const enc = new V3MessageEncryptor(mockEncrypt, mockDecrypt);
  const key = new Uint8Array(32).fill(0xAA);
  enc.setSessionKey('peer-A', key);

  enc.encrypt('peer-A', encode('msg1'));
  enc.encrypt('peer-A', encode('msg2'));
  enc.decrypt('peer-A', enc.encrypt('peer-A', encode('msg3'))!);

  const stats = enc.getStats();
  assertEqual(stats.messagesEncrypted, 3, '3 encrypted');
  assertEqual(stats.messagesDecrypted, 1, '1 decrypted');
  assertEqual(stats.registeredPeers, 1, '1 peer');
});

test('7. removeSessionKey clears peer', () => {
  const enc = new V3MessageEncryptor(mockEncrypt, mockDecrypt);
  enc.setSessionKey('peer-X', new Uint8Array(32).fill(1));
  assert(enc.hasSessionKey('peer-X'), 'has key');
  enc.removeSessionKey('peer-X');
  assert(!enc.hasSessionKey('peer-X'), 'key removed');
});

// ════════════════════════════════════════════
// Access Control
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Access Control ──\x1b[0m');

test('8. OPEN mode allows everyone', () => {
  const acl = new AccessController({ modes: [ACLMode.OPEN] });
  const result = acl.check('any-device');
  assert(result.allowed, 'allowed');
});

test('9. WHITELIST mode blocks non-listed devices', () => {
  const acl = new AccessController({
    modes: [ACLMode.WHITELIST],
    whitelist: new Set(['allowed-1', 'allowed-2']),
  });

  assert(acl.check('allowed-1').allowed, 'whitelisted allowed');
  assert(!acl.check('blocked-1').allowed, 'non-whitelisted blocked');
  assertEqual(acl.check('blocked-1').failedMode, ACLMode.WHITELIST, 'failed on whitelist');
});

test('10. REPUTATION mode enforces minimum score', () => {
  const acl = new AccessController({
    modes: [ACLMode.REPUTATION],
    minReputation: 2000,
  });

  assert(acl.check('dev', 5000).allowed, 'high rep allowed');
  assert(!acl.check('dev', 500).allowed, 'low rep blocked');
  assertEqual(acl.check('dev', 500).failedMode, ACLMode.REPUTATION, 'failed on reputation');
});

test('11. DEPOSIT mode requires CCU balance', () => {
  const acl = new AccessController({
    modes: [ACLMode.DEPOSIT],
    minDeposit: 10,
  });

  assert(acl.check('dev', 0, 50).allowed, 'sufficient deposit');
  assert(!acl.check('dev', 0, 5).allowed, 'insufficient deposit');
  assertEqual(acl.check('dev', 0, 5).failedMode, ACLMode.DEPOSIT, 'failed on deposit');
});

test('12. combined modes: WHITELIST + REPUTATION (both must pass)', () => {
  const acl = new AccessController({
    modes: [ACLMode.WHITELIST, ACLMode.REPUTATION],
    whitelist: new Set(['dev-A']),
    minReputation: 1000,
  });

  assert(acl.check('dev-A', 5000).allowed, 'whitelisted + high rep');
  assert(!acl.check('dev-A', 500).allowed, 'whitelisted but low rep');
  assert(!acl.check('dev-B', 5000).allowed, 'not whitelisted');
});

test('13. addToWhitelist / removeFromWhitelist', () => {
  const acl = new AccessController({ modes: [ACLMode.WHITELIST], whitelist: new Set() });
  assert(!acl.check('dev-X').allowed, 'initially blocked');

  acl.addToWhitelist('dev-X');
  assert(acl.check('dev-X').allowed, 'allowed after add');

  acl.removeFromWhitelist('dev-X');
  assert(!acl.check('dev-X').allowed, 'blocked after remove');
});

test('14. ACL stats tracked', () => {
  const acl = new AccessController({ modes: [ACLMode.REPUTATION], minReputation: 1000 });
  acl.check('a', 5000);
  acl.check('b', 500);
  acl.check('c', 2000);

  const stats = acl.getStats();
  assertEqual(stats.totalChecks, 3, '3 checks');
  assertEqual(stats.allowed, 2, '2 allowed');
  assertEqual(stats.denied, 1, '1 denied');
});

// ════════════════════════════════════════════
// Rate Limiter
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Rate Limiter ──\x1b[0m');

test('15. allows requests within limit', () => {
  const rl = new RateLimiter({ maxRequestsPerWindow: 5, windowMs: 60000 });
  for (let i = 0; i < 5; i++) {
    assert(rl.check('dev-A').allowed, `request ${i + 1} allowed`);
  }
});

test('16. blocks requests exceeding limit', () => {
  const rl = new RateLimiter({ maxRequestsPerWindow: 3, windowMs: 60000 });
  rl.check('dev-A');
  rl.check('dev-A');
  rl.check('dev-A');
  const r4 = rl.check('dev-A');
  assert(!r4.allowed, '4th blocked');
  assertEqual(r4.remaining, 0, 'remaining=0');
});

test('17. separate limits per device', () => {
  const rl = new RateLimiter({ maxRequestsPerWindow: 2, windowMs: 60000 });
  rl.check('dev-A');
  rl.check('dev-A');
  assert(!rl.check('dev-A').allowed, 'A blocked');
  assert(rl.check('dev-B').allowed, 'B still allowed');
});

test('18. remaining() reports correctly', () => {
  const rl = new RateLimiter({ maxRequestsPerWindow: 5, windowMs: 60000 });
  assertEqual(rl.remaining('dev-X'), 5, 'starts at 5');
  rl.check('dev-X');
  rl.check('dev-X');
  assertEqual(rl.remaining('dev-X'), 3, '3 remaining');
});

test('19. reset() clears a device', () => {
  const rl = new RateLimiter({ maxRequestsPerWindow: 2, windowMs: 60000 });
  rl.check('dev-A');
  rl.check('dev-A');
  assert(!rl.check('dev-A').allowed, 'blocked');
  rl.reset('dev-A');
  assert(rl.check('dev-A').allowed, 'allowed after reset');
});

test('20. rate limiter stats', () => {
  const rl = new RateLimiter({ maxRequestsPerWindow: 2, windowMs: 60000 });
  rl.check('dev-A');
  rl.check('dev-A');
  rl.check('dev-A'); // denied

  const stats = rl.getStats();
  assertEqual(stats.totalChecks, 3, '3 checks');
  assertEqual(stats.totalAllowed, 2, '2 allowed');
  assertEqual(stats.totalDenied, 1, '1 denied');
});

// ════════════════════════════════════════════
// Path Resolver
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Path Resolver ──\x1b[0m');

const resolver = new PathResolver();

test('21. normalize paths', () => {
  assertEqual(resolver.normalize('/data/sensors/'), '/data/sensors', 'strip trailing /');
  assertEqual(resolver.normalize('data/file'), '/data/file', 'add leading /');
  assertEqual(resolver.normalize('/a//b///c'), '/a/b/c', 'collapse //');
  assertEqual(resolver.normalize('/'), '/', 'root stays root');
});

test('22. parent and basename', () => {
  assertEqual(resolver.parent('/data/sensors/today.csv'), '/data/sensors', 'parent');
  assertEqual(resolver.parent('/data'), '/', 'parent of top-level');
  assertEqual(resolver.parent('/'), '/', 'parent of root');
  assertEqual(resolver.basename('/data/sensors/today.csv'), 'today.csv', 'basename');
});

test('23. isChildOf', () => {
  assert(resolver.isChildOf('/data/sensors/x', '/data/sensors'), 'is child');
  assert(resolver.isChildOf('/data/sensors/x', '/data'), 'is descendant');
  assert(!resolver.isChildOf('/data/sensors', '/data/sensors'), 'not child of self');
  assert(!resolver.isChildOf('/other/x', '/data'), 'not child of different');
});

test('24. validate rejects bad paths', () => {
  assert(resolver.validate('/good/path').valid, 'valid path');
  assert(!resolver.validate('').valid, 'empty invalid');
});

// ════════════════════════════════════════════
// MeshFS
// ════════════════════════════════════════════
console.log('\n\x1b[1m── MeshFS ──\x1b[0m');

test('25. write and read file', () => {
  const fs = new MeshFS('dev-A');
  fs.write('/data/test.txt', encode('hello mesh'));
  const content = fs.read('/data/test.txt');
  assert(content !== null, 'file exists');
  assertEqual(decode(content!), 'hello mesh', 'content matches');
});

test('26. read returns null for missing file', () => {
  const fs = new MeshFS('dev-A');
  assertEqual(fs.read('/nonexistent'), null, 'null for missing');
});

test('27. ls lists directory contents', () => {
  const fs = new MeshFS('dev-A');
  fs.write('/data/a.txt', encode('a'));
  fs.write('/data/b.txt', encode('b'));
  fs.write('/other/c.txt', encode('c'));

  const listing = fs.ls('/data');
  assertEqual(listing.length, 2, '2 files in /data');
  assert(listing.some(e => e.name === 'a.txt'), 'has a.txt');
  assert(listing.some(e => e.name === 'b.txt'), 'has b.txt');
});

test('28. rm deletes file', () => {
  const fs = new MeshFS('dev-A');
  fs.write('/temp/delete-me.txt', encode('bye'));
  assert(fs.exists('/temp/delete-me.txt'), 'exists');
  assert(fs.rm('/temp/delete-me.txt'), 'deleted');
  assert(!fs.exists('/temp/delete-me.txt'), 'gone');
});

test('29. info returns file metadata', () => {
  const fs = new MeshFS('dev-A');
  fs.write('/data/info.csv', encode('a,b,c'), { mimeType: 'text/csv' });
  const info = fs.info('/data/info.csv');
  assert(info !== null, 'has info');
  assertEqual(info!.entry.mimeType, 'text/csv', 'mime=csv');
  assertEqual(info!.entry.sizeBytes, 5, 'size=5');
  assertEqual(info!.entry.ownerDeviceId, 'dev-A', 'owner');
  assert(info!.healthy, 'healthy');
});

test('30. auto-creates parent directories', () => {
  const fs = new MeshFS('dev-A');
  fs.write('/deep/nested/path/file.txt', encode('deep'));
  assert(fs.exists('/deep'), '/deep exists');
  assert(fs.exists('/deep/nested'), '/deep/nested exists');
  assert(fs.exists('/deep/nested/path'), '/deep/nested/path exists');

  const listing = fs.ls('/deep/nested');
  assertEqual(listing.length, 1, '1 child');
  assertEqual(listing[0].name, 'path', 'child is "path"');
});

test('31. overwrite existing file', () => {
  const fs = new MeshFS('dev-A');
  fs.write('/data/over.txt', encode('v1'));
  fs.write('/data/over.txt', encode('v2'));
  assertEqual(decode(fs.read('/data/over.txt')!), 'v2', 'overwritten');
});

test('32. getStats returns filesystem summary', () => {
  const fs = new MeshFS('dev-A');
  fs.write('/a.txt', encode('hello'));
  fs.write('/b.txt', encode('world'));
  fs.read('/a.txt');

  const stats = fs.getStats();
  assertEqual(stats.totalFiles, 2, '2 files');
  assertEqual(stats.writes, 2, '2 writes');
  assertEqual(stats.reads, 1, '1 read');
  assertEqual(stats.bytesWritten, 10, '10 bytes written');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 8: Security Hardening + MeshFS\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  console.error(err.stack);
  process.exit(1);
});
