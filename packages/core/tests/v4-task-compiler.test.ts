/**
 * CMP v4.0 — Phase 4: Universal Task Compiler Tests
 *
 * 40 tests covering:
 *   - Pattern detection from WASM exports and entry point names
 *   - Data decomposition (chunking) for each pattern
 *   - Merge strategies (merge-sort, concatenate, filter, search, gradient avg)
 *   - Plan generation (chunk count, device assignment, fallback)
 *   - Task compiler end-to-end (compile + merge)
 *   - WASM export parsing
 *   - Edge cases (tiny input, no devices, unknown pattern)
 *
 * Run: npx tsx packages/core/tests/v4-task-compiler.test.ts
 *
 * @author Agent Viscro
 */

import {
  ParallelPattern, PatternMatch, CompilationPlan,
  MergeType, TaskMeta, DataChunk,
} from '../src/compiler/compiler-types';

import { SortPattern, MapPattern, ReducePattern, FilterPattern, SearchPattern } from '../src/compiler/patterns/data-patterns';
import { MatrixPattern, MLTrainPattern, GenericPattern } from '../src/compiler/patterns/compute-patterns';
import { PatternDetector, parseWasmExports, PatternRegistry } from '../src/compiler/pattern-detector';
import { PlanGenerator } from '../src/compiler/plan-generator';
import { TaskCompiler } from '../src/compiler/task-compiler';

// ─── Test Runner ───

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (err: any) { failed++; const msg = `  \x1b[31m✗\x1b[0m ${name}: ${err.message}`; console.log(msg); errors.push(msg); }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual: any, expected: any, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

// ─── Test WASM Module Builder ───

// Build a minimal valid WASM module with custom exports
function buildWasmWithExports(exportNames: string[]): Uint8Array {
  const magic = [0x00, 0x61, 0x73, 0x6D]; // \0asm
  const version = [0x01, 0x00, 0x00, 0x00]; // v1

  // Type section: one function type () -> ()
  const typeSection = [
    0x01,       // section id: type
    0x04,       // section size
    0x01,       // 1 type
    0x60,       // func
    0x00,       // 0 params
    0x00,       // 0 results
  ];

  // Function section: N functions, all type 0
  const funcSection = [
    0x03,                    // section id: function
    exportNames.length + 1,  // section size
    exportNames.length,      // N functions
    ...new Array(exportNames.length).fill(0x00), // all type 0
  ];

  // Export section
  const exportEntries: number[] = [];
  for (let i = 0; i < exportNames.length; i++) {
    const nameBytes = new TextEncoder().encode(exportNames[i]);
    exportEntries.push(nameBytes.length); // name length
    exportEntries.push(...nameBytes);     // name bytes
    exportEntries.push(0x00);             // kind: function
    exportEntries.push(i);               // function index
  }

  // Also export memory
  const memName = new TextEncoder().encode('memory');
  exportEntries.push(memName.length, ...memName, 0x02, 0x00); // memory export

  const exportSection = [
    0x07,                          // section id: export
    exportEntries.length + 1,      // section size (+1 for count)
    exportNames.length + 1,        // export count (funcs + memory)
    ...exportEntries,
  ];

  // Code section: N empty functions
  const codeBody = [0x00, 0x0B]; // empty body: 0 locals, end
  const codeBodies: number[] = [];
  for (let i = 0; i < exportNames.length; i++) {
    codeBodies.push(codeBody.length, ...codeBody);
  }
  const codeSection = [
    0x0A,                      // section id: code
    codeBodies.length + 1,     // section size
    exportNames.length,        // N function bodies
    ...codeBodies,
  ];

  // Memory section
  const memSection = [
    0x05,  // section id: memory
    0x03,  // section size
    0x01,  // 1 memory
    0x00, 0x01, // limits: min=1 page
  ];

  return new Uint8Array([
    ...magic, ...version,
    ...typeSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
  ]);
}

const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00]);
const NOT_WASM = new Uint8Array([0x01, 0x02, 0x03, 0x04]);

function defaultMeta(overrides: Partial<TaskMeta> = {}): TaskMeta {
  return {
    wasmExports: [],
    inputSizeBytes: 10000,
    availableDevices: 4,
    deviceIds: ['dev-A', 'dev-B', 'dev-C', 'dev-D'],
    entryPoint: 'process',
    ...overrides,
  };
}

// Create sorted uint8 test data
function sortedBytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

// ─── Main ───

async function main() {

// ════════════════════════════════════════════
// WASM Export Parsing
// ════════════════════════════════════════════
console.log('\n\x1b[1m── WASM Export Parsing ──\x1b[0m');

test('1. parseWasmExports extracts function names', () => {
  const wasm = buildWasmWithExports(['encrypt', 'decrypt']);
  const exports = parseWasmExports(wasm);
  assert(exports.includes('encrypt'), 'has encrypt');
  assert(exports.includes('decrypt'), 'has decrypt');
  assert(exports.includes('memory'), 'has memory');
});

test('2. parseWasmExports returns empty for non-WASM', () => {
  const exports = parseWasmExports(NOT_WASM);
  assertEqual(exports.length, 0, 'empty for non-WASM');
});

test('3. parseWasmExports handles empty module', () => {
  const exports = parseWasmExports(new Uint8Array(0));
  assertEqual(exports.length, 0, 'empty for empty');
});

// ════════════════════════════════════════════
// Pattern Detection
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Pattern Detection ──\x1b[0m');

test('4. detects sort pattern from exports', () => {
  const sort = new SortPattern();
  const match = sort.detect(['sort', 'compare', 'memory'], new Uint8Array(1000), defaultMeta());
  assert(match.confidence >= 0.8, `sort confidence >= 0.8 (got ${match.confidence})`);
  assertEqual(match.pattern, ParallelPattern.SORT, 'pattern=SORT');
});

test('5. detects sort pattern from entry point', () => {
  const sort = new SortPattern();
  const match = sort.detect([], new Uint8Array(1000), defaultMeta({ entryPoint: 'mergesort' }));
  assert(match.confidence >= 0.8, `confidence >= 0.8 (got ${match.confidence})`);
});

test('6. detects map pattern from exports', () => {
  const map = new MapPattern();
  const match = map.detect(['transform', 'memory'], new Uint8Array(1000), defaultMeta());
  assert(match.confidence >= 0.6, `map confidence >= 0.6 (got ${match.confidence})`);
});

test('7. detects reduce pattern from exports', () => {
  const reduce = new ReducePattern();
  const match = reduce.detect(['reduce', 'accumulate'], new Uint8Array(1000), defaultMeta());
  assert(match.confidence >= 0.8, `reduce confidence >= 0.8 (got ${match.confidence})`);
});

test('8. detects filter pattern from entry point', () => {
  const filter = new FilterPattern();
  const match = filter.detect([], new Uint8Array(1000), defaultMeta({ entryPoint: 'filter_data' }));
  assert(match.confidence >= 0.8, `filter confidence >= 0.8 (got ${match.confidence})`);
});

test('9. detects search pattern from exports', () => {
  const search = new SearchPattern();
  const match = search.detect(['find', 'index'], new Uint8Array(1000), defaultMeta());
  assert(match.confidence >= 0.8, `search confidence >= 0.8 (got ${match.confidence})`);
});

test('10. detects matrix pattern from exports', () => {
  const matrix = new MatrixPattern();
  const match = matrix.detect(['matmul', 'memory'], new Uint8Array(1000), defaultMeta());
  assert(match.confidence >= 0.8, `matrix confidence >= 0.8 (got ${match.confidence})`);
});

test('11. detects ML train pattern from exports', () => {
  const ml = new MLTrainPattern();
  const match = ml.detect(['train', 'gradient', 'loss'], new Uint8Array(1000), defaultMeta());
  assert(match.confidence >= 0.8, `ml confidence >= 0.8 (got ${match.confidence})`);
});

test('12. generic pattern always matches with low confidence', () => {
  const generic = new GenericPattern();
  const match = generic.detect([], new Uint8Array(1000), defaultMeta());
  assertEqual(match.pattern, ParallelPattern.GENERIC, 'pattern=GENERIC');
  assert(match.confidence > 0, 'confidence > 0');
  assert(match.confidence < 0.5, 'confidence < 0.5');
});

test('13. detector returns best match by confidence', () => {
  const detector = new PatternDetector();
  const wasm = buildWasmWithExports(['sort', 'compare']);
  const best = detector.detectBest(wasm, new Uint8Array(5000), defaultMeta());
  assertEqual(best.pattern, ParallelPattern.SORT, 'best=SORT');
});

test('14. detector falls back to generic for unknown exports', () => {
  const detector = new PatternDetector();
  const wasm = buildWasmWithExports(['xyzzy', 'plugh']);
  const best = detector.detectBest(wasm, new Uint8Array(5000), defaultMeta({ entryPoint: 'xyzzy' }));
  assertEqual(best.pattern, ParallelPattern.GENERIC, 'fallback=GENERIC');
});

test('15. detector returns all matches sorted', () => {
  const detector = new PatternDetector();
  const wasm = buildWasmWithExports(['sort', 'filter']);
  const all = detector.detect(wasm, new Uint8Array(5000), defaultMeta());
  assert(all.length >= 2, `at least 2 matches (got ${all.length})`);
  // Sorted by confidence desc
  for (let i = 1; i < all.length; i++) {
    assert(all[i - 1].confidence >= all[i].confidence, 'sorted by confidence');
  }
});

// ════════════════════════════════════════════
// Decomposition
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Decomposition ──\x1b[0m');

test('16. sort decomposes into equal chunks', () => {
  const sort = new SortPattern();
  const data = new Uint8Array(400); // 100 x 4-byte elements
  const result = sort.decompose(data, 4, defaultMeta({ elementSizeBytes: 4 }));
  assertEqual(result.chunks.length, 4, '4 chunks');
  assertEqual(result.chunks[0].length, 100, 'chunk size=100 bytes');
});

test('17. map decomposes byte-level', () => {
  const map = new MapPattern();
  const data = new Uint8Array(100);
  const result = map.decompose(data, 4, defaultMeta({ elementSizeBytes: 1 }));
  assertEqual(result.chunks.length, 4, '4 chunks');
  // Each chunk ~25 bytes
  const totalBytes = result.chunks.reduce((s, c) => s + c.length, 0);
  assertEqual(totalBytes, 100, 'total bytes preserved');
});

test('18. filter decomposes preserving all data', () => {
  const filter = new FilterPattern();
  const data = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) data[i] = i & 0xFF;
  const result = filter.decompose(data, 4, defaultMeta());
  const totalBytes = result.chunks.reduce((s, c) => s + c.length, 0);
  assertEqual(totalBytes, 1000, 'all data preserved');
});

test('19. generic replicates data to all racers', () => {
  const generic = new GenericPattern();
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  const result = generic.decompose(data, 3, defaultMeta());
  assertEqual(result.chunks.length, 3, '3 racers');
  // Each racer gets the full data
  for (const chunk of result.chunks) {
    assertEqual(chunk.length, 5, 'full data per racer');
  }
});

test('20. decomposition handles uneven splits', () => {
  const map = new MapPattern();
  const data = new Uint8Array(10); // Not evenly divisible by 4
  const result = map.decompose(data, 4, defaultMeta({ elementSizeBytes: 1 }));
  const totalBytes = result.chunks.reduce((s, c) => s + c.length, 0);
  assertEqual(totalBytes, 10, 'all bytes accounted for');
});

// ════════════════════════════════════════════
// Merge Strategies
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Merge Strategies ──\x1b[0m');

test('21. sort merge produces correctly sorted output', () => {
  const sort = new SortPattern();
  // Two pre-sorted chunks (1-byte elements)
  const chunk1 = new Uint8Array([1, 3, 5, 7]);
  const chunk2 = new Uint8Array([2, 4, 6, 8]);
  const result = sort.merge([chunk1, chunk2], { elementSize: 1 });
  const expected = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  assertEqual(result.data.length, 8, 'length=8');
  for (let i = 0; i < 8; i++) {
    assertEqual(result.data[i], expected[i], `pos ${i}`);
  }
});

test('22. sort merge handles 4-way merge', () => {
  const sort = new SortPattern();
  const c1 = new Uint8Array([1, 5, 9]);
  const c2 = new Uint8Array([2, 6, 10]);
  const c3 = new Uint8Array([3, 7, 11]);
  const c4 = new Uint8Array([4, 8, 12]);
  const result = sort.merge([c1, c2, c3, c4], { elementSize: 1 });
  assertEqual(result.data.length, 12, 'length=12');
  for (let i = 0; i < 12; i++) {
    assertEqual(result.data[i], i + 1, `sorted pos ${i}`);
  }
});

test('23. map merge concatenates in order', () => {
  const map = new MapPattern();
  const result = map.merge([
    new Uint8Array([1, 2]),
    new Uint8Array([3, 4]),
    new Uint8Array([5, 6]),
  ], {});
  const expected = new Uint8Array([1, 2, 3, 4, 5, 6]);
  assertEqual(result.data.length, 6, 'length=6');
  for (let i = 0; i < 6; i++) assertEqual(result.data[i], expected[i], `byte ${i}`);
});

test('24. filter merge skips empty results', () => {
  const filter = new FilterPattern();
  const result = filter.merge([
    new Uint8Array([1, 2]),
    new Uint8Array([]),       // No matches in this chunk
    new Uint8Array([5, 6]),
    new Uint8Array([]),
  ], {});
  assertEqual(result.data.length, 4, 'length=4 (skipped empties)');
});

test('25. search merge takes first non-empty result', () => {
  const search = new SearchPattern();
  const result = search.merge([
    new Uint8Array([]),
    new Uint8Array([42]),     // Found!
    new Uint8Array([99]),     // Also found, but second
  ], {});
  assertEqual(result.data.length, 1, 'length=1');
  assertEqual(result.data[0], 42, 'first match=42');
});

test('26. search merge returns empty when nothing found', () => {
  const search = new SearchPattern();
  const result = search.merge([new Uint8Array([]), new Uint8Array([])], {});
  assertEqual(result.data.length, 0, 'empty when not found');
});

test('27. generic merge takes first result (race winner)', () => {
  const generic = new GenericPattern();
  const result = generic.merge([
    new Uint8Array([10, 20]),
    new Uint8Array([30, 40]),
  ], {});
  assertEqual(result.data[0], 10, 'first racer wins');
});

test('28. ML train merge averages gradients', () => {
  const ml = new MLTrainPattern();
  // Two gradient arrays: [1.0, 2.0] and [3.0, 4.0]
  const g1 = new Uint8Array(new Float32Array([1.0, 2.0]).buffer);
  const g2 = new Uint8Array(new Float32Array([3.0, 4.0]).buffer);
  const result = ml.merge([g1, g2], {});

  const averaged = new Float32Array(result.data.buffer, result.data.byteOffset, 2);
  assertEqual(averaged[0], 2.0, 'avg[0]=2.0');
  assertEqual(averaged[1], 3.0, 'avg[1]=3.0');
});

test('29. sort merge handles single chunk', () => {
  const sort = new SortPattern();
  const result = sort.merge([new Uint8Array([1, 2, 3])], { elementSize: 1 });
  assertEqual(result.data.length, 3, 'passthrough');
});

test('30. merge handles empty results array', () => {
  const map = new MapPattern();
  const result = map.merge([], {});
  assertEqual(result.data.length, 0, 'empty');
});

// ════════════════════════════════════════════
// Plan Generation
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Plan Generation ──\x1b[0m');

test('31. generates plan with correct chunk count', () => {
  const registry = new PatternRegistry();
  const generator = new PlanGenerator(registry);
  const match: PatternMatch = {
    pattern: ParallelPattern.MAP, confidence: 0.8, reason: 'test',
    suggestedChunks: 4, orderPreserving: true,
  };
  const wasm = buildWasmWithExports(['process']);
  const input = new Uint8Array(10000);
  const plan = generator.generate(match, wasm, input, defaultMeta());
  assertEqual(plan.chunkCount, 4, 'chunkCount=4');
  assertEqual(plan.pattern, ParallelPattern.MAP, 'pattern=MAP');
});

test('32. plan caps chunks by available devices', () => {
  const registry = new PatternRegistry();
  const generator = new PlanGenerator(registry);
  const match: PatternMatch = {
    pattern: ParallelPattern.MAP, confidence: 0.8, reason: 'test',
    suggestedChunks: 8, orderPreserving: true,
  };
  const plan = generator.generate(match, WASM_MAGIC, new Uint8Array(10000),
    defaultMeta({ availableDevices: 2, deviceIds: ['a', 'b'] }));
  assertEqual(plan.chunkCount, 2, 'capped at 2 devices');
});

test('33. plan assigns devices round-robin', () => {
  const registry = new PatternRegistry();
  const generator = new PlanGenerator(registry);
  const match: PatternMatch = {
    pattern: ParallelPattern.MAP, confidence: 0.8, reason: 'test',
    suggestedChunks: 4, orderPreserving: true,
  };
  const plan = generator.generate(match, WASM_MAGIC, new Uint8Array(4000),
    defaultMeta({ availableDevices: 2, deviceIds: ['A', 'B'] }));

  assert(plan.deviceAssignments.has('A'), 'has device A');
  assert(plan.deviceAssignments.has('B'), 'has device B');
  // Round-robin: A gets chunks 0,2 and B gets chunks 1,3 (if 4 chunks, capped to 2)
  const totalAssigned = Array.from(plan.deviceAssignments.values()).reduce((s, v) => s + v.length, 0);
  assertEqual(totalAssigned, plan.chunkCount, 'all chunks assigned');
});

test('34. plan includes fallback strategy', () => {
  const registry = new PatternRegistry();
  const generator = new PlanGenerator(registry);
  const match: PatternMatch = {
    pattern: ParallelPattern.SORT, confidence: 0.9, reason: 'test',
    suggestedChunks: 4, orderPreserving: true,
  };
  const plan = generator.generate(match, WASM_MAGIC, new Uint8Array(4000), defaultMeta());
  assertEqual(plan.fallbackPattern, ParallelPattern.MAP, 'sort fallback=MAP');
});

test('35. plan has human-readable explanation', () => {
  const registry = new PatternRegistry();
  const generator = new PlanGenerator(registry);
  const match: PatternMatch = {
    pattern: ParallelPattern.FILTER, confidence: 0.85, reason: 'filter exports found',
    suggestedChunks: 4, orderPreserving: true,
  };
  const plan = generator.generate(match, WASM_MAGIC, new Uint8Array(2000), defaultMeta());
  assert(plan.explanation.includes('filter'), 'explanation mentions pattern');
  assert(plan.explanation.includes('85%'), 'explanation mentions confidence');
});

// ════════════════════════════════════════════
// Task Compiler (End-to-End)
// ════════════════════════════════════════════
console.log('\n\x1b[1m── Task Compiler ──\x1b[0m');

test('36. compile + merge end-to-end for sort', () => {
  const compiler = new TaskCompiler();
  const wasm = buildWasmWithExports(['sort', 'compare']);
  const input = new Uint8Array(4000);

  const result = compiler.compile(wasm, input, defaultMeta());
  assertEqual(result.plan.pattern, ParallelPattern.SORT, 'detected SORT');
  assert(result.plan.chunkCount >= 2, 'multiple chunks');
  assert(result.compileTimeMs >= 0, 'has compile time');
});

test('37. compile detects pattern from live WASM exports', () => {
  const compiler = new TaskCompiler();
  const wasm = buildWasmWithExports(['filter', 'predicate']);
  const result = compiler.compile(wasm, new Uint8Array(5000), defaultMeta());
  assertEqual(result.plan.pattern, ParallelPattern.FILTER, 'detected FILTER');
});

test('38. compile falls back to generic for unknown', () => {
  const compiler = new TaskCompiler();
  const wasm = buildWasmWithExports(['xyzzy']);
  const result = compiler.compile(wasm, new Uint8Array(5000), defaultMeta({ entryPoint: 'xyzzy' }));
  assertEqual(result.plan.pattern, ParallelPattern.GENERIC, 'fallback GENERIC');
});

test('39. compile tracks stats', () => {
  const compiler = new TaskCompiler();
  compiler.compile(buildWasmWithExports(['sort']), new Uint8Array(5000), defaultMeta());
  compiler.compile(buildWasmWithExports(['filter']), new Uint8Array(5000), defaultMeta());

  const stats = compiler.getStats();
  assertEqual(stats.totalCompilations, 2, 'totalCompilations=2');
  assert(Object.keys(stats.patternCounts).length >= 2, 'tracked patterns');
});

test('40. compile + mergeResults round-trip for map', () => {
  const compiler = new TaskCompiler();
  const wasm = buildWasmWithExports(['transform']);
  const input = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);

  const { plan } = compiler.compile(wasm, input,
    defaultMeta({ availableDevices: 2, deviceIds: ['a', 'b'], elementSizeBytes: 1 }));

  // Simulate: each chunk result is the input doubled
  const chunkResults = plan.chunks.map(c => {
    const result = new Uint8Array(c.data.length);
    for (let i = 0; i < c.data.length; i++) result[i] = c.data[i] * 2;
    return result;
  });

  const merged = compiler.mergeResults(plan, chunkResults);
  assertEqual(merged.data.length, 8, 'merged length=8');
  // First byte should be 10*2=20
  assertEqual(merged.data[0], 20, 'first byte doubled');
  // Last byte should be 80*2=160
  assertEqual(merged.data[merged.data.length - 1], 160, 'last byte doubled');
});

// ════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[1mPhase 4: Universal Task Compiler\x1b[0m`);
console.log(`  \x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failed > 0) { console.log('\n  Failed:'); errors.forEach(e => console.log(e)); }
console.log(`${'═'.repeat(50)}\n`);

} // end main

main().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Fatal:', err);
  console.error(err.stack);
  process.exit(1);
});
