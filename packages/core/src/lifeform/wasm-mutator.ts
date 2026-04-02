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

import { hash32 } from './crypto';

// Binaryen is ESM-only
let binaryen: any = null;
async function loadBinaryen(): Promise<any> {
  if (binaryen) return binaryen;
  const mod = await eval("import('binaryen')");
  binaryen = mod.default;
  return binaryen;
}

// ═══════════════════════════════════════
// Genome Spec — mutable definition
// ═══════════════════════════════════════

export interface GenomeSpec {
  /** Threshold parameter (used in onCause logic) */
  threshold: number;
  /** Initial counter value */
  initialCounter: number;
  /** Increment amount per cause (default: 1) */
  incrementBy: number;
  /** Extra exported functions: name → return value (i32 constants) */
  extraFunctions: Map<string, number>;
  /** Generation number */
  generation: number;
  /** Parent spec hash */
  parentHash: Uint8Array | null;
}

export function defaultSpec(): GenomeSpec {
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
// Genome Info
// ═══════════════════════════════════════

export interface WasmGenomeInfo {
  hash: Uint8Array;
  sizeBytes: number;
  exportedFunctions: string[];
  valid: boolean;
}

// ═══════════════════════════════════════
// WASM Mutator
// ═══════════════════════════════════════

export class WasmMutator {
  /**
   * Compile a GenomeSpec into a real WASM binary.
   */
  async compile(spec: GenomeSpec): Promise<Uint8Array> {
    const b = await loadBinaryen();
    const mod = new b.Module();

    // Globals
    mod.addGlobal('counter', b.i32, true, mod.i32.const(spec.initialCounter));
    mod.addGlobal('threshold', b.i32, true, mod.i32.const(spec.threshold));

    // onCause(causeType: i32) -> i32: counter += incrementBy, return counter
    mod.addFunction('onCause', b.i32, b.i32, [],
      mod.block(null, [
        mod.global.set('counter',
          mod.i32.add(mod.global.get('counter', b.i32), mod.i32.const(spec.incrementBy))
        ),
        mod.global.get('counter', b.i32),
      ], b.i32),
    );
    mod.addFunctionExport('onCause', 'onCause');

    // getThreshold() -> i32
    mod.addFunction('getThreshold', b.none, b.i32, [],
      mod.global.get('threshold', b.i32),
    );
    mod.addFunctionExport('getThreshold', 'getThreshold');

    // getCounter() -> i32
    mod.addFunction('getCounter', b.none, b.i32, [],
      mod.global.get('counter', b.i32),
    );
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
  async createTestGenome(threshold: number = 100, initialCounter: number = 0): Promise<Uint8Array> {
    return this.compile({ ...defaultSpec(), threshold, initialCounter });
  }

  /**
   * Analyze a WASM binary.
   */
  async analyze(wasmBytes: Uint8Array): Promise<WasmGenomeInfo> {
    const b = await loadBinaryen();
    let mod: any = null;
    try {
      mod = b.readBinary(wasmBytes);
      const exportedFunctions: string[] = [];
      const numExports = mod.getNumExports();
      for (let i = 0; i < numExports; i++) {
        const exp = mod.getExportByIndex(i);
        const info = b.getExportInfo(exp);
        exportedFunctions.push(info.name);
      }
      return {
        hash: hash32(wasmBytes),
        sizeBytes: wasmBytes.length,
        exportedFunctions,
        valid: !!mod.validate(),
      };
    } finally {
      if (mod) mod.dispose();
    }
  }

  /**
   * Validate a WASM binary.
   */
  async validate(wasmBytes: Uint8Array): Promise<boolean> {
    const b = await loadBinaryen();
    let mod: any = null;
    try {
      mod = b.readBinary(wasmBytes);
      return !!mod.validate();
    } catch {
      return false;
    } finally {
      if (mod) mod.dispose();
    }
  }

  /**
   * Optimize a WASM binary.
   */
  async optimize(wasmBytes: Uint8Array): Promise<Uint8Array> {
    const b = await loadBinaryen();
    let mod: any = null;
    try {
      mod = b.readBinary(wasmBytes);
      mod.optimize();
      return new Uint8Array(mod.emitBinary());
    } finally {
      if (mod) mod.dispose();
    }
  }

  // ═══════════════════════════════════════
  // Mutations — modify spec and recompile
  // ═══════════════════════════════════════

  /**
   * Mutate threshold value.
   */
  async mutateThreshold(spec: GenomeSpec, newThreshold: number): Promise<{ spec: GenomeSpec; wasm: Uint8Array }> {
    const mutant: GenomeSpec = {
      ...spec,
      threshold: newThreshold,
      generation: spec.generation + 1,
      parentHash: spec.parentHash,
      extraFunctions: new Map(spec.extraFunctions),
    };
    const wasm = await this.compile(mutant);
    mutant.parentHash = hash32(wasm);
    return { spec: mutant, wasm };
  }

  /**
   * Mutate initial counter value.
   */
  async mutateCounter(spec: GenomeSpec, newCounter: number): Promise<{ spec: GenomeSpec; wasm: Uint8Array }> {
    const mutant: GenomeSpec = {
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
  async mutateIncrement(spec: GenomeSpec, newIncrement: number): Promise<{ spec: GenomeSpec; wasm: Uint8Array }> {
    const mutant: GenomeSpec = {
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
  async addFunction(spec: GenomeSpec, name: string, returnValue: number): Promise<{ spec: GenomeSpec; wasm: Uint8Array }> {
    const mutant: GenomeSpec = {
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
  async removeFunction(spec: GenomeSpec, name: string): Promise<{ spec: GenomeSpec; wasm: Uint8Array } | null> {
    if (!spec.extraFunctions.has(name)) return null;
    const mutant: GenomeSpec = {
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
  async crossover(specA: GenomeSpec, specB: GenomeSpec): Promise<{ spec: GenomeSpec; wasm: Uint8Array }> {
    const child: GenomeSpec = {
      // Take threshold from A, counter from B (or vice versa randomly)
      threshold: Math.random() < 0.5 ? specA.threshold : specB.threshold,
      initialCounter: Math.random() < 0.5 ? specA.initialCounter : specB.initialCounter,
      incrementBy: Math.random() < 0.5 ? specA.incrementBy : specB.incrementBy,
      extraFunctions: new Map(),
      generation: Math.max(specA.generation, specB.generation) + 1,
      parentHash: null,
    };

    // Merge extra functions from both parents
    for (const [name, val] of specA.extraFunctions) child.extraFunctions.set(name, val);
    for (const [name, val] of specB.extraFunctions) child.extraFunctions.set(name, val);

    const wasm = await this.compile(child);
    return { spec: child, wasm };
  }

  /**
   * Get binaryen for advanced operations.
   */
  async getBinaryen(): Promise<any> {
    return loadBinaryen();
  }
}

// ═══════════════════════════════════════
// WASM Runtime
// ═══════════════════════════════════════

export interface WasmExports {
  onCause?: (causeType: number) => number;
  getThreshold?: () => number;
  getCounter?: () => number;
  [key: string]: any;
}

/**
 * Instantiate a WASM binary.
 */
export async function instantiateGenome(
  wasmBytes: Uint8Array,
  imports?: Record<string, Record<string, any>>,
): Promise<{ instance: WebAssembly.Instance; exports: WasmExports }> {
  const module = new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(module, imports ?? {});
  return { instance, exports: instance.exports as WasmExports };
}

/**
 * Execute onCause on a WASM binary.
 */
export async function executeWasmCause(
  wasmBytes: Uint8Array,
  causeType: number,
): Promise<{ result: number; exports: WasmExports }> {
  const { exports } = await instantiateGenome(wasmBytes);
  if (!exports.onCause) throw new Error('No onCause export');
  const result = exports.onCause(causeType);
  return { result, exports };
}
