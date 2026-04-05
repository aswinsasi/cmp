/**
 * CMP v5.0 — Image Processing WASM Modules
 *
 * Real image processing operations for the killer app demo.
 * Combined with the existing grayscale module, these form a
 * complete image processing pipeline.
 *
 * Pipeline example:
 *   raw RGB → grayscale → contrast → threshold → output
 *   4 stages, 4 devices, all processing real pixels.
 *
 * All follow the runtime convention: process(ptr, len) → outputLen
 *
 * @module wasm/image-modules
 * @author Agent Viscro
 */

import { WasmModuleBuilder, Op, encodeSignedLEB128, encodeLEB128 } from './wasm-module-builder';

function i32Const(v: number): number[] { return [Op.i32_const, ...encodeSignedLEB128(v)]; }
function localGet(i: number): number[] { return [Op.local_get, ...encodeLEB128(i)]; }
function localSet(i: number): number[] { return [Op.local_set, ...encodeLEB128(i)]; }

function buildRuntimeModule(entryPoint: string, locals: Array<[number, number]>, code: number[], memPages: number = 16): Uint8Array {
  const builder = new WasmModuleBuilder();
  builder.setMemoryPages(memPages);
  const typeIdx = builder.addType([Op.i32, Op.i32], [Op.i32]);
  const funcIdx = builder.addFunction(typeIdx, locals, code);
  builder.addExport('memory', 2, 0);
  builder.addExport(entryPoint, 0, funcIdx);
  return builder.build();
}

// ═══════════════════════════════════════
// Invert: 255 - pixel
// ═══════════════════════════════════════

export function buildInvertModule(): Uint8Array {
  const P=0, L=1, I=2;
  const code = [
    Op.block, Op.void_,
      Op.loop, Op.void_,
        ...localGet(I), ...localGet(L), Op.i32_ge_u, Op.br_if, 0x01,
        ...localGet(P), ...localGet(I), Op.i32_add,
        ...i32Const(255),
        ...localGet(P), ...localGet(I), Op.i32_add, Op.i32_load8_u, 0x00, 0x00,
        Op.i32_sub,
        Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
        Op.br, 0x00,
      Op.end,
    Op.end,
    ...localGet(L),
  ];
  return buildRuntimeModule('process', [[1, Op.i32]], code);
}

// ═══════════════════════════════════════
// Brightness: clamp(pixel + offset, 0, 255)
// ═══════════════════════════════════════

export function buildBrightnessModule(offset: number = 30): Uint8Array {
  const P=0, L=1, I=2, V=3;
  const code = [
    Op.block, Op.void_,
      Op.loop, Op.void_,
        ...localGet(I), ...localGet(L), Op.i32_ge_u, Op.br_if, 0x01,
        // v = pixel + offset
        ...localGet(P), ...localGet(I), Op.i32_add, Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(offset), Op.i32_add,
        ...localSet(V),
        // clamp to 0
        ...localGet(V), ...i32Const(0), Op.i32_lt_s,
        Op.if_, Op.void_, ...i32Const(0), ...localSet(V), Op.end,
        // clamp to 255
        ...localGet(V), ...i32Const(255), Op.i32_gt_s,
        Op.if_, Op.void_, ...i32Const(255), ...localSet(V), Op.end,
        // store
        ...localGet(P), ...localGet(I), Op.i32_add,
        ...localGet(V), Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
        Op.br, 0x00,
      Op.end,
    Op.end,
    ...localGet(L),
  ];
  return buildRuntimeModule('process', [[2, Op.i32]], code);
}

// ═══════════════════════════════════════
// Contrast: stretch histogram around midpoint
// formula: clamp((pixel - 128) * factor / 128 + 128, 0, 255)
// factor=192 → boost contrast, factor=64 → reduce
// ═══════════════════════════════════════

export function buildContrastModule(factor: number = 192): Uint8Array {
  const P=0, L=1, I=2, V=3;
  const code = [
    Op.block, Op.void_,
      Op.loop, Op.void_,
        ...localGet(I), ...localGet(L), Op.i32_ge_u, Op.br_if, 0x01,
        // v = (pixel - 128) * factor / 128 + 128
        ...localGet(P), ...localGet(I), Op.i32_add, Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(128), Op.i32_sub,
        ...i32Const(factor), Op.i32_mul,
        ...i32Const(128), Op.i32_div_s,
        ...i32Const(128), Op.i32_add,
        ...localSet(V),
        // clamp
        ...localGet(V), ...i32Const(0), Op.i32_lt_s,
        Op.if_, Op.void_, ...i32Const(0), ...localSet(V), Op.end,
        ...localGet(V), ...i32Const(255), Op.i32_gt_s,
        Op.if_, Op.void_, ...i32Const(255), ...localSet(V), Op.end,
        // store
        ...localGet(P), ...localGet(I), Op.i32_add,
        ...localGet(V), Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
        Op.br, 0x00,
      Op.end,
    Op.end,
    ...localGet(L),
  ];
  return buildRuntimeModule('process', [[2, Op.i32]], code);
}

// ═══════════════════════════════════════
// Threshold: binary image (pixel > thresh → 255, else → 0)
// ═══════════════════════════════════════

export function buildThresholdModule(thresh: number = 128): Uint8Array {
  const P=0, L=1, I=2;
  const code = [
    Op.block, Op.void_,
      Op.loop, Op.void_,
        ...localGet(I), ...localGet(L), Op.i32_ge_u, Op.br_if, 0x01,
        ...localGet(P), ...localGet(I), Op.i32_add,
        // pixel > thresh ? 255 : 0
        ...localGet(P), ...localGet(I), Op.i32_add, Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(thresh), Op.i32_gt_u,
        Op.if_, Op.i32, ...i32Const(255), Op.else_, ...i32Const(0), Op.end,
        Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
        Op.br, 0x00,
      Op.end,
    Op.end,
    ...localGet(L),
  ];
  return buildRuntimeModule('process', [[1, Op.i32]], code);
}

// ═══════════════════════════════════════
// Sobel Edge Detect (horizontal, grayscale input)
// Uses 3x3 kernel, needs width as param
// Simplified: treats input as 1D, detects byte-level edges
// edge = |pixel[i] - pixel[i-1]| + |pixel[i] - pixel[i+1]|
// ═══════════════════════════════════════

export function buildEdgeDetectModule(): Uint8Array {
  const P=0, L=1, I=2, LEFT=3, RIGHT=4, CURR=5, EDGE=6;
  const code = [
    // First and last byte = 0
    ...localGet(P), ...i32Const(0), Op.i32_store8, 0x00, 0x00,
    ...localGet(L), ...i32Const(1), Op.i32_lt_u,
    Op.if_, Op.i32,
      ...localGet(L),
    Op.else_,
      // Set last byte = 0
      ...localGet(P), ...localGet(L), Op.i32_add, ...i32Const(1), Op.i32_sub,
      ...i32Const(0), Op.i32_store8, 0x00, 0x00,

      ...i32Const(1), ...localSet(I),
      Op.block, Op.void_,
        Op.loop, Op.void_,
          ...localGet(I), ...localGet(L), ...i32Const(1), Op.i32_sub, Op.i32_ge_u, Op.br_if, 0x01,

          // curr = mem[ptr+i]
          ...localGet(P), ...localGet(I), Op.i32_add, Op.i32_load8_u, 0x00, 0x00, ...localSet(CURR),
          // left = mem[ptr+i-1]
          ...localGet(P), ...localGet(I), Op.i32_add, ...i32Const(1), Op.i32_sub, Op.i32_load8_u, 0x00, 0x00, ...localSet(LEFT),
          // right = mem[ptr+i+1]
          ...localGet(P), ...localGet(I), Op.i32_add, ...i32Const(1), Op.i32_add, Op.i32_load8_u, 0x00, 0x00, ...localSet(RIGHT),

          // edge = |curr - left| + |curr - right|
          // |a-b| = if a>b then a-b else b-a
          ...localGet(CURR), ...localGet(LEFT), Op.i32_gt_u,
          Op.if_, Op.i32,
            ...localGet(CURR), ...localGet(LEFT), Op.i32_sub,
          Op.else_,
            ...localGet(LEFT), ...localGet(CURR), Op.i32_sub,
          Op.end,

          ...localGet(CURR), ...localGet(RIGHT), Op.i32_gt_u,
          Op.if_, Op.i32,
            ...localGet(CURR), ...localGet(RIGHT), Op.i32_sub,
          Op.else_,
            ...localGet(RIGHT), ...localGet(CURR), Op.i32_sub,
          Op.end,

          Op.i32_add,
          ...localSet(EDGE),

          // clamp to 255
          ...localGet(EDGE), ...i32Const(255), Op.i32_gt_u,
          Op.if_, Op.void_, ...i32Const(255), ...localSet(EDGE), Op.end,

          // store
          ...localGet(P), ...localGet(I), Op.i32_add,
          ...localGet(EDGE), Op.i32_store8, 0x00, 0x00,

          ...localGet(I), ...i32Const(1), Op.i32_add, ...localSet(I),
          Op.br, 0x00,
        Op.end,
      Op.end,
      ...localGet(L),
    Op.end,
  ];
  return buildRuntimeModule('process', [[5, Op.i32]], code);
}
