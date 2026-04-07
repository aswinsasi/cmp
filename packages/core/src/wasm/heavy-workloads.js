"use strict";
/**
 * CMP v5.0 Phase 1 — Heavy Computation WASM Modules
 *
 * These are NOT byte-shuffling demos. Each module performs real
 * computation that takes measurable CPU time, proving CMP can
 * distribute actual work.
 *
 * All built from raw opcodes — no external toolchain.
 * All follow the runtime convention: process(ptr, len) → outputLen
 *
 * Modules:
 *   matrix_multiply  — 32-bit integer matrix multiply (NxN × NxN)
 *   grayscale        — RGB→grayscale conversion (real pixel math)
 *   histogram        — 256-bin byte frequency histogram
 *   moving_average   — Sliding window average (configurable window)
 *   rle_compress     — Run-length encoding compression
 *
 * @module wasm/heavy-workloads
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEAVY_WORKLOADS = void 0;
exports.buildGrayscaleModule = buildGrayscaleModule;
exports.buildHistogramModule = buildHistogramModule;
exports.buildMovingAverageModule = buildMovingAverageModule;
exports.buildRLECompressModule = buildRLECompressModule;
const wasm_module_builder_1 = require("./wasm-module-builder");
function i32Const(v) { return [wasm_module_builder_1.Op.i32_const, ...(0, wasm_module_builder_1.encodeSignedLEB128)(v)]; }
function localGet(i) { return [wasm_module_builder_1.Op.local_get, ...(0, wasm_module_builder_1.encodeLEB128)(i)]; }
function localSet(i) { return [wasm_module_builder_1.Op.local_set, ...(0, wasm_module_builder_1.encodeLEB128)(i)]; }
function localTee(i) { return [wasm_module_builder_1.Op.local_tee, ...(0, wasm_module_builder_1.encodeLEB128)(i)]; }
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
// Grayscale: RGB → Gray using luminance
// ═══════════════════════════════════════
/**
 * Convert RGB pixel data to grayscale.
 * Input: packed RGB bytes [R,G,B,R,G,B,...] (3 bytes per pixel)
 * Output: 1 byte per pixel, gray = (R*77 + G*150 + B*29) >> 8
 * This is the standard ITU-R BT.601 luminance formula.
 *
 * Returns: number of output bytes (= input_len / 3)
 */
function buildGrayscaleModule() {
    // Params: ptr=0, len=1
    // Locals: i=2, outIdx=3, r=4, g=5, b=6, gray=7, pixelCount=8
    const P = 0, L = 1, I = 2, OUT = 3, R = 4, G = 5, B = 6, GRAY = 7, PXCOUNT = 8;
    const code = [
        // pixelCount = len / 3
        ...localGet(L), ...i32Const(3), wasm_module_builder_1.Op.i32_div_u, ...localSet(PXCOUNT),
        // outIdx starts at ptr + len (write output after input)
        ...localGet(P), ...localGet(L), wasm_module_builder_1.Op.i32_add, ...localSet(OUT),
        // i = 0 (pixel index)
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(PXCOUNT), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // Read R, G, B from memory[ptr + i*3], [ptr + i*3 + 1], [ptr + i*3 + 2]
        ...localGet(P), ...localGet(I), ...i32Const(3), wasm_module_builder_1.Op.i32_mul, wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...localSet(R),
        ...localGet(P), ...localGet(I), ...i32Const(3), wasm_module_builder_1.Op.i32_mul, wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...localSet(G),
        ...localGet(P), ...localGet(I), ...i32Const(3), wasm_module_builder_1.Op.i32_mul, wasm_module_builder_1.Op.i32_add, ...i32Const(2), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...localSet(B),
        // gray = (R*77 + G*150 + B*29) >> 8
        ...localGet(R), ...i32Const(77), wasm_module_builder_1.Op.i32_mul,
        ...localGet(G), ...i32Const(150), wasm_module_builder_1.Op.i32_mul,
        wasm_module_builder_1.Op.i32_add,
        ...localGet(B), ...i32Const(29), wasm_module_builder_1.Op.i32_mul,
        wasm_module_builder_1.Op.i32_add,
        ...i32Const(8), wasm_module_builder_1.Op.i32_shr_u,
        ...localSet(GRAY),
        // memory[outIdx + i] = gray
        ...localGet(OUT), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(GRAY),
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // Copy output to ptr (overwrite input)
        ...i32Const(0), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(PXCOUNT), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(OUT), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // return pixelCount
        ...localGet(PXCOUNT),
    ];
    return buildRuntimeModule('process', [[7, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// Histogram: 256-bin byte frequency count
// ═══════════════════════════════════════
/**
 * Compute a 256-bin histogram of byte frequencies.
 * Input: arbitrary bytes
 * Output: 256 × 4-byte uint32 LE = 1024 bytes
 *
 * This is a real reduction operation — used in image processing,
 * compression analysis, entropy calculation.
 */
function buildHistogramModule() {
    // Params: ptr=0, len=1
    // Locals: i=2, val=3, histBase=4, count=5
    const P = 0, L = 1, I = 2, VAL = 3, HBASE = 4, COUNT = 5;
    const code = [
        // histBase = ptr + len (output area: 256 * 4 = 1024 bytes)
        ...localGet(P), ...localGet(L), wasm_module_builder_1.Op.i32_add, ...localSet(HBASE),
        // Zero the histogram area (1024 bytes)
        ...i32Const(0), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...i32Const(256), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(HBASE), ...localGet(I), ...i32Const(4), wasm_module_builder_1.Op.i32_mul, wasm_module_builder_1.Op.i32_add,
        ...i32Const(0),
        wasm_module_builder_1.Op.i32_store, 0x02, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // Count byte frequencies
        ...i32Const(0), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // val = memory[ptr + i]
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...localSet(VAL),
        // histAddr = histBase + val * 4
        // count = memory[histAddr] + 1
        ...localGet(HBASE), ...localGet(VAL), ...i32Const(4), wasm_module_builder_1.Op.i32_mul, wasm_module_builder_1.Op.i32_add,
        ...localGet(HBASE), ...localGet(VAL), ...i32Const(4), wasm_module_builder_1.Op.i32_mul, wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load, 0x02, 0x00,
        ...i32Const(1), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_store, 0x02, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // Copy histogram to ptr (overwrite input)
        ...i32Const(0), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...i32Const(1024), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(HBASE), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // return 1024 (always 256 bins × 4 bytes)
        ...i32Const(1024),
    ];
    return buildRuntimeModule('process', [[4, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// Moving Average: sliding window smoothing
// ═══════════════════════════════════════
/**
 * Compute a sliding window moving average.
 * Window size is fixed at 8 (good for sensor smoothing).
 * Input: byte array
 * Output: same length, each byte = avg of surrounding 8 values
 *
 * This is a real signal processing operation.
 */
function buildMovingAverageModule(windowSize = 8) {
    // Params: ptr=0, len=1
    // Locals: i=2, j=3, sum=4, count=5, outBase=6, start=7, end_=8
    const P = 0, L = 1, I = 2, J = 3, SUM = 4, CNT = 5, OBASE = 6, START = 7, END = 8;
    const half = Math.floor(windowSize / 2);
    const code = [
        // outBase = ptr + len
        ...localGet(P), ...localGet(L), wasm_module_builder_1.Op.i32_add, ...localSet(OBASE),
        ...i32Const(0), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // start = max(0, i - half)
        ...localGet(I), ...i32Const(half), wasm_module_builder_1.Op.i32_sub,
        ...localSet(START),
        // if start < 0, start = 0
        ...localGet(START), ...i32Const(0), wasm_module_builder_1.Op.i32_lt_s,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_,
        ...i32Const(0), ...localSet(START),
        wasm_module_builder_1.Op.end,
        // end = min(len, i + half + 1)
        ...localGet(I), ...i32Const(half + 1), wasm_module_builder_1.Op.i32_add,
        ...localSet(END),
        ...localGet(END), ...localGet(L), wasm_module_builder_1.Op.i32_gt_u,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_,
        ...localGet(L), ...localSet(END),
        wasm_module_builder_1.Op.end,
        // sum = 0, count = 0
        ...i32Const(0), ...localSet(SUM),
        ...i32Const(0), ...localSet(CNT),
        // j = start
        ...localGet(START), ...localSet(J),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(J), ...localGet(END), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // sum += memory[ptr + j]
        ...localGet(SUM),
        ...localGet(P), ...localGet(J), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_add,
        ...localSet(SUM),
        // count++
        ...localGet(CNT), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(CNT),
        ...localGet(J), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(J),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // memory[outBase + i] = sum / count
        ...localGet(OBASE), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(SUM), ...localGet(CNT), wasm_module_builder_1.Op.i32_div_u,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // Copy output back to ptr
        ...i32Const(0), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(OBASE), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L),
    ];
    return buildRuntimeModule('process', [[7, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// RLE Compress: run-length encoding
// ═══════════════════════════════════════
/**
 * Run-length encoding compression.
 * Input: arbitrary bytes
 * Output: pairs of [count, value] bytes
 *
 * Example: [A,A,A,B,B,C] → [3,A,2,B,1,C]
 *
 * This is a real compression algorithm used in BMP, TIFF, fax.
 */
function buildRLECompressModule() {
    // Params: ptr=0, len=1
    // Locals: i=2, outIdx=3, runVal=4, runLen=5, curr=6, outBase=7
    const P = 0, L = 1, I = 2, OIDX = 3, RVAL = 4, RLEN = 5, CURR = 6, OBASE = 7;
    const code = [
        // Handle empty input
        ...localGet(L), wasm_module_builder_1.Op.i32_eqz,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.i32,
        ...i32Const(0),
        wasm_module_builder_1.Op.else_,
        // outBase = ptr + len
        ...localGet(P), ...localGet(L), wasm_module_builder_1.Op.i32_add, ...localSet(OBASE),
        // runVal = memory[ptr], runLen = 1, i = 1
        ...localGet(P), wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00, ...localSet(RVAL),
        ...i32Const(1), ...localSet(RLEN),
        ...i32Const(1), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(L), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // curr = memory[ptr + i]
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...localSet(CURR),
        // if curr == runVal AND runLen < 255: extend run
        ...localGet(CURR), ...localGet(RVAL), wasm_module_builder_1.Op.i32_eq,
        ...localGet(RLEN), ...i32Const(255), wasm_module_builder_1.Op.i32_lt_u,
        wasm_module_builder_1.Op.i32_and,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_,
        ...localGet(RLEN), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(RLEN),
        wasm_module_builder_1.Op.else_,
        // Flush current run
        ...localGet(OBASE), ...localGet(OIDX), wasm_module_builder_1.Op.i32_add,
        ...localGet(RLEN),
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(OBASE), ...localGet(OIDX), wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_add,
        ...localGet(RVAL),
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(OIDX), ...i32Const(2), wasm_module_builder_1.Op.i32_add, ...localSet(OIDX),
        // Start new run
        ...localGet(CURR), ...localSet(RVAL),
        ...i32Const(1), ...localSet(RLEN),
        wasm_module_builder_1.Op.end,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // Flush final run
        ...localGet(OBASE), ...localGet(OIDX), wasm_module_builder_1.Op.i32_add,
        ...localGet(RLEN),
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(OBASE), ...localGet(OIDX), wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_add,
        ...localGet(RVAL),
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(OIDX), ...i32Const(2), wasm_module_builder_1.Op.i32_add, ...localSet(OIDX),
        // Copy output back to ptr
        ...i32Const(0), ...localSet(I),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(I), ...localGet(OIDX), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(P), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        ...localGet(OBASE), ...localGet(I), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(I), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(I),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(OIDX),
        wasm_module_builder_1.Op.end,
    ];
    return buildRuntimeModule('process', [[6, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// Registry
// ═══════════════════════════════════════
exports.HEAVY_WORKLOADS = {
    grayscale: buildGrayscaleModule,
    histogram: buildHistogramModule,
    moving_average: () => buildMovingAverageModule(8),
    rle_compress: buildRLECompressModule,
};
//# sourceMappingURL=heavy-workloads.js.map