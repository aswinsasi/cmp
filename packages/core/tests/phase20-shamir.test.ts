/**
 * CMP Phase 20 Test Suite
 * Tests: Shamir's Secret Sharing + GF(256) + DataSplitter upgrade
 *   - GF(256) arithmetic (add, mul, div, inv, pow, poly eval)
 *   - Lagrange interpolation at x=0
 *   - Shamir split/reconstruct (2-of-3, 3-of-5, 5-of-10)
 *   - Threshold property: k shares reconstruct, k-1 don't
 *   - DataSplitter: Shamir split, legacy XOR, parallel split
 *   - Wire format round-trip
 *   - Large data handling
 *
 * Run: npx ts-node --transpile-only packages/core/tests/phase20-shamir.test.ts
 *
 * @author Agent Viscro
 */

import { randomBytes, toHex, bytesEqual } from '../src';
import { gfAdd, gfSub, gfMul, gfDiv, gfInv, gfPow, gfPolyEval, lagrangeInterpolateAt0 } from '../../runtime/src/gf256';
import { shamirSplit, shamirReconstruct, shamirVerify, sharesToWire, sharesFromWire } from '../../runtime/src/shamir';
import { DataSplitter } from '../../runtime/src/data-splitter';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
function assertEqual(a: any, e: any, m: string): void { if (a !== e) throw new Error(`${m}: expected ${e}, got ${a}`); }

console.log('\n\x1b[1m── Phase 20: Shamir\'s Secret Sharing ──\x1b[0m');

// ════════════════════════════════════════════
// GF(256) ARITHMETIC
// ════════════════════════════════════════════
console.log('\n\x1b[1m── GF(256) Arithmetic ──\x1b[0m');

test('gfAdd: XOR-based addition', () => {
  assertEqual(gfAdd(0, 0), 0, '0+0');
  assertEqual(gfAdd(0xFF, 0), 0xFF, 'FF+0');
  assertEqual(gfAdd(0xAA, 0xAA), 0, 'self-inverse');
  assertEqual(gfAdd(0x53, 0xCA), 0x53 ^ 0xCA, 'XOR');
});

test('gfSub: same as gfAdd in GF(2^8)', () => {
  assertEqual(gfSub(0x53, 0xCA), gfAdd(0x53, 0xCA), 'sub = add');
  assertEqual(gfSub(0xFF, 0xFF), 0, 'self-cancel');
});

test('gfMul: multiplication properties', () => {
  assertEqual(gfMul(0, 42), 0, 'zero absorbs');
  assertEqual(gfMul(1, 42), 42, 'identity');
  assertEqual(gfMul(42, 1), 42, 'identity commutative');
  // Commutativity
  assertEqual(gfMul(0x53, 0xCA), gfMul(0xCA, 0x53), 'commutative');
});

test('gfDiv: division is inverse of multiplication', () => {
  const a = 0x53;
  const b = 0xCA;
  const product = gfMul(a, b);
  assertEqual(gfDiv(product, b), a, 'a*b/b = a');
  assertEqual(gfDiv(product, a), b, 'a*b/a = b');
});

test('gfDiv: division by zero throws', () => {
  let threw = false;
  try { gfDiv(42, 0); } catch { threw = true; }
  assert(threw, 'should throw');
});

test('gfInv: a * inv(a) = 1 for all non-zero', () => {
  // Test a sampling of values
  for (const a of [1, 2, 3, 42, 127, 128, 200, 254, 255]) {
    assertEqual(gfMul(a, gfInv(a)), 1, `${a} * inv(${a}) = 1`);
  }
});

test('gfPow: exponentiation', () => {
  assertEqual(gfPow(42, 0), 1, 'x^0 = 1');
  assertEqual(gfPow(0, 5), 0, '0^n = 0');
  assertEqual(gfPow(3, 1), 3, 'x^1 = x');
  // 3^2 in GF(256)
  assertEqual(gfPow(3, 2), gfMul(3, 3), '3^2 = 3*3');
});

test('gfPolyEval: polynomial evaluation', () => {
  // f(x) = 5 + 3x + 7x^2, evaluate at x=2
  const poly = new Uint8Array([5, 3, 7]);
  const result = gfPolyEval(poly, 2);
  // f(2) = 5 ^ gfMul(3, 2) ^ gfMul(7, gfMul(2, 2))
  const expected = gfAdd(gfAdd(5, gfMul(3, 2)), gfMul(7, gfPow(2, 2)));
  assertEqual(result, expected, 'poly eval');
});

test('gfPolyEval: constant polynomial', () => {
  assertEqual(gfPolyEval(new Uint8Array([42]), 99), 42, 'constant');
  assertEqual(gfPolyEval(new Uint8Array([42]), 0), 42, 'constant at 0');
});

test('gfPolyEval: f(0) = constant term', () => {
  const poly = new Uint8Array([0xAB, 0x12, 0x34, 0x56]);
  assertEqual(gfPolyEval(poly, 0), 0xAB, 'f(0) = a0');
});

// ════════════════════════════════════════════
// LAGRANGE INTERPOLATION
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Lagrange Interpolation ──\x1b[0m');

test('interpolation recovers constant polynomial at x=0', () => {
  // f(x) = 42 (constant). Points: (1, 42), (2, 42), (3, 42)
  const xs = new Uint8Array([1, 2, 3]);
  const ys = new Uint8Array([42, 42, 42]);
  assertEqual(lagrangeInterpolateAt0(xs, ys), 42, 'recovered constant');
});

test('interpolation recovers linear polynomial at x=0', () => {
  // f(x) = secret + ax. Build from known polynomial.
  const secret = 0x7F;
  const a = 0x33;
  const poly = new Uint8Array([secret, a]);
  const xs = new Uint8Array([1, 2]);
  const ys = new Uint8Array([gfPolyEval(poly, 1), gfPolyEval(poly, 2)]);
  assertEqual(lagrangeInterpolateAt0(xs, ys), secret, 'recovered linear');
});

test('interpolation recovers quadratic polynomial at x=0', () => {
  const secret = 0xDE;
  const poly = new Uint8Array([secret, 0x11, 0x22]);
  const xs = new Uint8Array([1, 2, 3]);
  const ys = new Uint8Array([gfPolyEval(poly, 1), gfPolyEval(poly, 2), gfPolyEval(poly, 3)]);
  assertEqual(lagrangeInterpolateAt0(xs, ys), secret, 'recovered quadratic');
});

// ════════════════════════════════════════════
// SHAMIR SPLIT/RECONSTRUCT
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Shamir Split/Reconstruct ──\x1b[0m');

test('2-of-3: reconstruct with any 2 shares', () => {
  const secret = new TextEncoder().encode('hello');
  const shares = shamirSplit(secret, 3, 2);
  assertEqual(shares.length, 3, '3 shares');

  // Any 2 of 3 should work
  assert(shamirVerify([shares[0], shares[1]], secret), 'shares 0,1');
  assert(shamirVerify([shares[0], shares[2]], secret), 'shares 0,2');
  assert(shamirVerify([shares[1], shares[2]], secret), 'shares 1,2');

  // All 3 also works
  assert(shamirVerify(shares, secret), 'all 3');
});

test('3-of-5: reconstruct with any 3 shares', () => {
  const secret = new TextEncoder().encode('Agent Viscro');
  const shares = shamirSplit(secret, 5, 3);
  assertEqual(shares.length, 5, '5 shares');

  // Any 3 of 5
  assert(shamirVerify([shares[0], shares[1], shares[2]], secret), 'shares 0,1,2');
  assert(shamirVerify([shares[0], shares[2], shares[4]], secret), 'shares 0,2,4');
  assert(shamirVerify([shares[1], shares[3], shares[4]], secret), 'shares 1,3,4');
  assert(shamirVerify([shares[2], shares[3], shares[4]], secret), 'shares 2,3,4');
});

test('5-of-10: reconstruct with any 5 shares', () => {
  const secret = new TextEncoder().encode('CMP Mesh Cognition Protocol');
  const shares = shamirSplit(secret, 10, 5);
  assertEqual(shares.length, 10, '10 shares');

  // Pick 5 random shares
  const subset = [shares[0], shares[3], shares[5], shares[7], shares[9]];
  assert(shamirVerify(subset, secret), 'random 5 of 10');
});

test('threshold property: k-1 shares cannot reconstruct', () => {
  const secret = new TextEncoder().encode('secret data');
  const shares = shamirSplit(secret, 5, 3);

  // 2 shares (< threshold 3) should NOT reconstruct correctly
  const partial = shamirReconstruct([shares[0], shares[1]]);
  assert(!bytesEqual(partial, secret), 'k-1 shares should NOT match secret');
});

test('single share reveals nothing', () => {
  const secret = new TextEncoder().encode('confidential');
  const shares = shamirSplit(secret, 5, 3);

  // A single share should look random — not match the secret
  assert(!bytesEqual(shares[0].data, secret), 'single share != secret');
});

test('shares are same length as secret', () => {
  const secret = randomBytes(100);
  const shares = shamirSplit(secret, 5, 3);
  for (const share of shares) {
    assertEqual(share.data.length, 100, 'share length = secret length');
  }
});

test('x-coordinates are 1-based sequential', () => {
  const shares = shamirSplit(randomBytes(10), 5, 3);
  for (let i = 0; i < 5; i++) {
    assertEqual(shares[i].x, i + 1, `x[${i}] = ${i + 1}`);
  }
});

test('handles empty secret', () => {
  const secret = new Uint8Array(0);
  const shares = shamirSplit(secret, 3, 2);
  const recovered = shamirReconstruct([shares[0], shares[1]]);
  assertEqual(recovered.length, 0, 'empty');
});

test('handles single-byte secret', () => {
  const secret = new Uint8Array([0x42]);
  const shares = shamirSplit(secret, 5, 3);
  const recovered = shamirReconstruct([shares[1], shares[3], shares[4]]);
  assertEqual(recovered[0], 0x42, 'single byte recovered');
});

test('handles all-zero secret', () => {
  const secret = new Uint8Array(16);
  const shares = shamirSplit(secret, 3, 2);
  assert(shamirVerify([shares[0], shares[2]], secret), 'all-zero recovered');
});

test('handles all-0xFF secret', () => {
  const secret = new Uint8Array(16).fill(0xFF);
  const shares = shamirSplit(secret, 3, 2);
  assert(shamirVerify([shares[1], shares[2]], secret), 'all-FF recovered');
});

test('validation: n < 2 throws', () => {
  let threw = false;
  try { shamirSplit(randomBytes(10), 1, 1); } catch { threw = true; }
  assert(threw, 'n < 2 should throw');
});

test('validation: k > n throws', () => {
  let threw = false;
  try { shamirSplit(randomBytes(10), 3, 5); } catch { threw = true; }
  assert(threw, 'k > n should throw');
});

test('validation: n > 255 throws', () => {
  let threw = false;
  try { shamirSplit(randomBytes(10), 256, 2); } catch { threw = true; }
  assert(threw, 'n > 255 should throw');
});

// ════════════════════════════════════════════
// WIRE FORMAT
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Wire Format ──\x1b[0m');

test('sharesToWire/sharesFromWire round-trip', () => {
  const secret = new TextEncoder().encode('wire test');
  const shares = shamirSplit(secret, 3, 2);

  const wire = sharesToWire(shares);
  const json = JSON.stringify(wire);
  const parsed = JSON.parse(json);
  const restored = sharesFromWire(parsed);

  assert(shamirVerify([restored[0], restored[2]], secret), 'wire round-trip');
});

// ════════════════════════════════════════════
// DATA SPLITTER (UPGRADED)
// ════════════════════════════════════════════
console.log('\n\x1b[1m── DataSplitter (Shamir) ──\x1b[0m');

test('split/reconstruct: default threshold', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('hello mesh');
  const shares = splitter.split(data, 5);
  assertEqual(shares.length, 5, '5 shares');

  // Default threshold = ceil(5/2) + 1 = 4
  // Reconstruct with all 5 (sequential x-coords)
  const recovered = splitter.reconstruct(shares);
  assert(bytesEqual(recovered, data), 'reconstructed');
});

test('split/reconstruct: custom threshold', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('custom threshold');
  const shares = splitter.split(data, 5, 2);

  // Any 2 should work (using sequential x-coords)
  const recovered = splitter.reconstruct([shares[0], shares[1]], [1, 2]);
  assert(bytesEqual(recovered, data), 'threshold 2');
});

test('splitWithMetadata: returns x-coordinates', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('metadata test');
  const result = splitter.splitWithMetadata(data, 5, 3);

  assertEqual(result.scheme, 'shamir', 'scheme');
  assertEqual(result.threshold, 3, 'threshold');
  assertEqual(result.shares.length, 5, '5 shares');
  assertEqual(result.xCoordinates!.length, 5, '5 x-coords');
  assertEqual(result.xCoordinates![0], 1, 'x[0] = 1');
  assertEqual(result.xCoordinates![4], 5, 'x[4] = 5');

  // Reconstruct with metadata
  const subset = [result.shares[0], result.shares[2], result.shares[4]];
  const xSubset = [result.xCoordinates![0], result.xCoordinates![2], result.xCoordinates![4]];
  const recovered = splitter.reconstruct(subset, xSubset);
  assert(bytesEqual(recovered, data), 'metadata reconstruct');
});

test('splitXOR: legacy v1.0 still works', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('legacy XOR');
  const shares = splitter.splitXOR(data, 3);
  assertEqual(shares.length, 3, '3 shares');

  const recovered = splitter.reconstructXOR(shares);
  assert(bytesEqual(recovered, data), 'XOR round-trip');
});

test('splitParallel: unchanged behavior', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('hello world, this is parallel');
  const chunks = splitter.splitParallel(data, 3);
  assert(chunks.length <= 3, 'at most 3 chunks');

  const recovered = splitter.reassembleParallel(chunks);
  assert(bytesEqual(recovered, data), 'parallel round-trip');
});

test('split: single share returns copy', () => {
  const splitter = new DataSplitter();
  const data = new TextEncoder().encode('single');
  const shares = splitter.split(data, 1);
  assertEqual(shares.length, 1, '1 share');
  assert(bytesEqual(shares[0], data), 'copy of original');
});

// ════════════════════════════════════════════
// LARGE DATA
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Large Data ──\x1b[0m');

test('Shamir: 1KB secret, 3-of-5', () => {
  const secret = randomBytes(1024);
  const shares = shamirSplit(secret, 5, 3);
  const recovered = shamirReconstruct([shares[0], shares[2], shares[4]]);
  assert(bytesEqual(recovered, secret), '1KB recovered');
});

test('Shamir: 10KB secret, 3-of-5', () => {
  const secret = randomBytes(10240);
  const shares = shamirSplit(secret, 5, 3);
  const recovered = shamirReconstruct([shares[1], shares[3], shares[4]]);
  assert(bytesEqual(recovered, secret), '10KB recovered');
});

test('DataSplitter: 64KB split, 3-of-5', () => {
  const splitter = new DataSplitter();
  const data = randomBytes(65536);
  const result = splitter.splitWithMetadata(data, 5, 3);
  const subset = [result.shares[0], result.shares[2], result.shares[4]];
  const xSubset = [result.xCoordinates![0], result.xCoordinates![2], result.xCoordinates![4]];
  const recovered = splitter.reconstruct(subset, xSubset);
  assert(bytesEqual(recovered, data), '64KB recovered');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 20: Shamir's Secret Sharing\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
