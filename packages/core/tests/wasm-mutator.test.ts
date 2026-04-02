/**
 * CMP v1.4 — Gap 3 Test Suite: Real WASM Execution + Mutation
 *
 * Run: npx ts-node --transpile-only packages/core/tests/wasm-mutator.test.ts
 *
 * @author Agent Viscro
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WasmMutator,
  instantiateGenome,
  executeWasmCause,
  defaultSpec,
} from '../src/lifeform/wasm-mutator';
import { hash32 } from '../src/lifeform/crypto';

describe('WASM — Create & Analyze', () => {
  it('should create a valid WASM binary', async () => {
    const m = new WasmMutator();
    const wasm = await m.createTestGenome(100, 0);

    assert.ok(wasm.length > 0);
    assert.equal(wasm[0], 0x00);
    assert.equal(wasm[1], 0x61);
    assert.equal(wasm[2], 0x73);
    assert.equal(wasm[3], 0x6d);
    assert.equal(await m.validate(wasm), true);
  });

  it('should analyze exported functions', async () => {
    const m = new WasmMutator();
    const wasm = await m.createTestGenome();
    const info = await m.analyze(wasm);

    assert.equal(info.valid, true);
    assert.ok(info.sizeBytes > 0);
    assert.ok(info.exportedFunctions.includes('onCause'));
    assert.ok(info.exportedFunctions.includes('getThreshold'));
    assert.ok(info.exportedFunctions.includes('getCounter'));
    assert.equal(info.hash.length, 32);
  });

  it('should produce different hashes for different params', async () => {
    const m = new WasmMutator();
    const w1 = await m.createTestGenome(100);
    const w2 = await m.createTestGenome(200);
    assert.notDeepEqual(hash32(w1), hash32(w2));
  });
});

describe('WASM — Execute', () => {
  it('should execute onCause and increment counter', async () => {
    const m = new WasmMutator();
    const wasm = await m.createTestGenome(100, 0);

    const { result, exports } = await executeWasmCause(wasm, 0);
    assert.equal(result, 1);
    assert.equal(exports.getCounter!(), 1);
    assert.equal(exports.getThreshold!(), 100);
  });

  it('should call multiple times', async () => {
    const m = new WasmMutator();
    const wasm = await m.createTestGenome(50, 10);
    const { exports } = await instantiateGenome(wasm);

    assert.equal(exports.getCounter!(), 10);
    assert.equal(exports.getThreshold!(), 50);

    exports.onCause!(0);
    exports.onCause!(0);
    exports.onCause!(0);
    assert.equal(exports.getCounter!(), 13);
  });

  it('should create independent instances from same binary', async () => {
    const m = new WasmMutator();
    const wasm = await m.createTestGenome(100, 0);

    const i1 = await instantiateGenome(wasm);
    const i2 = await instantiateGenome(wasm);

    i1.exports.onCause!(0);
    i1.exports.onCause!(0);
    i1.exports.onCause!(0);
    i2.exports.onCause!(0);

    assert.equal(i1.exports.getCounter!(), 3);
    assert.equal(i2.exports.getCounter!(), 1);
  });
});

describe('WASM — Mutate', () => {
  it('should mutate threshold', async () => {
    const m = new WasmMutator();
    const spec = defaultSpec();
    const original = await m.compile(spec);

    const { spec: mutSpec, wasm: mutated } = await m.mutateThreshold(spec, 999);

    const origE = (await instantiateGenome(original)).exports;
    const mutE = (await instantiateGenome(mutated)).exports;

    assert.equal(origE.getThreshold!(), 100);
    assert.equal(mutE.getThreshold!(), 999);
    assert.equal(mutSpec.generation, 1);
  });

  it('should mutate counter initial value', async () => {
    const m = new WasmMutator();
    const spec = defaultSpec();

    const { wasm } = await m.mutateCounter(spec, 500);
    const { exports } = await instantiateGenome(wasm);

    assert.equal(exports.getCounter!(), 500);
    exports.onCause!(0);
    assert.equal(exports.getCounter!(), 501);
  });

  it('should mutate increment amount', async () => {
    const m = new WasmMutator();
    const spec = defaultSpec();

    const { wasm } = await m.mutateIncrement(spec, 10);
    const { exports } = await instantiateGenome(wasm);

    exports.onCause!(0);
    assert.equal(exports.getCounter!(), 10);
    exports.onCause!(0);
    assert.equal(exports.getCounter!(), 20);
  });

  it('should produce valid WASM after mutation', async () => {
    const m = new WasmMutator();
    const { wasm } = await m.mutateThreshold(defaultSpec(), 42);
    assert.equal(await m.validate(wasm), true);
  });
});

describe('WASM — Add/Remove Functions', () => {
  it('should add a new function', async () => {
    const m = new WasmMutator();
    const spec = defaultSpec();

    const { spec: newSpec, wasm } = await m.addFunction(spec, 'doubleThreshold', 200);

    const { exports } = await instantiateGenome(wasm);
    assert.equal(exports.doubleThreshold(), 200);
    assert.ok(newSpec.extraFunctions.has('doubleThreshold'));

    const info = await m.analyze(wasm);
    assert.ok(info.exportedFunctions.includes('doubleThreshold'));
  });

  it('should remove an extra function', async () => {
    const m = new WasmMutator();
    const spec = defaultSpec();

    // Add first
    const { spec: withFunc } = await m.addFunction(spec, 'bonus', 42);
    assert.ok(withFunc.extraFunctions.has('bonus'));

    // Remove
    const result = await m.removeFunction(withFunc, 'bonus');
    assert.ok(result);
    assert.ok(!result.spec.extraFunctions.has('bonus'));

    const info = await m.analyze(result.wasm);
    assert.ok(!info.exportedFunctions.includes('bonus'));
    assert.ok(info.exportedFunctions.includes('onCause')); // Core functions intact
  });

  it('should return null when removing nonexistent function', async () => {
    const m = new WasmMutator();
    const result = await m.removeFunction(defaultSpec(), 'ghost');
    assert.equal(result, null);
  });
});

describe('WASM — Crossover', () => {
  it('should crossover two parent specs', async () => {
    const m = new WasmMutator();
    const specA: typeof defaultSpec extends () => infer R ? R : never = {
      ...defaultSpec(),
      threshold: 100,
      incrementBy: 1,
      extraFunctions: new Map([['funcA', 10]]),
    };
    const specB = {
      ...defaultSpec(),
      threshold: 200,
      incrementBy: 5,
      generation: 3,
      extraFunctions: new Map([['funcB', 20]]),
    };

    const { spec: child, wasm } = await m.crossover(specA, specB);

    assert.equal(child.generation, 4); // max(0,3) + 1
    assert.equal(await m.validate(wasm), true);

    // Child should have functions from both parents
    const { exports } = await instantiateGenome(wasm);
    assert.ok(exports.funcA || exports.funcB, 'Should have at least one parent function');

    // Threshold is from one parent
    const t = exports.getThreshold!();
    assert.ok(t === 100 || t === 200);
  });
});

describe('WASM — Optimize', () => {
  it('should optimize without breaking functionality', async () => {
    const m = new WasmMutator();
    const original = await m.createTestGenome(100, 0);
    const optimized = await m.optimize(original);

    assert.equal(await m.validate(optimized), true);
    const { exports } = await instantiateGenome(optimized);
    exports.onCause!(0);
    exports.onCause!(0);
    assert.equal(exports.getCounter!(), 2);
  });
});

describe('WASM — Evolution Simulation', () => {
  it('should simulate parent vs mutant competition', async () => {
    const m = new WasmMutator();
    const parentSpec = defaultSpec();
    const parentWasm = await m.compile(parentSpec);

    // Mutant: increment by 2 instead of 1 (processes faster)
    const { spec: mutantSpec, wasm: mutantWasm } = await m.mutateIncrement(parentSpec, 2);

    // Both valid
    assert.equal(await m.validate(parentWasm), true);
    assert.equal(await m.validate(mutantWasm), true);
    assert.notDeepEqual(hash32(parentWasm), hash32(mutantWasm));

    // Simulate 10 causes each
    const pInst = await instantiateGenome(parentWasm);
    const mInst = await instantiateGenome(mutantWasm);

    for (let i = 0; i < 10; i++) {
      pInst.exports.onCause!(0);
      mInst.exports.onCause!(0);
    }

    // Parent: counter = 10 (1 per cause)
    assert.equal(pInst.exports.getCounter!(), 10);
    // Mutant: counter = 20 (2 per cause) — "fitter"
    assert.equal(mInst.exports.getCounter!(), 20);
  });

  it('should simulate multi-generation evolution', async () => {
    const m = new WasmMutator();

    // Gen 0
    let spec = defaultSpec();
    let wasm = await m.compile(spec);
    let info = await m.analyze(wasm);
    assert.equal(info.valid, true);

    // Gen 1: mutate threshold
    const g1 = await m.mutateThreshold(spec, 75);
    spec = g1.spec; wasm = g1.wasm;
    assert.equal(spec.generation, 1);

    // Gen 2: mutate increment
    const g2 = await m.mutateIncrement(spec, 3);
    spec = g2.spec; wasm = g2.wasm;
    assert.equal(spec.generation, 2);

    // Gen 3: add a function
    const g3 = await m.addFunction(spec, 'version', 3);
    spec = g3.spec; wasm = g3.wasm;
    assert.equal(spec.generation, 3);

    // Verify final genome works
    const { exports } = await instantiateGenome(wasm);
    assert.equal(exports.getThreshold!(), 75);
    exports.onCause!(0);
    assert.equal(exports.getCounter!(), 3); // incrementBy=3
    assert.equal(exports.version(), 3);

    info = await m.analyze(wasm);
    assert.equal(info.valid, true);
    assert.ok(info.exportedFunctions.includes('version'));
  });
});
