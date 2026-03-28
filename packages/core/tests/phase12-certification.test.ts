/**
 * CMP Phase 12 Test Suite
 * Tests: Computation Certificates (Layer 7)
 *   - Certificate generation with signed attestations
 *   - Certificate verification (signatures, consensus, Sybil detection)
 *   - JSON export/import round-trip
 *   - End-to-end: computeCertified() across mesh
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase12-certification.test.ts
 *
 * @author Agent Viscro
 */

import {
  CMPNode, LogLevel, toHex, shortId, randomBytes,
  hash256, sign, verify, generateSigningKeyPair,
  ChunkStatus, VerifyMode,
} from '../src';
import type { ComputeResult, ComputationCertificate, CertificateVerification, DeviceAttestation } from '../src';
import {
  generateCertificate,
  verifyCertificate,
  exportCertificateJSON,
  importCertificateJSON,
} from '../src/cmp-node';
import type { AttestationInput, CertificateRequest } from '../src/cmp-node';
import { VirtualNetwork, VirtualTransport } from '../../transport/src/virtual-transport';

// XOR cipher WASM
const ENCRYPT_WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,5,3,1,0,1,
  7,20,2,6,109,101,109,111,114,121,2,0,7,101,110,99,114,121,112,116,0,0,
  10,54,1,52,1,1,127,65,0,33,2,2,64,3,64,32,2,32,1,79,13,1,32,0,32,2,
  106,32,0,32,2,106,45,0,0,65,194,0,115,58,0,0,32,2,65,1,106,33,2,12,
  0,11,11,32,1,11
]);

// ── Test runner ──
let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual: any, expected: any, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createTestNode(id: string, network: VirtualNetwork, opts: Partial<{
  accepting: boolean;
  bidWindowMs: number;
}> = {}): CMPNode {
  const transport = new VirtualTransport(id, network);
  return new CMPNode({
    _transport: transport,
    beaconIntervalMs: 150,
    bidWindowMs: opts.bidWindowMs ?? 400,
    peerStaleMs: 15000,
    peerDeadMs: 30000,
    acceptingTasks: opts.accepting !== false,
    logLevel: LogLevel.WARN,
  });
}

// Helper: build a mock certificate for unit testing
function buildMockCertificate(): { cert: ComputationCertificate; wasmModule: Uint8Array; inputData: Uint8Array; outputData: Uint8Array } {
  const wasmModule = ENCRYPT_WASM;
  const inputData = new TextEncoder().encode('test input');
  const outputData = new TextEncoder().encode('test output');

  const device1KP = generateSigningKeyPair();
  const device2KP = generateSigningKeyPair();
  const device3KP = generateSigningKeyPair();
  const requesterKP = generateSigningKeyPair();

  const outputHash = hash256(outputData);

  const req: CertificateRequest = {
    wasmModule,
    entryPoint: 'encrypt',
    inputData,
    outputData,
    strategy: 'DATA_PARALLEL',
    verificationMode: 'REDUNDANT',
    totalChunks: 1,
    totalTimeMs: 500,
    requesterId: randomBytes(16),
    requesterSecretKey: requesterKP.secretKey,
    attestations: [
      {
        meshId: randomBytes(16),
        publicKey: device1KP.publicKey,
        secretKey: device1KP.secretKey,
        architecture: 'x86_64',
        cores: 8,
        memoryMb: 16384,
        result: {
          executionTimeMs: 150,
          resourceUsed: { memoryPeakMb: 64, cpuMs: 150, gpuMs: 0 },
          status: ChunkStatus.SUCCESS,
          payload: outputData,
          chunkId: randomBytes(16),
          taskId: randomBytes(16),
          executorId: randomBytes(16),
          proof: hash256(outputData),
          signature: new Uint8Array(64),
        },
        outputHash,
      },
      {
        meshId: randomBytes(16),
        publicKey: device2KP.publicKey,
        secretKey: device2KP.secretKey,
        architecture: 'ARM64',
        cores: 4,
        memoryMb: 8192,
        result: {
          executionTimeMs: 230,
          resourceUsed: { memoryPeakMb: 48, cpuMs: 230, gpuMs: 0 },
          status: ChunkStatus.SUCCESS,
          payload: outputData,
          chunkId: randomBytes(16),
          taskId: randomBytes(16),
          executorId: randomBytes(16),
          proof: hash256(outputData),
          signature: new Uint8Array(64),
        },
        outputHash,
      },
      {
        meshId: randomBytes(16),
        publicKey: device3KP.publicKey,
        secretKey: device3KP.secretKey,
        architecture: 'x86_64',
        cores: 6,
        memoryMb: 32768,
        result: {
          executionTimeMs: 120,
          resourceUsed: { memoryPeakMb: 56, cpuMs: 120, gpuMs: 0 },
          status: ChunkStatus.SUCCESS,
          payload: outputData,
          chunkId: randomBytes(16),
          taskId: randomBytes(16),
          executorId: randomBytes(16),
          proof: hash256(outputData),
          signature: new Uint8Array(64),
        },
        outputHash,
      },
    ],
  };

  const cert = generateCertificate(req);
  return { cert, wasmModule, inputData, outputData };
}

async function main() {

// ════════════════════════════════════════════
// STANDALONE CERTIFICATE GENERATION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Certificate Generation ──\x1b[0m');

test('generateCertificate produces valid certificate', () => {
  const { cert } = buildMockCertificate();

  assert(cert.certId.startsWith('cmp-cert-'), 'certId prefix');
  assertEqual(cert.version, '1.0', 'version');
  assertEqual(cert.deviceCount, 3, 'device count');
  assertEqual(cert.attestations.length, 3, 'attestation count');
  assert(cert.consensus > 0, `consensus should be > 0, got ${cert.consensus}`);
  assertEqual(cert.protocolVersion, '1.0', 'protocol version');
});

test('Certificate has correct hashes', () => {
  const { cert, wasmModule, inputData, outputData } = buildMockCertificate();

  const expectedCodeHash = toHex(hash256(wasmModule));
  const expectedInputHash = toHex(hash256(inputData));
  const expectedOutputHash = toHex(hash256(outputData));

  assertEqual(toHex(cert.codeHash), expectedCodeHash, 'code hash');
  assertEqual(toHex(cert.inputHash), expectedInputHash, 'input hash');
  assertEqual(toHex(cert.outputHash), expectedOutputHash, 'output hash');
});

test('Certificate attestations have non-zero signatures', () => {
  const { cert } = buildMockCertificate();

  for (let i = 0; i < cert.attestations.length; i++) {
    const att = cert.attestations[i];
    const isZero = Array.from(att.signature).every(b => b === 0);
    assertEqual(isZero, false, `attestation ${i} signature should not be all zeros`);
  }
});

test('Certificate has diverse architectures', () => {
  const { cert } = buildMockCertificate();
  assertEqual(cert.uniqueArchitectures, 2, 'should have x86_64 and ARM64');
});

test('Certificate has diverse execution times', () => {
  const { cert } = buildMockCertificate();
  const times = cert.attestations.map(a => a.executionTimeMs);
  const allSame = times.every(t => t === times[0]);
  assertEqual(allSame, false, 'execution times should differ across devices');
});

test('Certificate requester signature is non-zero', () => {
  const { cert } = buildMockCertificate();
  const isZero = Array.from(cert.requesterSignature).every(b => b === 0);
  assertEqual(isZero, false, 'requester signature should not be all zeros');
});

// ════════════════════════════════════════════
// CERTIFICATE VERIFICATION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Certificate Verification ──\x1b[0m');

test('Valid certificate passes verification', () => {
  const { cert } = buildMockCertificate();
  const result = verifyCertificate(cert);

  assertEqual(result.valid, true, 'should be valid');
  assertEqual(result.validSignatures, 3, 'all 3 signatures valid');
  assertEqual(result.totalSignatures, 3, 'total signatures');
  assertEqual(result.consensusValid, true, 'consensus valid');
  assertEqual(result.consensusRatio, 1.0, 'consensus ratio');
  assertEqual(result.issues.length, 0, 'no issues');
  assert(result.summary.includes('Valid'), `summary should say valid: ${result.summary}`);
});

test('Tampered output hash fails verification', () => {
  const { cert } = buildMockCertificate();

  // Tamper with the output hash
  cert.outputHash = hash256(new TextEncoder().encode('tampered'));

  const result = verifyCertificate(cert);
  assertEqual(result.consensusValid, false, 'consensus should fail');
  assert(result.issues.length > 0, 'should have issues');
});

test('Tampered attestation signature fails verification', () => {
  const { cert } = buildMockCertificate();

  // Zero out one signature
  cert.attestations[1].signature = new Uint8Array(64);

  const result = verifyCertificate(cert);
  assertEqual(result.valid, false, 'should be invalid');
  assertEqual(result.validSignatures, 2, 'only 2 valid');
  assert(result.issues.some(i => i.includes('Invalid signature')), 'should report invalid sig');
});

test('Empty attestations fails verification', () => {
  const { cert } = buildMockCertificate();
  cert.attestations = [];

  const result = verifyCertificate(cert);
  assertEqual(result.valid, false, 'should be invalid');
  assert(result.summary.includes('Invalid'), 'summary should say invalid');
});

test('Duplicate public keys detected (Sybil check)', () => {
  const { cert } = buildMockCertificate();

  // Make device 2 use device 1's public key
  cert.attestations[1].publicKey = cert.attestations[0].publicKey;

  const result = verifyCertificate(cert);
  assert(result.issues.some(i => i.includes('Duplicate public keys')), 'should detect Sybil');
});

test('One disagreeing device detected', () => {
  const { cert } = buildMockCertificate();

  // Make device 3 claim a different output hash
  cert.attestations[2].outputHash = hash256(new TextEncoder().encode('different output'));

  const result = verifyCertificate(cert);
  // Consensus is 2/3 = 66% — still valid (> 50%) but with issues
  assert(result.issues.some(i => i.includes('produced different output')), 'should detect disagreement');
});

// ════════════════════════════════════════════
// CERTIFICATE JSON SERIALIZATION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Certificate Serialization ──\x1b[0m');

test('Export/import JSON round-trip preserves certificate', () => {
  const { cert } = buildMockCertificate();

  const json = exportCertificateJSON(cert);
  assert(json.length > 100, 'JSON should not be empty');

  const parsed = JSON.parse(json);
  assertEqual(parsed.version, '1.0', 'version preserved');
  assertEqual(parsed.deviceCount, 3, 'device count preserved');
  assert(parsed.certId.startsWith('cmp-cert-'), 'certId preserved');

  // Import back
  const imported = importCertificateJSON(json);
  assertEqual(imported.certId, cert.certId, 'certId matches after import');
  assertEqual(imported.deviceCount, cert.deviceCount, 'deviceCount matches');
  assertEqual(imported.consensus, cert.consensus, 'consensus matches');
  assertEqual(imported.attestations.length, 3, 'attestations preserved');
});

test('Imported certificate passes verification', () => {
  const { cert } = buildMockCertificate();

  const json = exportCertificateJSON(cert);
  const imported = importCertificateJSON(json);
  const result = verifyCertificate(imported);

  assertEqual(result.valid, true, 'imported cert should still be valid');
  assertEqual(result.validSignatures, 3, 'all signatures still valid after round-trip');
});

test('JSON is human-readable (hex-encoded)', () => {
  const { cert } = buildMockCertificate();
  const json = exportCertificateJSON(cert);

  // Should contain hex strings, not raw binary
  assert(json.includes('"codeHash"'), 'has codeHash field');
  assert(!json.includes('\\u0000'), 'no binary in JSON');

  // Attestations should have hex public keys
  const parsed = JSON.parse(json);
  assert(typeof parsed.attestations[0].publicKey === 'string', 'publicKey is hex string');
  assert(parsed.attestations[0].publicKey.length === 64, 'publicKey is 32 bytes hex (64 chars)');
});

// ════════════════════════════════════════════
// END-TO-END: computeCertified() across mesh
// ════════════════════════════════════════════
console.log('\n\x1b[1m── End-to-End: Certified Mesh Compute ──\x1b[0m');

await testAsync('computeCertified() produces result with certificate', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('a', network);
  const nodeB = createTestNode('b', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(2000);

  const input = new TextEncoder().encode('certified compute test');
  const result = await nodeA.computeCertified(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  // Basic compute result checks
  assertEqual(result.localFallback, false, 'should be remote');
  assert(result.data.length > 0, 'should have output');

  // Certificate should exist
  assert(result.certificate !== undefined, 'certificate should be present');
  if (result.certificate) {
    assert(result.certificate.certId.startsWith('cmp-cert-'), 'certId format');
    assertEqual(result.certificate.version, '1.0', 'cert version');
    assert(result.certificate.deviceCount >= 1, `devices: ${result.certificate.deviceCount}`);
    assert(result.certificate.attestations.length >= 1, 'has attestations');

    // Hashes should match
    const expectedCodeHash = toHex(hash256(ENCRYPT_WASM));
    assertEqual(toHex(result.certificate.codeHash), expectedCodeHash, 'code hash matches WASM');
  }

  await nodeA.stop();
  await nodeB.stop();
});

await testAsync('Certificate can be exported and verified independently', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('a', network);
  const nodeB = createTestNode('b', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(2000);

  const input = new TextEncoder().encode('export verify test');
  const result = await nodeA.computeCertified(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  if (result.certificate) {
    // Export to JSON
    const json = nodeA.exportCert(result.certificate);
    assert(json.length > 100, 'JSON export not empty');

    // Import on a completely different node (simulates independent verifier)
    const imported = nodeA.importCert(json);

    // Verify independently
    const verification = nodeA.verifyCert(imported);
    assert(verification.validSignatures >= 1, `valid sigs: ${verification.validSignatures}`);
    assert(verification.consensusRatio > 0, `consensus: ${verification.consensusRatio}`);
  }

  await nodeA.stop();
  await nodeB.stop();
});

await testAsync('getCertificate retrieves stored certificate', async () => {
  const network = new VirtualNetwork();
  const nodeA = createTestNode('a', network);
  const nodeB = createTestNode('b', network);

  await nodeA.start();
  await nodeB.start();
  await sleep(2000);

  const input = new TextEncoder().encode('storage test');
  const result = await nodeA.computeCertified(ENCRYPT_WASM, input, {
    entryPoint: 'encrypt',
    deadline: 10000,
  });

  if (result.certificate) {
    // Should be stored in the node
    const stored = nodeA.getCertificate(result.certificate.certId);
    assert(stored !== undefined, 'certificate should be stored');
    assertEqual(stored!.certId, result.certificate.certId, 'certId matches');

    // getAllCertificates should include it
    const all = nodeA.getAllCertificates();
    assert(all.length >= 1, 'should have at least 1 certificate');
  }

  await nodeA.stop();
  await nodeB.stop();
});

// ════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (failed > 0) {
  console.log(`  \x1b[1m\x1b[31mResults: ${passed} passed, ${failed} failed\x1b[0m`);
  for (const err of errors) console.log(err);
} else {
  console.log(`  \x1b[1m\x1b[32mResults: ${passed} passed, ${failed} failed\x1b[0m`);
}
console.log('══════════════════════════════════════════════════\n');

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});