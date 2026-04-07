"use strict";
/**
 * CMP v4.0 — WASM Sandbox
 *
 * Instantiates and runs arbitrary .wasm modules using Node's
 * built-in WebAssembly API. No external runtime needed.
 *
 * CMP WASM Module Convention:
 *   1. Module exports "memory" (WebAssembly.Memory, min 1 page)
 *   2. Module exports "process" function
 *   3. Host writes input to memory[0..inputLen]
 *   4. Host calls process(inputLen) → outputLen
 *   5. WASM writes output to memory[inputLen..inputLen+outputLen]
 *   6. Host reads output from memory[inputLen] for outputLen bytes
 *
 * Fallback convention (for modules without "process"):
 *   - Host looks for the entryPoint function in exports
 *   - Falls back to calling with (ptr, len) → (ptr, len) convention
 *
 * @module wasm/wasm-sandbox
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WasmSandbox = exports.DEFAULT_SANDBOX_CONFIG = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('WasmSandbox');
exports.DEFAULT_SANDBOX_CONFIG = {
    maxMemoryPages: 256, // 16MB
    timeoutMs: 30000,
    enableWASI: false,
};
// ─── WASM Sandbox ───
class WasmSandbox {
    config;
    moduleCache = new Map();
    // Stats
    stats = {
        modulesCompiled: 0,
        executionsRun: 0,
        executionsFailed: 0,
        totalExecutionTimeMs: 0,
        cacheHits: 0,
    };
    constructor(config = {}) {
        this.config = { ...exports.DEFAULT_SANDBOX_CONFIG, ...config };
    }
    // ══════════════════════════════════════
    // Execute
    // ══════════════════════════════════════
    /**
     * Execute a WASM module with the CMP convention.
     *
     * @param wasmBinary - The .wasm module bytes
     * @param input - Input data to process
     * @param entryPoint - Function to call (default: "process")
     * @returns Execution result with output data
     */
    async execute(wasmBinary, input, entryPoint = 'process') {
        const startMs = performance.now();
        this.stats.executionsRun++;
        try {
            // Compile (or use cache)
            const { module, exports: exportNames } = await this.compileModule(wasmBinary);
            // Create memory (if module doesn't import/export its own)
            const memory = new WebAssembly.Memory({
                initial: Math.max(1, Math.ceil((input.length * 3) / 65536) + 1),
                maximum: this.config.maxMemoryPages,
            });
            // Build imports
            const imports = this.buildImports(memory);
            // Instantiate
            const instance = await WebAssembly.instantiate(module, imports);
            const wasmExports = instance.exports;
            // Get memory (prefer module's exported memory)
            const wasmMemory = wasmExports.memory ?? memory;
            const memView = new Uint8Array(wasmMemory.buffer);
            // Check if we need to grow memory
            const neededBytes = input.length * 3; // Input + space for output
            if (wasmMemory.buffer.byteLength < neededBytes) {
                const pagesToGrow = Math.ceil((neededBytes - wasmMemory.buffer.byteLength) / 65536);
                try {
                    wasmMemory.grow(pagesToGrow);
                }
                catch {
                    // Memory growth failed — proceed with what we have
                }
            }
            // Write input to memory[0..inputLen]
            const freshView = new Uint8Array(wasmMemory.buffer);
            freshView.set(input, 0);
            // Find and call the entry point
            const processFn = wasmExports[entryPoint];
            if (!processFn || typeof processFn !== 'function') {
                throw new Error(`Entry point "${entryPoint}" not found. Available: ${exportNames.join(', ')}`);
            }
            // Call with CMP convention: process(inputLen) → outputLen
            let outputLen;
            // Detect calling convention by function arity
            const arity = processFn.length;
            if (arity <= 1) {
                // CMP convention: process(inputLen) → outputLen
                outputLen = processFn(input.length);
            }
            else if (arity === 2) {
                // Alternative: process(inputPtr, inputLen) → outputLen
                // Input is at ptr=0
                outputLen = processFn(0, input.length);
            }
            else {
                // process(inputPtr, inputLen, outputPtr) → outputLen
                outputLen = processFn(0, input.length, input.length);
            }
            // Handle return value
            if (typeof outputLen !== 'number' || outputLen < 0) {
                outputLen = 0;
            }
            // Read output from memory[inputLen..inputLen+outputLen]
            const outputView = new Uint8Array(wasmMemory.buffer);
            const output = new Uint8Array(outputLen);
            output.set(outputView.slice(input.length, input.length + outputLen));
            const executionTimeMs = performance.now() - startMs;
            this.stats.totalExecutionTimeMs += executionTimeMs;
            return {
                output,
                executionTimeMs,
                memoryPagesUsed: Math.ceil(wasmMemory.buffer.byteLength / 65536),
                success: true,
                error: null,
                exports: exportNames,
            };
        }
        catch (err) {
            this.stats.executionsFailed++;
            const executionTimeMs = performance.now() - startMs;
            return {
                output: new Uint8Array(0),
                executionTimeMs,
                memoryPagesUsed: 0,
                success: false,
                error: err.message,
                exports: [],
            };
        }
    }
    // ══════════════════════════════════════
    // Compile
    // ══════════════════════════════════════
    /**
     * Compile a WASM module (with caching).
     */
    async compileModule(wasmBinary) {
        const hash = this.hashBinary(wasmBinary);
        // Check cache
        const cached = this.moduleCache.get(hash);
        if (cached) {
            this.stats.cacheHits++;
            return { module: cached.module, exports: cached.exports };
        }
        // Validate WASM magic
        if (wasmBinary.length < 8 ||
            wasmBinary[0] !== 0x00 || wasmBinary[1] !== 0x61 ||
            wasmBinary[2] !== 0x73 || wasmBinary[3] !== 0x6D) {
            throw new Error('Invalid WASM module: bad magic bytes');
        }
        // Compile
        const module = await WebAssembly.compile(wasmBinary);
        // Extract export names
        const exportDescs = WebAssembly.Module.exports(module);
        const exportNames = exportDescs.map(e => e.name);
        this.stats.modulesCompiled++;
        // Cache
        this.moduleCache.set(hash, {
            module,
            exports: exportNames,
            compiledAt: Date.now(),
            hash,
        });
        return { module, exports: exportNames };
    }
    /**
     * List exports of a WASM module without executing it.
     */
    async inspectExports(wasmBinary) {
        const { exports } = await this.compileModule(wasmBinary);
        return exports;
    }
    /**
     * Validate that a WASM binary is a valid module.
     */
    async validate(wasmBinary) {
        try {
            return WebAssembly.validate(wasmBinary);
        }
        catch {
            return false;
        }
    }
    // ══════════════════════════════════════
    // Imports
    // ══════════════════════════════════════
    buildImports(memory) {
        const imports = {
            env: {
                memory,
                abort: () => { throw new Error('WASM abort called'); },
            },
        };
        if (this.config.enableWASI) {
            imports.wasi_snapshot_preview1 = {
                fd_write: () => 0,
                fd_close: () => 0,
                fd_seek: () => 0,
                proc_exit: () => { },
                environ_get: () => 0,
                environ_sizes_get: () => 0,
                args_get: () => 0,
                args_sizes_get: () => 0,
                clock_time_get: () => 0,
            };
        }
        return imports;
    }
    // ══════════════════════════════════════
    // Stats
    // ══════════════════════════════════════
    getStats() {
        return {
            ...this.stats,
            avgExecutionTimeMs: this.stats.executionsRun > 0
                ? Math.round(this.stats.totalExecutionTimeMs / this.stats.executionsRun * 100) / 100
                : 0,
            cachedModules: this.moduleCache.size,
        };
    }
    /**
     * Clear the module cache.
     */
    clearCache() {
        this.moduleCache.clear();
    }
    // ─── Helpers ───
    hashBinary(data) {
        // FNV-1a hash
        let h = 0x811c9dc5;
        for (let i = 0; i < data.length; i++) {
            h ^= data[i];
            h = (h * 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
    }
}
exports.WasmSandbox = WasmSandbox;
//# sourceMappingURL=wasm-sandbox.js.map