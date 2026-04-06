#!/usr/bin/env npx tsx
/**
 * CMP v5.0 — WASM Adapter Test Suite
 *
 * Proves the adapter handles all WASM calling conventions:
 *   1. CMP Runtime — process(ptr, len) → outputLen (in-place)
 *   2. Allocator — malloc/free + process(ptr, len) → outputLen
 *   3. WASI Command — _start + fd_write to stdout
 *   4. Auto-detection — correct convention picked automatically
 *   5. Precompiled — .wasm files from packages/modules/dist/
 *
 * @author Agent Viscro
 */

import { WasmAdapter, WasmConvention } from '../src/wasm/wasm-adapter';
import { WasmModuleBuilder, Op, encodeSignedLEB128, encodeLEB128 } from '../src/wasm/wasm-module-builder';
import { buildGrayscaleModule } from '../src/wasm/heavy-workloads';
import { buildSensorFilter } from '../src/wasm/workload-modules';
import * as fs from 'fs';
import * as path from 'path';

const C = { r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };

let passed = 0, failed = 0;
const errors: string[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ${C.green}✓${C.r} ${name}`); }
  catch (err: any) { failed++; const msg = `  ${C.red}✗${C.r} ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}
function assert(c: boolean, m: string): void { if (!c) throw new Error(m); }

// ─── Helpers ───

function i32Const(v: number): number[] { return [Op.i32_const, ...encodeSignedLEB128(v)]; }
function localGet(i: number): number[] { return [Op.local_get, ...encodeLEB128(i)]; }
function localSet(i: number): number[] { return [Op.local_set, ...encodeLEB128(i)]; }

/**
 * Build a module with malloc/free exports to simulate compiled C code.
 * malloc returns a fixed offset (page 2). free is no-op.
 * process(ptr, len) doubles each byte in-place, returns len.
 *
 * NOTE: Do NOT include Op.end — the builder appends it automatically.
 */
function buildAllocatorModule(): Uint8Array {
  const builder = new WasmModuleBuilder();
  builder.setMemoryPages(4);

  // Type 0: (i32) → i32
  const t0 = builder.addType([Op.i32], [Op.i32]);
  // Type 1: (i32) → void
  const t1 = builder.addType([Op.i32], []);
  // Type 2: (i32, i32) → i32
  const t2 = builder.addType([Op.i32, Op.i32], [Op.i32]);

  // func 0: malloc(size) → ptr  (always returns 0x10000)
  builder.addFunction(t0, [], [
    ...i32Const(0x10000),
    // NO Op.end here — builder adds it
  ]);

  // func 1: free(ptr) → void (no-op)
  builder.addFunction(t1, [], [
    // empty body, builder adds Op.end
  ]);

  // func 2: process(ptr, len) → len
  // Doubles each byte at [ptr..ptr+len] in-place
  builder.addFunction(t2,
    [[1, 0x7f]], // 1 local i32 (index 2 = local 'i')
    [
      // i = 0
      ...i32Const(0),
      ...localSet(2),
      // loop
      Op.block, 0x40,
        Op.loop, 0x40,
          // if i >= len, break
          ...localGet(2),
          ...localGet(1),
          Op.i32_ge_u,
          Op.br_if, 1,
          // mem[ptr+i] = mem[ptr+i] * 2
          ...localGet(0), ...localGet(2), Op.i32_add,  // addr
          ...localGet(0), ...localGet(2), Op.i32_add,  // addr for load
          Op.i32_load8_u, 0, 0,
          ...i32Const(2),
          Op.i32_mul,
          Op.i32_store8, 0, 0,
          // i++
          ...localGet(2), ...i32Const(1), Op.i32_add, ...localSet(2),
          Op.br, 0,
        Op.end,
      Op.end,
      // return len
      ...localGet(1),
    ]
  );

  builder.addExport('memory', 2, 0);
  builder.addExport('malloc', 0, 0);
  builder.addExport('free', 0, 1);
  builder.addExport('process', 0, 2);

  return builder.build();
}

/**
 * Build a WASI command module using raw WASM bytes.
 * The builder doesn't support imports, so we handcraft the binary.
 *
 * This module:
 *   - imports wasi_snapshot_preview1.fd_write
 *   - exports memory and _start
 *   - _start writes "CMP" to stdout via fd_write
 */
function buildWASIModule(): Uint8Array {
  // Handcraft a minimal WASI WASM binary
  const enc = new TextEncoder();

  function leb(n: number): number[] {
    const out: number[] = [];
    do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; out.push(b); } while (n);
    return out;
  }
  function section(id: number, data: number[]): number[] {
    return [id, ...leb(data.length), ...data];
  }
  function str(s: string): number[] {
    const b = Array.from(enc.encode(s));
    return [...leb(b.length), ...b];
  }

  // Type section: type 0 = (i32,i32,i32,i32)->i32, type 1 = ()->()
  const types = [
    2, // 2 types
    0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,  // (i32,i32,i32,i32)->i32
    0x60, 0, 0,                                    // ()->()
  ];

  // Import section: import wasi_snapshot_preview1.fd_write as func type 0
  const importMod = str('wasi_snapshot_preview1');
  const importName = str('fd_write');
  const imports = [1, ...importMod, ...importName, 0x00, 0]; // kind=func, typeIdx=0

  // Function section: 1 function (type 1), index = 1 (after 1 import)
  const funcs = [1, 1]; // 1 func, type index 1

  // Memory section: 1 memory, min 1 page
  const memory = [1, 0x00, 1];

  // Export section: export memory and _start
  const exports_data = [
    2, // 2 exports
    ...str('memory'), 0x02, 0, // memory, index 0
    ...str('_start'), 0x00, 1, // func, index 1 (our _start)
  ];

  // Code section: _start function body
  // Writes "CMP" (3 bytes) at memory[100], builds iovec at [0], calls fd_write
  const body: number[] = [
    0, // 0 locals
    // mem[100] = 'C' (67). Values >63 need 2-byte signed LEB128
    0x41, 0xe4, 0x00,         // i32.const 100
    0x41, 0xc3, 0x00,         // i32.const 67  (0x43|0x80, 0x00)
    0x3a, 0x00, 0x00,         // i32.store8
    // mem[101] = 'M' (77)
    0x41, 0xe5, 0x00,         // i32.const 101
    0x41, 0xcd, 0x00,         // i32.const 77
    0x3a, 0x00, 0x00,
    // mem[102] = 'P' (80)
    0x41, 0xe6, 0x00,         // i32.const 102
    0x41, 0xd0, 0x00,         // i32.const 80
    0x3a, 0x00, 0x00,
    // iovec at [0]: ptr=100
    0x41, 0x00,          // i32.const 0
    0x41, 0xe4, 0x00,    // i32.const 100
    0x36, 0x02, 0x00,    // i32.store align=2 offset=0
    // iovec at [4]: len=3
    0x41, 0x04,          // i32.const 4
    0x41, 0x03,          // i32.const 3
    0x36, 0x02, 0x00,    // i32.store align=2 offset=0
    // fd_write(1, 0, 1, 80)
    0x41, 0x01,          // i32.const 1 (stdout)
    0x41, 0x00,          // i32.const 0 (iovs ptr)
    0x41, 0x01,          // i32.const 1 (iovs count)
    0x41, 0xd0, 0x00,    // i32.const 80 (nwritten ptr)
    0x10, 0x00,          // call 0 (fd_write)
    0x1a,                // drop
    0x0b,                // end
  ];
  const code = [1, ...leb(body.length), ...body]; // 1 function body

  const binary = [
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
    ...section(1, types),
    ...section(2, imports),
    ...section(3, funcs),
    ...section(5, memory),
    ...section(7, exports_data),
    ...section(10, code),
  ];

  return new Uint8Array(binary);
}

// ═══════════════════════════════════════
// TESTS
// ═══════════════════════════════════════

console.log('');
console.log(`${C.b}  CMP v5.0 — WASM Adapter Test Suite${C.r}`);
console.log('');

(async () => {
  const adapter = new WasmAdapter();

  // ── 1. Convention Detection ──

  await test('1. DETECT: CMP runtime module (sensor_filter)', async () => {
    const wasm = buildSensorFilter(128);
    const det = await adapter.detectConvention(wasm);
    assert(det.hasMemory, 'should have memory export');
    assert(det.exports.includes('process'), 'should have process export');
    assert(!det.hasMalloc, 'should NOT have malloc');
    assert(!det.hasWASI, 'should NOT have WASI imports');
  });

  await test('2. DETECT: allocator module (malloc/free)', async () => {
    const wasm = buildAllocatorModule();
    const det = await adapter.detectConvention(wasm);
    assert(det.hasMalloc, 'should have malloc');
    assert(det.exports.includes('free'), 'should have free');
    assert(det.convention === WasmConvention.ALLOCATOR,
      `convention should be ALLOCATOR, got ${det.convention}`);
  });

  await test('3. DETECT: WASI command module (_start)', async () => {
    const wasm = buildWASIModule();
    const det = await adapter.detectConvention(wasm);
    assert(det.hasWASI, 'should have WASI imports');
    assert(det.exports.includes('_start'), 'should have _start');
    assert(det.convention === WasmConvention.WASI_COMMAND,
      `convention should be WASI_COMMAND, got ${det.convention}`);
  });

  // ── 2. CMP Runtime Execution ──

  await test('4. EXEC: CMP runtime sensor_filter via adapter', async () => {
    const wasm = buildSensorFilter(128);
    const input = new Uint8Array([50, 200, 100, 150, 10, 255, 0, 180]);
    const result = await adapter.execute(wasm, input, 'process');
    assert(result.success, `failed: ${result.error}`);
    const expected = input.filter(b => b > 128);
    assert(result.output.length === expected.length,
      `len ${result.output.length} !== ${expected.length}`);
    for (let i = 0; i < expected.length; i++) {
      assert(result.output[i] === expected[i],
        `byte ${i}: ${result.output[i]} !== ${expected[i]}`);
    }
  });

  await test('5. EXEC: CMP runtime grayscale via adapter', async () => {
    const wasm = buildGrayscaleModule();
    const input = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const result = await adapter.execute(wasm, input, 'process');
    assert(result.success, `failed: ${result.error}`);
    assert(result.output.length === 2, `expected 2 bytes, got ${result.output.length}`);
    const g0 = Math.floor(0.299 * 255);
    const g1 = Math.floor(0.587 * 255);
    assert(result.output[0] === g0, `px0: ${result.output[0]} !== ${g0}`);
    assert(result.output[1] === g1, `px1: ${result.output[1]} !== ${g1}`);
  });

  // ── 3. Allocator Convention ──

  await test('6. EXEC: allocator module (malloc/free + double bytes)', async () => {
    const wasm = buildAllocatorModule();
    const input = new Uint8Array([10, 20, 30, 40, 50]);
    const result = await adapter.execute(wasm, input, 'process');
    assert(result.success, `failed: ${result.error}`);
    assert(result.convention === WasmConvention.ALLOCATOR, `conv: ${result.convention}`);
    assert(result.output.length === input.length, `len: ${result.output.length}`);
    for (let i = 0; i < input.length; i++) {
      assert(result.output[i] === input[i] * 2,
        `byte ${i}: ${result.output[i]} !== ${input[i] * 2}`);
    }
  });

  // ── 4. WASI Convention ──

  await test('7. EXEC: WASI command module captures stdout', async () => {
    const wasm = buildWASIModule();
    const result = await adapter.execute(wasm, new Uint8Array(0));
    assert(result.success, `failed: ${result.error}`);
    assert(result.convention === WasmConvention.WASI_COMMAND, `conv: ${result.convention}`);
    const text = new TextDecoder().decode(result.output);
    assert(text === 'CMP', `stdout: "${text}", expected "CMP"`);
  });

  // ── 5. Large Data ──

  await test('8. EXEC: large input (100KB) filter through adapter', async () => {
    const wasm = buildSensorFilter(128);
    const input = new Uint8Array(100 * 1024);
    for (let i = 0; i < input.length; i++) input[i] = i % 256;
    const result = await adapter.execute(wasm, input, 'process');
    assert(result.success, `failed: ${result.error}`);
    const expected = Array.from(input).filter(b => b > 128);
    assert(result.output.length === expected.length,
      `len ${result.output.length} !== ${expected.length}`);
  });

  // ── 6. Precompiled WASM from packages/modules/dist/ ──

  await test('9. PRECOMPILED: grayscale.wasm from dist/', async () => {
    const wasmPath = path.join(__dirname, '../../modules/dist/grayscale.wasm');
    if (!fs.existsSync(wasmPath)) {
      // Skip if not available
      console.log(`    ${C.d}(skipped — file not found: ${wasmPath})${C.r}`);
      return;
    }
    const wasm = new Uint8Array(fs.readFileSync(wasmPath));
    const det = await adapter.detectConvention(wasm);
    assert(det.hasMemory, 'should have memory');
    assert(det.exports.includes('process'), 'should have process');
    // This module uses AssemblyScript convention with __new/__pin
    console.log(`    ${C.d}Convention: ${det.convention}, exports: ${det.exports.join(', ')}${C.r}`);
    // Execute: 2 pixels RGB
    const input = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const result = await adapter.execute(wasm, input, 'process');
    assert(result.success, `failed: ${result.error}`);
    assert(result.output.length > 0, 'should produce output');
  });

  await test('10. PRECOMPILED: detect conventions of all dist/ modules', async () => {
    const distDir = path.join(__dirname, '../../modules/dist');
    if (!fs.existsSync(distDir)) { return; }
    const files = fs.readdirSync(distDir).filter(f => f.endsWith('.wasm'));
    assert(files.length > 0, 'should find .wasm files');
    for (const file of files) {
      const wasm = new Uint8Array(fs.readFileSync(path.join(distDir, file)));
      const det = await adapter.detectConvention(wasm);
      console.log(`    ${C.d}${file}: ${det.convention} (${det.exports.length} exports)${C.r}`);
    }
  });

  // ── 7. Error Handling ──

  await test('11. ERROR: invalid WASM binary', async () => {
    const result = await adapter.execute(new Uint8Array([0, 0, 0, 0]), new Uint8Array(0));
    assert(!result.success, 'should fail');
    assert(result.error !== null, 'should have error');
  });

  await test('12. ERROR: missing entry point', async () => {
    const wasm = buildSensorFilter(128);
    const result = await adapter.execute(wasm, new Uint8Array([1, 2, 3]), 'nonexistent');
    assert(!result.success, 'should fail');
  });

  // ── 8. Pipeline through adapter ──

  await test('13. PIPELINE: filter → grayscale chained via adapter', async () => {
    const filterWasm = buildSensorFilter(50);
    const input = new Uint8Array([10, 200, 30, 150, 80, 255, 40, 100, 60, 180]);
    const step1 = await adapter.execute(filterWasm, input, 'process');
    assert(step1.success, `filter failed: ${step1.error}`);
    assert(step1.output.length > 0, 'filter should produce output');

    const grayWasm = buildGrayscaleModule();
    const rgbInput = new Uint8Array(Math.floor(step1.output.length / 3) * 3);
    rgbInput.set(step1.output.slice(0, rgbInput.length));
    if (rgbInput.length >= 3) {
      const step2 = await adapter.execute(grayWasm, rgbInput, 'process');
      assert(step2.success, `grayscale failed: ${step2.error}`);
      assert(step2.output.length === rgbInput.length / 3,
        `gray output ${step2.output.length} !== ${rgbInput.length / 3}`);
    }
  });

  // ── 9. Stats ──

  await test('14. STATS: tracks convention breakdown', async () => {
    const stats = adapter.getStats();
    assert(stats.executions > 0, 'should have executions');
    const convKeys = Object.keys(stats.byConvention);
    assert(convKeys.length > 0, 'should have convention stats');
    console.log(`    ${C.d}Executions: ${stats.executions}, conventions: ${JSON.stringify(stats.byConvention)}${C.r}`);
  });

  // ── 10. Forced Convention ──

  await test('15. FORCED: override convention detection', async () => {
    const forced = new WasmAdapter({ forceConvention: WasmConvention.CMP_RUNTIME });
    const wasm = buildSensorFilter(128);
    const input = new Uint8Array([50, 200, 100, 150, 10, 255]);
    const result = await forced.execute(wasm, input, 'process');
    assert(result.success, `failed: ${result.error}`);
  });

  // ── Results ──

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log(`  ${C.b}WASM Adapter${C.r}`);
  console.log(`  ${C.b}Results: ${passed} passed, ${failed} failed${C.r}`);
  console.log('══════════════════════════════════════════════════');
  if (errors.length) { console.log(''); errors.forEach(e => console.log(e)); }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
})();
