"use strict";
/**
 * CMP v5.0 — WASM Adapter
 *
 * Bridges the gap between CMP's native WASM convention and
 * modules compiled from C/Rust using wasi-sdk or Emscripten.
 *
 * CMP Native Convention:
 *   export memory, export process(len) → outputLen
 *   Input at memory[0..len], output at memory[len..len+outputLen]
 *
 * Compiled WASM (wasi-sdk / Emscripten) conventions:
 *   1. WASI modules: export _start or _initialize, use fd_write/fd_read
 *   2. Allocator modules: export malloc/free, process(ptr, len) → ptr
 *   3. In-place modules: export process(ptr, len) → len (write in-place)
 *   4. Reactor modules: export _initialize + custom exports
 *
 * This adapter auto-detects which convention a module uses and wraps
 * it into CMP's unified execute(wasmBinary, input) → output API.
 *
 * @module wasm/wasm-adapter
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WasmAdapter = exports.WasmConvention = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('WasmAdapter');
// ─── Module Convention ───
var WasmConvention;
(function (WasmConvention) {
    /** CMP native: process(len) → outputLen, I/O at memory[0] */
    WasmConvention["CMP_NATIVE"] = "cmp-native";
    /** process(ptr, len) → outputLen, output at memory[ptr+inputLen] */
    WasmConvention["CMP_RUNTIME"] = "cmp-runtime";
    /** Has malloc/free: allocate input, call process(ptr, len) → result_ptr */
    WasmConvention["ALLOCATOR"] = "allocator";
    /** WASI command module: has _start, uses WASI fd_write for output */
    WasmConvention["WASI_COMMAND"] = "wasi-command";
    /** WASI reactor: has _initialize + custom exports */
    WasmConvention["WASI_REACTOR"] = "wasi-reactor";
    /** Unknown — try best-effort execution */
    WasmConvention["UNKNOWN"] = "unknown";
})(WasmConvention || (exports.WasmConvention = WasmConvention = {}));
const DEFAULT_CONFIG = {
    maxMemoryPages: 256,
    timeoutMs: 30000,
};
// ─── WASI Capture ───
class WASICapture {
    stdout = [];
    stderr = [];
    exitCode = null;
    memory = null;
    setMemory(mem) {
        this.memory = mem;
    }
    getImports() {
        return {
            fd_write: (fd, iovs, iovsLen, nwritten) => {
                if (!this.memory)
                    return -1;
                const view = new DataView(this.memory.buffer);
                const u8 = new Uint8Array(this.memory.buffer);
                let totalWritten = 0;
                for (let i = 0; i < iovsLen; i++) {
                    const ptr = view.getUint32(iovs + i * 8, true);
                    const len = view.getUint32(iovs + i * 8 + 4, true);
                    const chunk = u8.slice(ptr, ptr + len);
                    if (fd === 1)
                        this.stdout.push(new Uint8Array(chunk));
                    else if (fd === 2)
                        this.stderr.push(new Uint8Array(chunk));
                    totalWritten += len;
                }
                view.setUint32(nwritten, totalWritten, true);
                return 0;
            },
            fd_close: () => 0,
            fd_seek: () => -1,
            fd_read: () => 0,
            fd_fdstat_get: () => 0,
            fd_prestat_get: () => 8, // EBADF
            fd_prestat_dir_name: () => 8,
            proc_exit: (code) => { this.exitCode = code; },
            environ_get: () => 0,
            environ_sizes_get: (countPtr, sizePtr) => {
                if (!this.memory)
                    return -1;
                const view = new DataView(this.memory.buffer);
                view.setUint32(countPtr, 0, true);
                view.setUint32(sizePtr, 0, true);
                return 0;
            },
            args_get: () => 0,
            args_sizes_get: (countPtr, sizePtr) => {
                if (!this.memory)
                    return -1;
                const view = new DataView(this.memory.buffer);
                view.setUint32(countPtr, 0, true);
                view.setUint32(sizePtr, 0, true);
                return 0;
            },
            clock_time_get: (_id, _precision, outPtr) => {
                if (!this.memory)
                    return -1;
                const view = new DataView(this.memory.buffer);
                view.setBigUint64(outPtr, BigInt(Date.now()) * 1000000n, true);
                return 0;
            },
            random_get: (bufPtr, bufLen) => {
                if (!this.memory)
                    return -1;
                const u8 = new Uint8Array(this.memory.buffer);
                for (let i = 0; i < bufLen; i++)
                    u8[bufPtr + i] = Math.floor(Math.random() * 256);
                return 0;
            },
            sched_yield: () => 0,
            path_open: () => 44, // ENOSYS
        };
    }
    getStdout() {
        const totalLen = this.stdout.reduce((s, c) => s + c.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of this.stdout) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }
}
// ═══════════════════════════════════════
// WASM Adapter
// ═══════════════════════════════════════
class WasmAdapter {
    config;
    stats = {
        executions: 0,
        byConvention: new Map(),
    };
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Detect the calling convention of a compiled WASM module.
     */
    async detectConvention(wasmBinary) {
        const module = await WebAssembly.compile(wasmBinary);
        const exportDescs = WebAssembly.Module.exports(module);
        const exportNames = exportDescs.map((e) => e.name);
        const importDescs = WebAssembly.Module.imports(module);
        const importModules = [...new Set(importDescs.map((i) => i.module))];
        const hasMemory = exportNames.includes('memory');
        const hasMalloc = exportNames.includes('malloc') && exportNames.includes('free');
        const hasStart = exportNames.includes('_start');
        const hasInitialize = exportNames.includes('_initialize');
        const hasWASI = importModules.includes('wasi_snapshot_preview1') || importModules.includes('wasi_unstable');
        const hasProcess = exportNames.includes('process');
        const entryPoint = this.config.entryPoint || 'process';
        const hasEntry = exportNames.includes(entryPoint);
        let convention;
        if (this.config.forceConvention) {
            convention = this.config.forceConvention;
        }
        else if (hasProcess && hasMemory && !hasMalloc && !hasWASI) {
            // Check arity by inspecting the function type
            // If it takes 1 arg → CMP_NATIVE, 2 args → CMP_RUNTIME
            convention = WasmConvention.CMP_NATIVE; // Will refine during execution
        }
        else if (hasMalloc && hasEntry) {
            convention = WasmConvention.ALLOCATOR;
        }
        else if (hasWASI && hasStart) {
            convention = WasmConvention.WASI_COMMAND;
        }
        else if (hasWASI && hasInitialize) {
            convention = WasmConvention.WASI_REACTOR;
        }
        else if (hasEntry && hasMemory) {
            convention = WasmConvention.CMP_RUNTIME;
        }
        else {
            convention = WasmConvention.UNKNOWN;
        }
        return { convention, exports: exportNames, hasMemory, hasMalloc, hasWASI };
    }
    /**
     * Execute a WASM module with automatic convention detection.
     * This is the unified API — pass any WASM binary and input,
     * get output back regardless of how it was compiled.
     */
    async execute(wasmBinary, input, entryPoint) {
        const startMs = performance.now();
        this.stats.executions++;
        try {
            const ep = entryPoint || this.config.entryPoint || 'process';
            const detection = await this.detectConvention(wasmBinary);
            let convention = detection.convention;
            // Refine CMP_NATIVE vs CMP_RUNTIME by trying execution
            if (convention === WasmConvention.CMP_NATIVE) {
                convention = detection.exports.includes(ep)
                    ? WasmConvention.CMP_RUNTIME
                    : WasmConvention.CMP_NATIVE;
            }
            const count = this.stats.byConvention.get(convention) || 0;
            this.stats.byConvention.set(convention, count + 1);
            let result;
            switch (convention) {
                case WasmConvention.CMP_NATIVE:
                    result = await this.executeCMPNative(wasmBinary, input, ep);
                    break;
                case WasmConvention.CMP_RUNTIME:
                    result = await this.executeCMPRuntime(wasmBinary, input, ep);
                    break;
                case WasmConvention.ALLOCATOR:
                    result = await this.executeAllocator(wasmBinary, input, ep);
                    break;
                case WasmConvention.WASI_COMMAND:
                    result = await this.executeWASICommand(wasmBinary, input);
                    break;
                case WasmConvention.WASI_REACTOR:
                    result = await this.executeWASIReactor(wasmBinary, input, ep);
                    break;
                default:
                    // Best-effort: try CMP_RUNTIME first, fall back to CMP_NATIVE
                    try {
                        result = await this.executeCMPRuntime(wasmBinary, input, ep);
                        convention = WasmConvention.CMP_RUNTIME;
                    }
                    catch {
                        result = await this.executeCMPNative(wasmBinary, input, ep);
                        convention = WasmConvention.CMP_NATIVE;
                    }
            }
            return {
                output: result.output,
                convention,
                executionTimeMs: performance.now() - startMs,
                success: true,
                error: null,
                exports: detection.exports,
                memoryUsedBytes: result.memoryUsed,
            };
        }
        catch (err) {
            return {
                output: new Uint8Array(0),
                convention: WasmConvention.UNKNOWN,
                executionTimeMs: performance.now() - startMs,
                success: false,
                error: err.message,
                exports: [],
                memoryUsedBytes: 0,
            };
        }
    }
    // ── CMP Native: process(inputLen) → outputLen ──
    async executeCMPNative(wasmBinary, input, entryPoint) {
        const module = await WebAssembly.compile(wasmBinary);
        const memory = new WebAssembly.Memory({
            initial: Math.max(1, Math.ceil((input.length * 3) / 65536) + 1),
            maximum: this.config.maxMemoryPages,
        });
        const instance = await WebAssembly.instantiate(module, {
            env: { memory, abort: () => { throw new Error('abort'); } },
        });
        const wasmMemory = instance.exports.memory ?? memory;
        const view = new Uint8Array(wasmMemory.buffer);
        view.set(input, 0);
        const fn = instance.exports[entryPoint];
        if (!fn)
            throw new Error(`Export "${entryPoint}" not found`);
        const outputLen = fn(input.length);
        const output = new Uint8Array(wasmMemory.buffer).slice(input.length, input.length + outputLen);
        return { output: new Uint8Array(output), memoryUsed: wasmMemory.buffer.byteLength };
    }
    // ── CMP Runtime: process(ptr, len) → outputLen ──
    async executeCMPRuntime(wasmBinary, input, entryPoint) {
        const module = await WebAssembly.compile(wasmBinary);
        const memory = new WebAssembly.Memory({
            initial: Math.max(1, Math.ceil((input.length * 3) / 65536) + 1),
            maximum: this.config.maxMemoryPages,
        });
        const instance = await WebAssembly.instantiate(module, {
            env: { memory, abort: () => { throw new Error('abort'); } },
        });
        const wasmMemory = instance.exports.memory ?? memory;
        let view = new Uint8Array(wasmMemory.buffer);
        // Grow if needed
        const neededBytes = input.length * 3;
        if (wasmMemory.buffer.byteLength < neededBytes) {
            const pages = Math.ceil((neededBytes - wasmMemory.buffer.byteLength) / 65536);
            try {
                wasmMemory.grow(pages);
            }
            catch { /* proceed with current */ }
        }
        view = new Uint8Array(wasmMemory.buffer);
        view.set(input, 0);
        const fn = instance.exports[entryPoint];
        if (!fn)
            throw new Error(`Export "${entryPoint}" not found`);
        const outputLen = fn(0, input.length);
        const outView = new Uint8Array(wasmMemory.buffer);
        // Output is written in-place at ptr (0), so read from 0
        const output = outView.slice(0, outputLen);
        return { output: new Uint8Array(output), memoryUsed: wasmMemory.buffer.byteLength };
    }
    // ── Allocator: malloc/free based ──
    async executeAllocator(wasmBinary, input, entryPoint) {
        const module = await WebAssembly.compile(wasmBinary);
        const instance = await WebAssembly.instantiate(module, {
            env: { abort: () => { throw new Error('abort'); } },
            wasi_snapshot_preview1: new WASICapture().getImports(),
        });
        const exports = instance.exports;
        const wasmMemory = exports.memory;
        const malloc = exports.malloc;
        const free = exports.free;
        const fn = exports[entryPoint];
        if (!malloc || !free)
            throw new Error('malloc/free not found');
        if (!fn)
            throw new Error(`Export "${entryPoint}" not found`);
        // Allocate input buffer
        const inputPtr = malloc(input.length);
        const view = new Uint8Array(wasmMemory.buffer);
        view.set(input, inputPtr);
        // Call: process(ptr, len) → result
        // Result could be: outputLen (data written in-place) or outputPtr (pointer to result)
        const result = fn(inputPtr, input.length);
        let output;
        if (result <= input.length * 2 && result >= 0) {
            // Likely an output length — read from input ptr
            output = new Uint8Array(wasmMemory.buffer).slice(inputPtr, inputPtr + result);
        }
        else {
            // Likely a pointer to result struct/buffer
            // Try to read a length prefix (common pattern: [u32 len][data...])
            const dv = new DataView(wasmMemory.buffer);
            const outLen = dv.getUint32(result, true);
            if (outLen > 0 && outLen < wasmMemory.buffer.byteLength) {
                output = new Uint8Array(wasmMemory.buffer).slice(result + 4, result + 4 + outLen);
            }
            else {
                // Fall back: read up to input length from result ptr
                output = new Uint8Array(wasmMemory.buffer).slice(result, result + input.length);
            }
        }
        free(inputPtr);
        return { output: new Uint8Array(output), memoryUsed: wasmMemory.buffer.byteLength };
    }
    // ── WASI Command: _start, fd_write to stdout ──
    async executeWASICommand(wasmBinary, input) {
        const module = await WebAssembly.compile(wasmBinary);
        const wasi = new WASICapture();
        const memory = new WebAssembly.Memory({
            initial: Math.max(1, Math.ceil(input.length / 65536) + 2),
            maximum: this.config.maxMemoryPages,
        });
        const instance = await WebAssembly.instantiate(module, {
            wasi_snapshot_preview1: wasi.getImports(),
            env: { memory },
        });
        const wasmMemory = instance.exports.memory ?? memory;
        wasi.setMemory(wasmMemory);
        // Write input to stdin area (convention: first 64KB is stdin buffer)
        const view = new Uint8Array(wasmMemory.buffer);
        view.set(input, 0);
        // Call _start
        const start = instance.exports._start;
        if (start) {
            try {
                start();
            }
            catch (e) {
                if (wasi.exitCode !== 0 && wasi.exitCode !== null) {
                    throw new Error(`WASI exit code: ${wasi.exitCode}`);
                }
            }
        }
        return { output: wasi.getStdout(), memoryUsed: wasmMemory.buffer.byteLength };
    }
    // ── WASI Reactor: _initialize + custom exports ──
    async executeWASIReactor(wasmBinary, input, entryPoint) {
        const module = await WebAssembly.compile(wasmBinary);
        const wasi = new WASICapture();
        const instance = await WebAssembly.instantiate(module, {
            wasi_snapshot_preview1: wasi.getImports(),
            env: { abort: () => { throw new Error('abort'); } },
        });
        const wasmMemory = instance.exports.memory;
        wasi.setMemory(wasmMemory);
        // Initialize
        const init = instance.exports._initialize;
        if (init)
            init();
        // Now call the entry point like a regular function
        const fn = instance.exports[entryPoint];
        if (!fn)
            throw new Error(`Export "${entryPoint}" not found in WASI reactor`);
        // Check if module has malloc
        const malloc = instance.exports.malloc;
        if (malloc) {
            const inputPtr = malloc(input.length);
            new Uint8Array(wasmMemory.buffer).set(input, inputPtr);
            const outputLen = fn(inputPtr, input.length);
            const output = new Uint8Array(wasmMemory.buffer).slice(inputPtr, inputPtr + outputLen);
            return { output: new Uint8Array(output), memoryUsed: wasmMemory.buffer.byteLength };
        }
        // No malloc — use CMP runtime convention
        const view = new Uint8Array(wasmMemory.buffer);
        view.set(input, 0);
        const outputLen = fn(0, input.length);
        const output = new Uint8Array(wasmMemory.buffer).slice(0, outputLen);
        return { output: new Uint8Array(output), memoryUsed: wasmMemory.buffer.byteLength };
    }
    // ── Stats ──
    getStats() {
        const conv = {};
        for (const [k, v] of this.stats.byConvention)
            conv[k] = v;
        return { executions: this.stats.executions, byConvention: conv };
    }
}
exports.WasmAdapter = WasmAdapter;
//# sourceMappingURL=wasm-adapter.js.map