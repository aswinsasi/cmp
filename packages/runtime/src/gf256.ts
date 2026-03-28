/**
 * GF(256) Finite Field Arithmetic
 * Galois Field operations over 2^8 using the AES irreducible polynomial.
 *
 * Irreducible polynomial: x^8 + x^4 + x^3 + x + 1 (0x11B)
 * This is the same field used by AES, extensively tested and
 * hardware-accelerated on modern processors.
 *
 * All operations work on single bytes (0-255).
 * Multiplication uses log/exp table lookup for O(1) performance.
 *
 * @module runtime/gf256
 * @author Agent Viscro
 */

const FIELD_SIZE = 256;
const POLYNOMIAL = 0x11B; // x^8 + x^4 + x^3 + x + 1

// ── Log and Exp lookup tables ──
// exp[i] = g^i mod P, where g=3 is a generator of GF(256)
// log[exp[i]] = i
// These enable O(1) multiplication: a*b = exp[log[a] + log[b]]

const EXP_TABLE = new Uint8Array(FIELD_SIZE * 2); // doubled for modular wraparound
const LOG_TABLE = new Uint8Array(FIELD_SIZE);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x; // mirror for easy modular access
    LOG_TABLE[x] = i;
    x = mulSlow(x, 3); // 3 is a generator of GF(256)*
  }
  LOG_TABLE[0] = 0; // convention: log(0) = 0 (only used with guard)
})();

/**
 * Slow multiplication using Russian peasant / shift-and-add.
 * Only used for table construction — not called at runtime.
 */
function mulSlow(a: number, b: number): number {
  let result = 0;
  let aa = a;
  let bb = b;
  while (bb > 0) {
    if (bb & 1) result ^= aa;
    aa <<= 1;
    if (aa & 0x100) aa ^= POLYNOMIAL;
    bb >>= 1;
  }
  return result;
}

// ── Public API ──

/**
 * Add two GF(256) elements. Addition in GF(2^8) is XOR.
 */
export function gfAdd(a: number, b: number): number {
  return a ^ b;
}

/**
 * Subtract two GF(256) elements. In GF(2^8), subtraction = addition = XOR.
 */
export function gfSub(a: number, b: number): number {
  return a ^ b;
}

/**
 * Multiply two GF(256) elements using log/exp table lookup.
 * Returns 0 if either operand is 0.
 */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

/**
 * Divide a by b in GF(256). Returns a * b^(-1).
 * Throws if b is 0 (division by zero).
 */
export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('GF(256) division by zero');
  if (a === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] + 255 - LOG_TABLE[b]) % 255];
}

/**
 * Compute the multiplicative inverse of a in GF(256).
 * a * gfInv(a) = 1 for all a != 0.
 */
export function gfInv(a: number): number {
  if (a === 0) throw new Error('GF(256) inverse of zero');
  return EXP_TABLE[255 - LOG_TABLE[a]];
}

/**
 * Raise a to the power n in GF(256).
 */
export function gfPow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  const logA = LOG_TABLE[a];
  return EXP_TABLE[(logA * n) % 255];
}

/**
 * Evaluate a polynomial at point x in GF(256).
 * Coefficients: poly[0] = constant term, poly[degree] = leading coefficient.
 * Uses Horner's method for efficiency.
 *
 * @param poly - Polynomial coefficients [a0, a1, ..., ak]
 * @param x - Point to evaluate at
 * @returns poly(x) in GF(256)
 */
export function gfPolyEval(poly: Uint8Array, x: number): number {
  if (poly.length === 0) return 0;
  // Horner's method: ((a_k * x + a_{k-1}) * x + ... ) * x + a_0
  let result = poly[poly.length - 1];
  for (let i = poly.length - 2; i >= 0; i--) {
    result = gfAdd(gfMul(result, x), poly[i]);
  }
  return result;
}

/**
 * Lagrange interpolation at x=0 to recover the secret.
 * Given (x_i, y_i) pairs, computes the polynomial's value at x=0.
 *
 * This is the core reconstruction step of Shamir's Secret Sharing.
 *
 * @param xs - x-coordinates of the shares (must be non-zero)
 * @param ys - y-values (share values for one byte position)
 * @returns The interpolated value at x=0 (the secret byte)
 */
export function lagrangeInterpolateAt0(xs: Uint8Array, ys: Uint8Array): number {
  const k = xs.length;
  if (k === 0) return 0;
  if (k !== ys.length) throw new Error('xs and ys must have same length');

  let result = 0;

  for (let i = 0; i < k; i++) {
    // Compute Lagrange basis polynomial L_i(0) = prod_{j!=i} (0 - x_j) / (x_i - x_j)
    // Since we evaluate at x=0: L_i(0) = prod_{j!=i} x_j / (x_j - x_i)
    // In GF(256): subtraction = XOR, so (x_j - x_i) = (x_j ^ x_i)
    let numerator = 1;
    let denominator = 1;

    for (let j = 0; j < k; j++) {
      if (i === j) continue;
      numerator = gfMul(numerator, xs[j]);          // prod(x_j)
      denominator = gfMul(denominator, gfSub(xs[j], xs[i])); // prod(x_j - x_i)
    }

    // L_i(0) = numerator / denominator
    const lagrangeBasis = gfDiv(numerator, denominator);

    // result += y_i * L_i(0)
    result = gfAdd(result, gfMul(ys[i], lagrangeBasis));
  }

  return result;
}
