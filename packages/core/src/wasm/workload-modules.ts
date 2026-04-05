/**
 * CMP v4.0 — Real Workload WASM Modules
 *
 * These modules match the RUNTIME sandbox convention used by
 * the actual CMP compute pipeline:
 *   - Function signature: (ptr: i32, len: i32) -> i32
 *   - Input at memory[ptr..ptr+len]
 *   - Output written in-place starting at memory[ptr]
 *   - Return value = output length
 *
 * This is the SAME convention as the existing XOR cipher module,
 * so these plug directly into node.compute() and get distributed
 * across real mesh devices through the negotiation layer.
 *
 * Modules:
 *   sensor_filter   — Keep bytes > threshold, compact in-place
 *   sensor_scale    — Scale each byte by factor/256 (fixed-point multiply)
 *   sensor_clamp    — Clamp each byte to [lo, hi] range
 *   sensor_delta    — Delta encoding (each byte = current - previous)
 *   sensor_peaks    — Extract local maxima (byte > both neighbors)
 *
 * @module wasm/workload-modules
 * @author Agent Viscro
 */

import { WasmModuleBuilder, Op, encodeSignedLEB128, encodeLEB128 } from './wasm-module-builder';

// ─── Helper ───

function i32Const(v: number): number[] {
  return [Op.i32_const, ...encodeSignedLEB128(v)];
}
function localGet(i: number): number[] { return [Op.local_get, ...encodeLEB128(i)]; }
function localSet(i: number): number[] { return [Op.local_set, ...encodeLEB128(i)]; }

/**
 * Build a module with the RUNTIME convention:
 *   export "memory" (1 page)
 *   export entryPoint: (ptr: i32, len: i32) -> i32
 */
function buildRuntimeModule(
  entryPoint: string,
  locals: Array<[number, number]>,
  code: number[],
  memPages: number = 4,
): Uint8Array {
  const builder = new WasmModuleBuilder();
  builder.setMemoryPages(memPages);
  const typeIdx = builder.addType([Op.i32, Op.i32], [Op.i32]);
  const funcIdx = builder.addFunction(typeIdx, locals, code);
  builder.addExport('memory', 2, 0);
  builder.addExport(entryPoint, 0, funcIdx);
  return builder.build();
}

// ═══════════════════════════════════════
// Sensor Filter: keep bytes > threshold
// ═══════════════════════════════════════

/**
 * Filter sensor readings: keep only values above threshold.
 * Compacts matching values in-place at the ptr.
 *
 * Example: input [50, 150, 30, 200, 90] threshold=100
 *        → output [150, 200], returns 2
 */
export function buildSensorFilter(threshold: number = 100): Uint8Array {
  // Params: ptr=0, len=1
  // Locals: i=2, writeIdx=3
  const P = 0, L = 1, I = 2, W = 3;

  const code = [
    Op.block, Op.void_,
      Op.loop, Op.void_,
        // if i >= len: break
        ...localGet(I), ...localGet(L), Op.i32_ge_u, Op.br_if, 0x01,

        // val = memory[ptr + i]
        ...localGet(P), ...localGet(I), Op.i32_add,
        Op.i32_load8_u, 0x00, 0x00,

        // if val > threshold
        ...i32Const(threshold),
        Op.i32_gt_u,
        Op.if_, Op.void_,
          // memory[ptr + writeIdx] = memory[ptr + i]
          ...localGet(P), ...localGet(W), Op.i32_add,
          ...localGet(P), ...localGet(I), Op.i32_add,
          Op.i32_load8_u, 0x00, 0x00,
          Op.i32_store8, 0x00, 0x00,
          // writeIdx++
          ...localGet(W), ...i32Const(1), Op.i32_add, ...localSet(W),
        Op.end,

        // i++
        ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
        Op.br, 0x00,
      Op.end,
    Op.end,
    // return writeIdx
    ...localGet(W),
  ];

  return buildRuntimeModule('process', [[2, Op.i32]], code);
}

// ═══════════════════════════════════════
// Sensor Scale: fixed-point multiply
// ═══════════════════════════════════════

/**
 * Scale each byte by factor/256 (fixed-point multiplication).
 * factor=128 → halve, factor=512 → double, factor=192 → ×0.75
 *
 * Processes in-place, returns same length.
 */
export function buildSensorScale(factor: number = 128): Uint8Array {
  const P = 0, L = 1, I = 2, V = 3;

  const code = [
    Op.block, Op.void_,
      Op.loop, Op.void_,
        ...localGet(I), ...localGet(L), Op.i32_ge_u, Op.br_if, 0x01,

        // v = memory[ptr + i] * factor / 256
        ...localGet(P), ...localGet(I), Op.i32_add,
        Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(factor), Op.i32_mul,
        ...i32Const(256), Op.i32_div_u,
        ...localSet(V),

        // memory[ptr + i] = v (store8 truncates to byte automatically)
        ...localGet(P), ...localGet(I), Op.i32_add,
        ...localGet(V),
        Op.i32_store8, 0x00, 0x00,

        ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
        Op.br, 0x00,
      Op.end,
    Op.end,
    ...localGet(L), // return original length
  ];

  return buildRuntimeModule('process', [[2, Op.i32]], code);
}

// ═══════════════════════════════════════
// Sensor Clamp: clamp to [lo, hi]
// ═══════════════════════════════════════

/**
 * Clamp each byte to [lo, hi] range.
 * Values below lo → lo, values above hi → hi.
 */
export function buildSensorClamp(lo: number = 20, hi: number = 200): Uint8Array {
  const P = 0, L = 1, I = 2, V = 3;

  const code = [
    Op.block, Op.void_,
      Op.loop, Op.void_,
        ...localGet(I), ...localGet(L), Op.i32_ge_u, Op.br_if, 0x01,

        // v = memory[ptr + i]
        ...localGet(P), ...localGet(I), Op.i32_add,
        Op.i32_load8_u, 0x00, 0x00,
        ...localSet(V),

        // if v < lo: v = lo
        ...localGet(V), ...i32Const(lo), Op.i32_lt_u,
        Op.if_, Op.void_,
          ...i32Const(lo), ...localSet(V),
        Op.end,

        // if v > hi: v = hi
        ...localGet(V), ...i32Const(hi), Op.i32_gt_u,
        Op.if_, Op.void_,
          ...i32Const(hi), ...localSet(V),
        Op.end,

        // memory[ptr + i] = v
        ...localGet(P), ...localGet(I), Op.i32_add,
        ...localGet(V),
        Op.i32_store8, 0x00, 0x00,

        ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
        Op.br, 0x00,
      Op.end,
    Op.end,
    ...localGet(L),
  ];

  return buildRuntimeModule('process', [[2, Op.i32]], code);
}

// ═══════════════════════════════════════
// Sensor Delta: delta encoding
// ═══════════════════════════════════════

/**
 * Delta encoding: each output byte = current - previous.
 * First byte stays unchanged. Processes in-place.
 * Useful for compression of slowly-changing sensor data.
 */
export function buildSensorDelta(): Uint8Array {
  const P = 0, L = 1, I = 2, PREV = 3, CURR = 4;

  const code = [
    // If len == 0, return 0
    ...localGet(L), Op.i32_eqz,
    Op.if_, Op.i32,
      ...i32Const(0),
    Op.else_,
      // prev = memory[ptr]
      ...localGet(P), Op.i32_load8_u, 0x00, 0x00, ...localSet(PREV),
      // i = 1
      ...i32Const(1), ...localSet(I),

      Op.block, Op.void_,
        Op.loop, Op.void_,
          ...localGet(I), ...localGet(L), Op.i32_ge_u, Op.br_if, 0x01,

          // curr = memory[ptr + i]
          ...localGet(P), ...localGet(I), Op.i32_add,
          Op.i32_load8_u, 0x00, 0x00,
          ...localSet(CURR),

          // memory[ptr + i] = (curr - prev) & 0xFF
          ...localGet(P), ...localGet(I), Op.i32_add,
          ...localGet(CURR), ...localGet(PREV), Op.i32_sub,
          Op.i32_store8, 0x00, 0x00,

          // prev = curr
          ...localGet(CURR), ...localSet(PREV),

          ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
          Op.br, 0x00,
        Op.end,
      Op.end,

      ...localGet(L),
    Op.end,
  ];

  return buildRuntimeModule('process', [[3, Op.i32]], code);
}

// ═══════════════════════════════════════
// Sensor Peaks: extract local maxima
// ═══════════════════════════════════════

/**
 * Extract local maxima: byte > left neighbor AND byte > right neighbor.
 * Compacts peak values in-place.
 * Returns count of peaks found.
 */
export function buildSensorPeaks(): Uint8Array {
  const P = 0, L = 1, I = 2, W = 3;

  const code = [
    // Need at least 3 elements
    ...localGet(L), ...i32Const(3), Op.i32_lt_u,
    Op.if_, Op.i32,
      ...i32Const(0),
    Op.else_,
      // i = 1 (skip first element)
      ...i32Const(1), ...localSet(I),

      Op.block, Op.void_,
        Op.loop, Op.void_,
          // if i >= len - 1: break (skip last element)
          ...localGet(I), ...localGet(L), ...i32Const(1), Op.i32_sub, Op.i32_ge_u, Op.br_if, 0x01,

          // curr = memory[ptr + i]
          // left = memory[ptr + i - 1]
          // right = memory[ptr + i + 1]
          // if curr > left AND curr > right: it's a peak
          ...localGet(P), ...localGet(I), Op.i32_add,
          Op.i32_load8_u, 0x00, 0x00, // curr on stack

          ...localGet(P), ...localGet(I), Op.i32_add, ...i32Const(1), Op.i32_sub,
          Op.i32_load8_u, 0x00, 0x00, // left on stack

          Op.i32_gt_u, // curr > left

          Op.if_, Op.void_,
            // Check curr > right
            ...localGet(P), ...localGet(I), Op.i32_add,
            Op.i32_load8_u, 0x00, 0x00,
            ...localGet(P), ...localGet(I), Op.i32_add, ...i32Const(1), Op.i32_add,
            Op.i32_load8_u, 0x00, 0x00,
            Op.i32_gt_u,
            Op.if_, Op.void_,
              // Peak found! Write to output
              ...localGet(P), ...localGet(W), Op.i32_add,
              ...localGet(P), ...localGet(I), Op.i32_add,
              Op.i32_load8_u, 0x00, 0x00,
              Op.i32_store8, 0x00, 0x00,
              ...localGet(W), ...i32Const(1), Op.i32_add, ...localSet(W),
            Op.end,
          Op.end,

          ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
          Op.br, 0x00,
        Op.end,
      Op.end,
      ...localGet(W),
    Op.end,
  ];

  return buildRuntimeModule('process', [[2, Op.i32]], code);
}

// ═══════════════════════════════════════
// Registry
// ═══════════════════════════════════════

export const WORKLOAD_MODULES: Record<string, () => Uint8Array> = {
  sensor_filter: () => buildSensorFilter(100),
  sensor_filter_50: () => buildSensorFilter(50),
  sensor_scale_half: () => buildSensorScale(128),
  sensor_scale_double: () => buildSensorScale(512),
  sensor_clamp: () => buildSensorClamp(20, 200),
  sensor_delta: buildSensorDelta,
  sensor_peaks: buildSensorPeaks,
};
