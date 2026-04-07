"use strict";
/**
 * CMP v1.4 — WASM Genome Mutator
 * Real WASM binary creation, mutation, and execution using Binaryen.
 *
 * Architecture: Genomes are defined as GenomeSpec (parameters), then
 * compiled to WASM via Binaryen. Mutation = modify spec + recompile.
 * This avoids binaryen's limitations with round-tripping globals.
 *
 * @module lifeform/wasm-mutator
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WasmMutator = void 0;
exports.defaultSpec = defaultSpec;
exports.instantiateGenome = instantiateGenome;
exports.executeWasmCause = executeWasmCause;
const crypto_1 = require("./crypto");
// Binaryen is ESM-only
let binaryen = null;
async function loadBinaryen() {
    if (binaryen)
        return binaryen;
    const mod = await eval("import('binaryen')");
    binaryen = mod.default;
    return binaryen;
}
function defaultSpec() {
    return {
        threshold: 100,
        initialCounter: 0,
        incrementBy: 1,
        extraFunctions: new Map(),
        generation: 0,
        parentHash: null,
    };
}
// ═══════════════════════════════════════
// WASM Mutator
// ═══════════════════════════════════════
class WasmMutator {
    /**
     * Compile a GenomeSpec into a real WASM binary.
     */
    async compile(spec) {
        const b = await loadBinaryen();
        const mod = new b.Module();
        // Globals
        mod.addGlobal('counter', b.i32, true, mod.i32.const(spec.initialCounter));
        mod.addGlobal('threshold', b.i32, true, mod.i32.const(spec.threshold));
        // onCause(causeType: i32) -> i32: counter += incrementBy, return counter
        mod.addFunction('onCause', b.i32, b.i32, [], mod.block(null, [
            mod.global.set('counter', mod.i32.add(mod.global.get('counter', b.i32), mod.i32.const(spec.incrementBy))),
            mod.global.get('counter', b.i32),
        ], b.i32));
        mod.addFunctionExport('onCause', 'onCause');
        // getThreshold() -> i32
        mod.addFunction('getThreshold', b.none, b.i32, [], mod.global.get('threshold', b.i32));
        mod.addFunctionExport('getThreshold', 'getThreshold');
        // getCounter() -> i32
        mod.addFunction('getCounter', b.none, b.i32, [], mod.global.get('counter', b.i32));
        mod.addFunctionExport('getCounter', 'getCounter');
        // Extra functions (each returns an i32 constant)
        for (const [name, value] of spec.extraFunctions) {
            mod.addFunction(name, b.none, b.i32, [], mod.i32.const(value));
            mod.addFunctionExport(name, name);
        }
        if (!mod.validate()) {
            mod.dispose();
            throw new Error('Compiled genome is invalid WASM');
        }
        const bytes = new Uint8Array(mod.emitBinary());
        mod.dispose();
        return bytes;
    }
    /**
     * Shortcut: create a test genome with given params.
     */
    async createTestGenome(threshold = 100, initialCounter = 0) {
        return this.compile({ ...defaultSpec(), threshold, initialCounter });
    }
    /**
     * Analyze a WASM binary.
     */
    async analyze(wasmBytes) {
        const b = await loadBinaryen();
        let mod = null;
        try {
            mod = b.readBinary(wasmBytes);
            const exportedFunctions = [];
            const numExports = mod.getNumExports();
            for (let i = 0; i < numExports; i++) {
                const exp = mod.getExportByIndex(i);
                const info = b.getExportInfo(exp);
                exportedFunctions.push(info.name);
            }
            return {
                hash: (0, crypto_1.hash32)(wasmBytes),
                sizeBytes: wasmBytes.length,
                exportedFunctions,
                valid: !!mod.validate(),
            };
        }
        finally {
            if (mod)
                mod.dispose();
        }
    }
    /**
     * Validate a WASM binary.
     */
    async validate(wasmBytes) {
        const b = await loadBinaryen();
        let mod = null;
        try {
            mod = b.readBinary(wasmBytes);
            return !!mod.validate();
        }
        catch {
            return false;
        }
        finally {
            if (mod)
                mod.dispose();
        }
    }
    /**
     * Optimize a WASM binary.
     */
    async optimize(wasmBytes) {
        const b = await loadBinaryen();
        let mod = null;
        try {
            mod = b.readBinary(wasmBytes);
            mod.optimize();
            return new Uint8Array(mod.emitBinary());
        }
        finally {
            if (mod)
                mod.dispose();
        }
    }
    // ═══════════════════════════════════════
    // Mutations — modify spec and recompile
    // ═══════════════════════════════════════
    /**
     * Mutate threshold value.
     */
    async mutateThreshold(spec, newThreshold) {
        const mutant = {
            ...spec,
            threshold: newThreshold,
            generation: spec.generation + 1,
            parentHash: spec.parentHash,
            extraFunctions: new Map(spec.extraFunctions),
        };
        const wasm = await this.compile(mutant);
        mutant.parentHash = (0, crypto_1.hash32)(wasm);
        return { spec: mutant, wasm };
    }
    /**
     * Mutate initial counter value.
     */
    async mutateCounter(spec, newCounter) {
        const mutant = {
            ...spec,
            initialCounter: newCounter,
            generation: spec.generation + 1,
            extraFunctions: new Map(spec.extraFunctions),
        };
        const wasm = await this.compile(mutant);
        return { spec: mutant, wasm };
    }
    /**
     * Mutate increment amount.
     */
    async mutateIncrement(spec, newIncrement) {
        const mutant = {
            ...spec,
            incrementBy: newIncrement,
            generation: spec.generation + 1,
            extraFunctions: new Map(spec.extraFunctions),
        };
        const wasm = await this.compile(mutant);
        return { spec: mutant, wasm };
    }
    /**
     * Add a new exported function.
     */
    async addFunction(spec, name, returnValue) {
        const mutant = {
            ...spec,
            generation: spec.generation + 1,
            extraFunctions: new Map(spec.extraFunctions),
        };
        mutant.extraFunctions.set(name, returnValue);
        const wasm = await this.compile(mutant);
        return { spec: mutant, wasm };
    }
    /**
     * Remove an extra function.
     */
    async removeFunction(spec, name) {
        if (!spec.extraFunctions.has(name))
            return null;
        const mutant = {
            ...spec,
            generation: spec.generation + 1,
            extraFunctions: new Map(spec.extraFunctions),
        };
        mutant.extraFunctions.delete(name);
        const wasm = await this.compile(mutant);
        return { spec: mutant, wasm };
    }
    /**
     * Crossover: combine parameters from two parent specs.
     */
    async crossover(specA, specB) {
        const child = {
            // Take threshold from A, counter from B (or vice versa randomly)
            threshold: Math.random() < 0.5 ? specA.threshold : specB.threshold,
            initialCounter: Math.random() < 0.5 ? specA.initialCounter : specB.initialCounter,
            incrementBy: Math.random() < 0.5 ? specA.incrementBy : specB.incrementBy,
            extraFunctions: new Map(),
            generation: Math.max(specA.generation, specB.generation) + 1,
            parentHash: null,
        };
        // Merge extra functions from both parents
        for (const [name, val] of specA.extraFunctions)
            child.extraFunctions.set(name, val);
        for (const [name, val] of specB.extraFunctions)
            child.extraFunctions.set(name, val);
        const wasm = await this.compile(child);
        return { spec: child, wasm };
    }
    /**
     * Get binaryen for advanced operations.
     */
    async getBinaryen() {
        return loadBinaryen();
    }
}
exports.WasmMutator = WasmMutator;
/**
 * Instantiate a WASM binary.
 */
async function instantiateGenome(wasmBytes, imports) {
    const module = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(module, imports ?? {});
    return { instance, exports: instance.exports };
}
/**
 * Execute onCause on a WASM binary.
 */
async function executeWasmCause(wasmBytes, causeType) {
    const { exports } = await instantiateGenome(wasmBytes);
    if (!exports.onCause)
        throw new Error('No onCause export');
    const result = exports.onCause(causeType);
    return { result, exports };
}
//# sourceMappingURL=wasm-mutator.js.map