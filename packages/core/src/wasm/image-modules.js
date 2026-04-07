"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInvertModule = buildInvertModule;
exports.buildBrightnessModule = buildBrightnessModule;
exports.buildContrastModule = buildContrastModule;
exports.buildThresholdModule = buildThresholdModule;
exports.buildEdgeDetectModule = buildEdgeDetectModule;
const wasm_module_builder_1 = require("./wasm-module-builder");
function i32Const(v) { return [wasm_module_builder_1.Op.i32_const, ...(0, wasm_module_builder_1.encodeSignedLEB128)(v)]; }
function localGet(i) { return [wasm_module_builder_1.Op.local_get, ...(0, wasm_module_builder_1.encodeLEB128)(i)]; }
function localSet(i) { return [wasm_module_builder_1.Op.local_set, ...(0, wasm_module_builder_1.encodeLEB128)(i)]; }
function buildRuntimeModule(entryPoint, locals, code, memPages = 16) {
    const builder = new wasm_module_builder_1.WasmModuleBuilder();
    builder.setMemoryPages(memPages);
    const typeIdx = builder.addType([wasm_module_builder_1.Op.i32, wasm_module_builder_1.Op.i32], [wasm_module_builder_1.Op.i32]);
    const funcIdx = builder.addFunction(typeIdx, locals, code);
    builder.addExport('memory', 2, 0);
    builder.addExport(entryPoint, 0, funcIdx);
    return builder.build();
}
// ═══════════════════════════════════════
// Invert: 255 - pixel
// ═══════════════════════════════════════
function buildInvertModule() {
    const P = 0, L = 1, I = 2;
    const code = [
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...i32Const(255),
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add, wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_sub,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L),
    ];
    return buildRuntimeModule('process', [[1, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// Brightness: clamp(pixel + offset, 0, 255)
// ═══════════════════════════════════════
function buildBrightnessModule(offset = 30) {
    const P = 0, L = 1, I = 2, V = 3;
    const code = [
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // v = pixel + offset
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add, wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(offset), wasm_module_builder_1.Op.i32_add,
        ...localSet(V),
        // clamp to 0
        ...localGet(V), ...i32Const(0), wasm_module_builder_1.Op.i32_lt_s,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_, ...i32Const(0), ...localSet(V), wasm_module_builder_1.Op.end,
        // clamp to 255
        ...localGet(V), ...i32Const(255), wasm_module_builder_1.Op.i32_gt_s,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_, ...i32Const(255), ...localSet(V), wasm_module_builder_1.Op.end,
        // store
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(V), wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L),
    ];
    return buildRuntimeModule('process', [[2, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// Contrast: stretch histogram around midpoint
// formula: clamp((pixel - 128) * factor / 128 + 128, 0, 255)
// factor=192 → boost contrast, factor=64 → reduce
// ═══════════════════════════════════════
function buildContrastModule(factor = 192) {
    const P = 0, L = 1, I = 2, V = 3;
    const code = [
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // v = (pixel - 128) * factor / 128 + 128
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add, wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(128), wasm_module_builder_1.Op.i32_sub,
        ...i32Const(factor), wasm_module_builder_1.Op.i32_mul,
        ...i32Const(128), wasm_module_builder_1.Op.i32_div_s,
        ...i32Const(128), wasm_module_builder_1.Op.i32_add,
        ...localSet(V),
        // clamp
        ...localGet(V), ...i32Const(0), wasm_module_builder_1.Op.i32_lt_s,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_, ...i32Const(0), ...localSet(V), wasm_module_builder_1.Op.end,
        ...localGet(V), ...i32Const(255), wasm_module_builder_1.Op.i32_gt_s,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_, ...i32Const(255), ...localSet(V), wasm_module_builder_1.Op.end,
        // store
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(V), wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L),
    ];
    return buildRuntimeModule('process', [[2, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// Threshold: binary image (pixel > thresh → 255, else → 0)
// ═══════════════════════════════════════
function buildThresholdModule(thresh = 128) {
    const P = 0, L = 1, I = 2;
    const code = [
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        // pixel > thresh ? 255 : 0
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add, wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(thresh), wasm_module_builder_1.Op.i32_gt_u,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.i32, ...i32Const(255), wasm_module_builder_1.Op.else_, ...i32Const(0), wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L),
    ];
    return buildRuntimeModule('process', [[1, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// Sobel Edge Detect (horizontal, grayscale input)
// Uses 3x3 kernel, needs width as param
// Simplified: treats input as 1D, detects byte-level edges
// edge = |pixel[i] - pixel[i-1]| + |pixel[i] - pixel[i+1]|
// ═══════════════════════════════════════
function buildEdgeDetectModule() {
    const P = 0, L = 1, I = 2, LEFT = 3, RIGHT = 4, CURR = 5, EDGE = 6;
    const code = [
        // First and last byte = 0
        ...localGet(P), ...i32Const(0), wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(L), ...i32Const(1), wasm_module_builder_1.Op.i32_lt_u,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.i32,
        ...localGet(L),
        wasm_module_builder_1.Op.else_,
        // Set last byte = 0
        ...localGet(P), ...localGet(L), wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_sub,
        ...i32Const(0), wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...i32Const(1), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), ...i32Const(1), wasm_module_builder_1.Op.i32_sub, wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // curr = mem[ptr+i]
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add, wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00, ...localSet(CURR),
        // left = mem[ptr+i-1]
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_sub, wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00, ...localSet(LEFT),
        // right = mem[ptr+i+1]
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_add, wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00, ...localSet(RIGHT),
        // edge = |curr - left| + |curr - right|
        // |a-b| = if a>b then a-b else b-a
        ...localGet(CURR), ...localGet(LEFT), wasm_module_builder_1.Op.i32_gt_u,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.i32,
        ...localGet(CURR), ...localGet(LEFT), wasm_module_builder_1.Op.i32_sub,
        wasm_module_builder_1.Op.else_,
        ...localGet(LEFT), ...localGet(CURR), wasm_module_builder_1.Op.i32_sub,
        wasm_module_builder_1.Op.end,
        ...localGet(CURR), ...localGet(RIGHT), wasm_module_builder_1.Op.i32_gt_u,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.i32,
        ...localGet(CURR), ...localGet(RIGHT), wasm_module_builder_1.Op.i32_sub,
        wasm_module_builder_1.Op.else_,
        ...localGet(RIGHT), ...localGet(CURR), wasm_module_builder_1.Op.i32_sub,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.i32_add,
        ...localSet(EDGE),
        // clamp to 255
        ...localGet(EDGE), ...i32Const(255), wasm_module_builder_1.Op.i32_gt_u,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_, ...i32Const(255), ...localSet(EDGE), wasm_module_builder_1.Op.end,
        // store
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(EDGE), wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L),
        wasm_module_builder_1.Op.end,
    ];
    return buildRuntimeModule('process', [[5, wasm_module_builder_1.Op.i32]], code);
}
//# sourceMappingURL=image-modules.js.map