"use strict";
/**
 * CMP v4.0 — Built-in WASM Modules
 *
 * Real, executable WASM modules built at runtime using the
 * WasmModuleBuilder. These are NOT stubs — they compile to
 * valid WebAssembly and execute on Node's V8 engine.
 *
 * Available modules:
 *   - doubleBytes: multiply each byte by 2
 *   - xorCipher: XOR each byte with a key (byte at memory[inputLen-1])
 *   - thresholdFilter: keep bytes above a threshold
 *   - byteSort: bubble sort bytes in-place
 *   - sumReduce: sum all bytes, output as 4-byte uint32
 *   - identity: copy input to output unchanged
 *
 * All follow the CMP convention:
 *   Input at memory[0..inputLen], process(inputLen) → outputLen
 *   Output at memory[inputLen..inputLen+outputLen]
 *
 * @module wasm/builtin-wasm-modules
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildIdentityModule = buildIdentityModule;
exports.buildDoubleBytesModule = buildDoubleBytesModule;
exports.buildXorCipherModule = buildXorCipherModule;
exports.buildThresholdFilterModule = buildThresholdFilterModule;
exports.buildByteSortModule = buildByteSortModule;
exports.buildSumReduceModule = buildSumReduceModule;
exports.getBuiltinWasmModule = getBuiltinWasmModule;
exports.getBuiltinWasmModuleNames = getBuiltinWasmModuleNames;
const wasm_module_builder_1 = require("./wasm-module-builder");
// ─── Helper: i32.const with signed LEB128 ───
function i32Const(value) {
    return [wasm_module_builder_1.Op.i32_const, ...(0, wasm_module_builder_1.encodeSignedLEB128)(value)];
}
// ─── Helper: local.get ───
function localGet(index) {
    return [wasm_module_builder_1.Op.local_get, ...(0, wasm_module_builder_1.encodeLEB128)(index)];
}
// ─── Helper: local.set ───
function localSet(index) {
    return [wasm_module_builder_1.Op.local_set, ...(0, wasm_module_builder_1.encodeLEB128)(index)];
}
// ─── Helper: local.tee ───
function localTee(index) {
    return [wasm_module_builder_1.Op.local_tee, ...(0, wasm_module_builder_1.encodeLEB128)(index)];
}
// ═══════════════════════════════════════
// Identity: copy input to output
// ═══════════════════════════════════════
function buildIdentityModule() {
    // process(inputLen: i32) -> i32
    // Locals: i (i32)
    //
    // loop: memory[inputLen + i] = memory[i]; i++; if i < inputLen, loop
    // return inputLen
    const L_inputLen = 0;
    const L_i = 1;
    const code = [
        // i = 0 (already 0)
        // block $break
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        // loop $loop
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        // br_if $break (i >= inputLen)
        ...localGet(L_i), ...localGet(L_inputLen), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // memory[inputLen + i] = memory[i]
        ...localGet(L_inputLen), ...localGet(L_i), wasm_module_builder_1.Op.i32_add, // dest addr
        ...localGet(L_i), wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00, // load src byte
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00, // store
        // i++
        ...localGet(L_i), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_i),
        // br $loop
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // return inputLen
        ...localGet(L_inputLen),
    ];
    return wasm_module_builder_1.WasmModuleBuilder.buildProcessModule([wasm_module_builder_1.Op.i32], [wasm_module_builder_1.Op.i32], [[1, wasm_module_builder_1.Op.i32]], // 1 local: i
    code);
}
// ═══════════════════════════════════════
// Double Bytes: multiply each byte by 2
// ═══════════════════════════════════════
function buildDoubleBytesModule() {
    // process(inputLen: i32) -> i32
    // Locals: i (i32)
    //
    // loop: memory[inputLen + i] = memory[i] * 2; i++; if i < inputLen, loop
    // return inputLen
    const L_inputLen = 0;
    const L_i = 1;
    const code = [
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(L_i), ...localGet(L_inputLen), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // dest = inputLen + i
        ...localGet(L_inputLen), ...localGet(L_i), wasm_module_builder_1.Op.i32_add,
        // value = memory[i] * 2
        ...localGet(L_i), wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(2), wasm_module_builder_1.Op.i32_mul,
        // store (truncated to byte by store8)
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(L_i), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_i),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L_inputLen),
    ];
    return wasm_module_builder_1.WasmModuleBuilder.buildProcessModule([wasm_module_builder_1.Op.i32], [wasm_module_builder_1.Op.i32], [[1, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// XOR Cipher: XOR each byte with key 0x42
// ═══════════════════════════════════════
function buildXorCipherModule(key = 0x42) {
    const L_inputLen = 0;
    const L_i = 1;
    const code = [
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(L_i), ...localGet(L_inputLen), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(L_inputLen), ...localGet(L_i), wasm_module_builder_1.Op.i32_add,
        ...localGet(L_i), wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(key), wasm_module_builder_1.Op.i32_xor,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(L_i), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_i),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L_inputLen),
    ];
    return wasm_module_builder_1.WasmModuleBuilder.buildProcessModule([wasm_module_builder_1.Op.i32], [wasm_module_builder_1.Op.i32], [[1, wasm_module_builder_1.Op.i32]], code);
}
// ═══════════════════════════════════════
// Threshold Filter: keep bytes > threshold
// ═══════════════════════════════════════
function buildThresholdFilterModule(threshold = 100) {
    // process(inputLen: i32) -> i32
    // Locals: i (i32), outIdx (i32)
    //
    // loop: if memory[i] > threshold: memory[inputLen + outIdx] = memory[i]; outIdx++
    // return outIdx
    const L_inputLen = 0;
    const L_i = 1;
    const L_outIdx = 2;
    const code = [
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(L_i), ...localGet(L_inputLen), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // if memory[i] > threshold
        ...localGet(L_i), wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...i32Const(threshold),
        wasm_module_builder_1.Op.i32_gt_u,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_,
        // memory[inputLen + outIdx] = memory[i]
        ...localGet(L_inputLen), ...localGet(L_outIdx), wasm_module_builder_1.Op.i32_add,
        ...localGet(L_i), wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        // outIdx++
        ...localGet(L_outIdx), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_outIdx),
        wasm_module_builder_1.Op.end,
        ...localGet(L_i), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_i),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L_outIdx),
    ];
    return wasm_module_builder_1.WasmModuleBuilder.buildProcessModule([wasm_module_builder_1.Op.i32], [wasm_module_builder_1.Op.i32], [[2, wasm_module_builder_1.Op.i32]], // 2 locals: i, outIdx
    code);
}
// ═══════════════════════════════════════
// Byte Sort: bubble sort (ascending)
// ═══════════════════════════════════════
function buildByteSortModule() {
    // process(inputLen: i32) -> i32
    // 1. Copy input to output area
    // 2. Bubble sort the output area in-place
    // return inputLen
    const L_inputLen = 0;
    const L_i = 1;
    const L_j = 2;
    const L_tmp = 3;
    const L_base = 4; // = inputLen (start of output area)
    const code = [
        // base = inputLen
        ...localGet(L_inputLen), ...localSet(L_base),
        // Copy input to output area
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(L_i), ...localGet(L_inputLen), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        ...localGet(L_base), ...localGet(L_i), wasm_module_builder_1.Op.i32_add,
        ...localGet(L_i), wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        ...localGet(L_i), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_i),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // Bubble sort: for i in 0..inputLen-1
        ...i32Const(0), ...localSet(L_i),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(L_i), ...localGet(L_inputLen), ...i32Const(1), wasm_module_builder_1.Op.i32_sub, wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // for j in 0..inputLen-1-i
        ...i32Const(0), ...localSet(L_j),
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(L_j),
        ...localGet(L_inputLen), ...i32Const(1), wasm_module_builder_1.Op.i32_sub, ...localGet(L_i), wasm_module_builder_1.Op.i32_sub,
        wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // if output[j] > output[j+1]: swap
        ...localGet(L_base), ...localGet(L_j), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...localGet(L_base), ...localGet(L_j), wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_gt_u,
        wasm_module_builder_1.Op.if_, wasm_module_builder_1.Op.void_,
        // tmp = output[j]
        ...localGet(L_base), ...localGet(L_j), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        ...localSet(L_tmp),
        // output[j] = output[j+1]
        ...localGet(L_base), ...localGet(L_j), wasm_module_builder_1.Op.i32_add,
        ...localGet(L_base), ...localGet(L_j), wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_add,
        wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        // output[j+1] = tmp
        ...localGet(L_base), ...localGet(L_j), wasm_module_builder_1.Op.i32_add, ...i32Const(1), wasm_module_builder_1.Op.i32_add,
        ...localGet(L_tmp),
        wasm_module_builder_1.Op.i32_store8, 0x00, 0x00,
        wasm_module_builder_1.Op.end,
        ...localGet(L_j), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_j),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L_i), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_i),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        ...localGet(L_inputLen),
    ];
    return wasm_module_builder_1.WasmModuleBuilder.buildProcessModule([wasm_module_builder_1.Op.i32], [wasm_module_builder_1.Op.i32], [[4, wasm_module_builder_1.Op.i32]], // 4 locals: i, j, tmp, base
    code);
}
// ═══════════════════════════════════════
// Sum Reduce: sum all bytes → 4-byte uint32
// ═══════════════════════════════════════
function buildSumReduceModule() {
    // process(inputLen: i32) -> i32
    // Locals: i, sum
    // loop: sum += memory[i]; i++
    // store sum as 4-byte LE at memory[inputLen]
    // return 4
    const L_inputLen = 0;
    const L_i = 1;
    const L_sum = 2;
    const code = [
        wasm_module_builder_1.Op.block, wasm_module_builder_1.Op.void_,
        wasm_module_builder_1.Op.loop, wasm_module_builder_1.Op.void_,
        ...localGet(L_i), ...localGet(L_inputLen), wasm_module_builder_1.Op.i32_ge_u, wasm_module_builder_1.Op.br_if, 0x01,
        // sum += memory[i]
        ...localGet(L_sum),
        ...localGet(L_i), wasm_module_builder_1.Op.i32_load8_u, 0x00, 0x00,
        wasm_module_builder_1.Op.i32_add,
        ...localSet(L_sum),
        ...localGet(L_i), ...i32Const(1), wasm_module_builder_1.Op.i32_add, ...localSet(L_i),
        wasm_module_builder_1.Op.br, 0x00,
        wasm_module_builder_1.Op.end,
        wasm_module_builder_1.Op.end,
        // Store sum at memory[inputLen] as i32
        ...localGet(L_inputLen),
        ...localGet(L_sum),
        wasm_module_builder_1.Op.i32_store, 0x02, 0x00, // alignment=4, offset=0
        // Return 4 (bytes written)
        ...i32Const(4),
    ];
    return wasm_module_builder_1.WasmModuleBuilder.buildProcessModule([wasm_module_builder_1.Op.i32], [wasm_module_builder_1.Op.i32], [[2, wasm_module_builder_1.Op.i32]], // 2 locals: i, sum
    code);
}
// ═══════════════════════════════════════
// Module Registry
// ═══════════════════════════════════════
const moduleBuilders = {
    identity: buildIdentityModule,
    double: buildDoubleBytesModule,
    xor: () => buildXorCipherModule(0x42),
    filter_gt100: () => buildThresholdFilterModule(100),
    filter_gt50: () => buildThresholdFilterModule(50),
    sort: buildByteSortModule,
    sum: buildSumReduceModule,
};
/** Cache of built modules */
const builtCache = new Map();
/**
 * Get a built-in WASM module by name.
 */
function getBuiltinWasmModule(name) {
    const cached = builtCache.get(name);
    if (cached)
        return cached;
    const builder = moduleBuilders[name];
    if (!builder)
        return null;
    const module = builder();
    builtCache.set(name, module);
    return module;
}
/**
 * Get all available built-in module names.
 */
function getBuiltinWasmModuleNames() {
    return Object.keys(moduleBuilders);
}
//# sourceMappingURL=builtin-wasm-modules.js.map