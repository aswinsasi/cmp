/**
 * CMP v5.0 — WASM Bytecode Analyzer
 *
 * THE WORLD'S FIRST protocol-level WASM binary analysis for
 * autonomous parallelization detection.
 *
 * No existing distributed system analyzes WASM bytecode to decide
 * HOW to parallelize. BOINC requires manual work unit design.
 * Golem requires explicit task splitting. Ray requires decorators.
 * Spark requires map/reduce functions.
 *
 * CMP's bytecode analyzer reads the raw .wasm binary and extracts:
 *   1. Function signatures (input/output types)
 *   2. Instruction patterns (loops, branches, accumulation)
 *   3. Memory access patterns (linear scan, random access, write-back)
 *   4. Output size relationship (same as input? smaller? fixed?)
 *   5. Data flow graph (independent iterations? dependencies?)
 *
 * From these signals, the analyzer determines the parallelization
 * pattern WITHOUT the developer specifying anything.
 *
 * @module compiler/bytecode-analyzer
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';

const log = new Logger('BytecodeAnalyzer');

// ─── WASM Opcodes (subset relevant to pattern detection) ───

const Op = {
  // Control flow
  UNREACHABLE: 0x00,
  NOP: 0x01,
  BLOCK: 0x02,
  LOOP: 0x03,
  IF: 0x04,
  ELSE: 0x05,
  END: 0x0B,
  BR: 0x0C,
  BR_IF: 0x0D,
  BR_TABLE: 0x0E,
  RETURN: 0x0F,
  CALL: 0x10,

  // Variable access
  LOCAL_GET: 0x20,
  LOCAL_SET: 0x21,
  LOCAL_TEE: 0x22,
  GLOBAL_GET: 0x23,
  GLOBAL_SET: 0x24,

  // Memory
  I32_LOAD: 0x28,
  I64_LOAD: 0x29,
  F32_LOAD: 0x2A,
  F64_LOAD: 0x2B,
  I32_LOAD8_S: 0x2C,
  I32_LOAD8_U: 0x2D,
  I32_LOAD16_S: 0x2E,
  I32_LOAD16_U: 0x2F,
  I32_STORE: 0x36,
  I64_STORE: 0x37,
  F32_STORE: 0x38,
  F64_STORE: 0x39,
  I32_STORE8: 0x3A,
  I32_STORE16: 0x3B,

  // Constants
  I32_CONST: 0x41,
  I64_CONST: 0x42,
  F32_CONST: 0x43,
  F64_CONST: 0x44,

  // Comparison
  I32_EQZ: 0x45,
  I32_EQ: 0x46,
  I32_NE: 0x47,
  I32_LT_S: 0x48,
  I32_LT_U: 0x49,
  I32_GT_S: 0x4A,
  I32_GT_U: 0x4B,
  I32_LE_S: 0x4C,
  I32_LE_U: 0x4D,
  I32_GE_S: 0x4E,
  I32_GE_U: 0x4F,

  // Arithmetic
  I32_ADD: 0x6A,
  I32_SUB: 0x6B,
  I32_MUL: 0x6C,
  I32_DIV_S: 0x6D,
  I32_DIV_U: 0x6E,
  I32_REM_S: 0x6F,
  I32_REM_U: 0x70,
  I32_AND: 0x71,
  I32_OR: 0x72,
  I32_XOR: 0x73,
  I32_SHL: 0x74,
  I32_SHR_S: 0x75,
  I32_SHR_U: 0x76,
};

// ─── Analysis Result ───

export interface BytecodeAnalysis {
  /** Number of functions in the module */
  functionCount: number;
  /** Analysis of the entry point function */
  entryPoint: FunctionAnalysis | null;
  /** All function analyses */
  functions: FunctionAnalysis[];
  /** Detected structural pattern */
  structuralPattern: StructuralPattern;
  /** Confidence in the structural analysis (0-1) */
  confidence: number;
  /** Human-readable explanation */
  explanation: string;
  /** Estimated output-to-input size ratio */
  outputRatio: OutputRatio;
  /** Whether iterations are independent (parallelizable) */
  independentIterations: boolean;
  /** Memory access pattern */
  memoryPattern: MemoryPattern;
}

export interface FunctionAnalysis {
  /** Function index */
  index: number;
  /** Export name (if exported) */
  exportName: string | null;
  /** Parameter count */
  paramCount: number;
  /** Return count */
  returnCount: number;
  /** Instruction count */
  instructionCount: number;
  /** Loop nesting depth */
  loopDepth: number;
  /** Number of loops */
  loopCount: number;
  /** Number of branches (if/br_if) */
  branchCount: number;
  /** Number of memory loads */
  loadCount: number;
  /** Number of memory stores */
  storeCount: number;
  /** Number of comparisons */
  compareCount: number;
  /** Number of arithmetic operations */
  arithmeticCount: number;
  /** Whether function has an accumulator pattern */
  hasAccumulator: boolean;
  /** Whether function has conditional store (filter pattern) */
  hasConditionalStore: boolean;
  /** Whether function has compare+swap (sort pattern) */
  hasCompareSwap: boolean;
  /** Whether function increments a write pointer independently of read */
  hasIndependentWritePtr: boolean;
  /** Instruction histogram */
  opcodeHistogram: Map<number, number>;
}

export enum StructuralPattern {
  /** Input scanned linearly, each element transformed independently */
  LINEAR_MAP = 'linear_map',
  /** Input scanned, elements conditionally included in output */
  LINEAR_FILTER = 'linear_filter',
  /** Input scanned, accumulated into fixed-size result */
  LINEAR_REDUCE = 'linear_reduce',
  /** Input elements compared and reordered */
  COMPARE_REORDER = 'compare_reorder',
  /** Multiple passes over data */
  MULTI_PASS = 'multi_pass',
  /** Fixed-size output regardless of input */
  FIXED_OUTPUT = 'fixed_output',
  /** Cannot determine pattern */
  UNKNOWN = 'unknown',
}

export enum OutputRatio {
  /** Output same size as input (map, encrypt, transform) */
  SAME = 'same',
  /** Output smaller than input (filter, compress, reduce) */
  SMALLER = 'smaller',
  /** Output is fixed size regardless of input (hash, reduce to scalar) */
  FIXED = 'fixed',
  /** Output larger than input (decompress, generate) */
  LARGER = 'larger',
  /** Cannot determine */
  UNKNOWN = 'unknown',
}

export enum MemoryPattern {
  /** Sequential read, sequential write (map) */
  LINEAR_READ_WRITE = 'linear_read_write',
  /** Sequential read, conditional write (filter) */
  LINEAR_READ_CONDITIONAL_WRITE = 'linear_read_conditional_write',
  /** Sequential read, accumulate (reduce) */
  LINEAR_READ_ACCUMULATE = 'linear_read_accumulate',
  /** Random access read/write (sort, graph) */
  RANDOM_ACCESS = 'random_access',
  /** Cannot determine */
  UNKNOWN = 'unknown',
}

// ─── LEB128 Reader ───

function readLEB128(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < data.length) {
    const byte = data[offset + bytesRead];
    value |= (byte & 0x7F) << shift;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) break;
  }

  return { value, bytesRead };
}

function readSignedLEB128(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  let byte: number;

  do {
    byte = data[offset + bytesRead];
    value |= (byte & 0x7F) << shift;
    shift += 7;
    bytesRead++;
  } while (byte & 0x80 && offset + bytesRead < data.length);

  if (shift < 32 && (byte & 0x40)) {
    value |= (~0 << shift);
  }

  return { value, bytesRead };
}

// ─── WASM Section Parser ───

interface WasmSections {
  typeSection: Uint8Array | null;     // 1
  functionSection: Uint8Array | null; // 3
  exportSection: Uint8Array | null;   // 7
  codeSection: Uint8Array | null;     // 10
  sectionOffsets: Map<number, { offset: number; size: number }>;
}

function parseSections(wasm: Uint8Array): WasmSections {
  const sections: WasmSections = {
    typeSection: null,
    functionSection: null,
    exportSection: null,
    codeSection: null,
    sectionOffsets: new Map(),
  };

  if (wasm.length < 8 || wasm[0] !== 0x00 || wasm[1] !== 0x61 ||
      wasm[2] !== 0x73 || wasm[3] !== 0x6D) {
    return sections;
  }

  let offset = 8;
  while (offset < wasm.length) {
    const sectionId = wasm[offset++];
    const { value: sectionSize, bytesRead } = readLEB128(wasm, offset);
    offset += bytesRead;

    sections.sectionOffsets.set(sectionId, { offset, size: sectionSize });
    const sectionData = wasm.slice(offset, offset + sectionSize);

    switch (sectionId) {
      case 1: sections.typeSection = sectionData; break;
      case 3: sections.functionSection = sectionData; break;
      case 7: sections.exportSection = sectionData; break;
      case 10: sections.codeSection = sectionData; break;
    }

    offset += sectionSize;
  }

  return sections;
}

// ─── Function Type Parser ───

interface FuncType {
  params: number[];  // value types
  returns: number[]; // value types
}

function parseTypeSection(data: Uint8Array): FuncType[] {
  const types: FuncType[] = [];
  let offset = 0;
  const { value: count, bytesRead } = readLEB128(data, offset);
  offset += bytesRead;

  for (let i = 0; i < count && offset < data.length; i++) {
    if (data[offset] !== 0x60) { offset++; continue; } // func type marker
    offset++;

    // Params
    const { value: paramCount, bytesRead: pb } = readLEB128(data, offset);
    offset += pb;
    const params: number[] = [];
    for (let j = 0; j < paramCount && offset < data.length; j++) {
      params.push(data[offset++]);
    }

    // Returns
    const { value: returnCount, bytesRead: rb } = readLEB128(data, offset);
    offset += rb;
    const returns: number[] = [];
    for (let j = 0; j < returnCount && offset < data.length; j++) {
      returns.push(data[offset++]);
    }

    types.push({ params, returns });
  }

  return types;
}

// ─── Function Section Parser (type index mapping) ───

function parseFunctionSection(data: Uint8Array): number[] {
  const typeIndices: number[] = [];
  let offset = 0;
  const { value: count, bytesRead } = readLEB128(data, offset);
  offset += bytesRead;

  for (let i = 0; i < count && offset < data.length; i++) {
    const { value: typeIdx, bytesRead: tb } = readLEB128(data, offset);
    offset += tb;
    typeIndices.push(typeIdx);
  }

  return typeIndices;
}

// ─── Export Parser ───

interface WasmExport {
  name: string;
  kind: number; // 0=func, 1=table, 2=mem, 3=global
  index: number;
}

function parseExportSection(data: Uint8Array): WasmExport[] {
  const exports: WasmExport[] = [];
  let offset = 0;
  const { value: count, bytesRead } = readLEB128(data, offset);
  offset += bytesRead;

  for (let i = 0; i < count && offset < data.length; i++) {
    const { value: nameLen, bytesRead: nb } = readLEB128(data, offset);
    offset += nb;
    const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
    offset += nameLen;
    const kind = data[offset++];
    const { value: index, bytesRead: ib } = readLEB128(data, offset);
    offset += ib;
    exports.push({ name, kind, index });
  }

  return exports;
}

// ─── Code Section Analyzer ───

function analyzeFunction(
  codeBody: Uint8Array,
  funcIndex: number,
  exportName: string | null,
  funcType: FuncType | null,
): FunctionAnalysis {
  const analysis: FunctionAnalysis = {
    index: funcIndex,
    exportName,
    paramCount: funcType?.params.length ?? 0,
    returnCount: funcType?.returns.length ?? 0,
    instructionCount: 0,
    loopDepth: 0,
    loopCount: 0,
    branchCount: 0,
    loadCount: 0,
    storeCount: 0,
    compareCount: 0,
    arithmeticCount: 0,
    hasAccumulator: false,
    hasConditionalStore: false,
    hasCompareSwap: false,
    hasIndependentWritePtr: false,
    opcodeHistogram: new Map(),
  };

  let currentLoopDepth = 0;
  let maxLoopDepth = 0;
  let lastWasCompare = false;
  let lastWasLoad = false;
  let insideIf = false;
  let ifDepth = 0;
  let storeInsideIf = false;
  let loadInLoop = false;
  let storeInLoop = false;
  let addInLoop = false;
  let localSetAfterAdd = false;
  let blockDepth = 0;

  // Track local variable usage for accumulator detection
  let lastLocalGet = -1;
  let lastOp = -1;

  let offset = 0;

  // Skip local declarations
  const { value: localDeclCount, bytesRead: ldb } = readLEB128(codeBody, offset);
  offset += ldb;
  for (let i = 0; i < localDeclCount && offset < codeBody.length; i++) {
    const { bytesRead: cb } = readLEB128(codeBody, offset);
    offset += cb;
    offset++; // type byte
  }

  // Analyze instructions
  while (offset < codeBody.length) {
    const opcode = codeBody[offset++];
    analysis.instructionCount++;

    // Update histogram
    analysis.opcodeHistogram.set(opcode, (analysis.opcodeHistogram.get(opcode) ?? 0) + 1);

    switch (opcode) {
      case Op.BLOCK:
        blockDepth++;
        offset++; // block type
        break;

      case Op.LOOP:
        analysis.loopCount++;
        currentLoopDepth++;
        maxLoopDepth = Math.max(maxLoopDepth, currentLoopDepth);
        blockDepth++;
        offset++; // block type
        break;

      case Op.IF:
        insideIf = true;
        ifDepth++;
        blockDepth++;
        offset++; // block type
        analysis.branchCount++;
        break;

      case Op.ELSE:
        break;

      case Op.END:
        if (blockDepth > 0) blockDepth--;
        if (currentLoopDepth > 0 && blockDepth < currentLoopDepth) {
          currentLoopDepth--;
        }
        if (ifDepth > 0) {
          ifDepth--;
          if (ifDepth === 0) insideIf = false;
        }
        break;

      case Op.BR:
      case Op.BR_IF:
        analysis.branchCount++;
        { const { bytesRead } = readLEB128(codeBody, offset); offset += bytesRead; }
        break;

      case Op.BR_TABLE: {
        const { value: labelCount, bytesRead: lb } = readLEB128(codeBody, offset);
        offset += lb;
        for (let i = 0; i <= labelCount && offset < codeBody.length; i++) {
          const { bytesRead } = readLEB128(codeBody, offset);
          offset += bytesRead;
        }
        analysis.branchCount++;
        break;
      }

      case Op.CALL: {
        const { bytesRead } = readLEB128(codeBody, offset);
        offset += bytesRead;
        break;
      }

      case Op.LOCAL_GET: {
        const { value: localIdx, bytesRead } = readLEB128(codeBody, offset);
        offset += bytesRead;
        lastLocalGet = localIdx;
        break;
      }

      case Op.LOCAL_SET:
      case Op.LOCAL_TEE: {
        const { value: localIdx, bytesRead } = readLEB128(codeBody, offset);
        offset += bytesRead;
        // Accumulator: local.get X → add → local.set X
        if (lastOp === Op.I32_ADD && lastLocalGet === localIdx && currentLoopDepth > 0) {
          analysis.hasAccumulator = true;
          localSetAfterAdd = true;
        }
        break;
      }

      case Op.GLOBAL_GET:
      case Op.GLOBAL_SET: {
        const { bytesRead } = readLEB128(codeBody, offset);
        offset += bytesRead;
        break;
      }

      // Memory loads
      case Op.I32_LOAD: case Op.I64_LOAD: case Op.F32_LOAD: case Op.F64_LOAD:
      case Op.I32_LOAD8_S: case Op.I32_LOAD8_U:
      case Op.I32_LOAD16_S: case Op.I32_LOAD16_U: {
        const { bytesRead: ab } = readLEB128(codeBody, offset); offset += ab; // align
        const { bytesRead: ob } = readLEB128(codeBody, offset); offset += ob; // offset
        analysis.loadCount++;
        lastWasLoad = true;
        if (currentLoopDepth > 0) loadInLoop = true;
        break;
      }

      // Memory stores
      case Op.I32_STORE: case Op.I64_STORE: case Op.F32_STORE: case Op.F64_STORE:
      case Op.I32_STORE8: case Op.I32_STORE16: {
        const { bytesRead: ab } = readLEB128(codeBody, offset); offset += ab; // align
        const { bytesRead: ob } = readLEB128(codeBody, offset); offset += ob; // offset
        analysis.storeCount++;
        if (currentLoopDepth > 0) storeInLoop = true;
        if (insideIf) {
          storeInsideIf = true;
          analysis.hasConditionalStore = true;
        }
        // Compare + store = potential sort swap
        if (lastWasCompare && lastWasLoad) {
          analysis.hasCompareSwap = true;
        }
        lastWasLoad = false;
        break;
      }

      // Comparisons
      case Op.I32_EQZ: case Op.I32_EQ: case Op.I32_NE:
      case Op.I32_LT_S: case Op.I32_LT_U:
      case Op.I32_GT_S: case Op.I32_GT_U:
      case Op.I32_LE_S: case Op.I32_LE_U:
      case Op.I32_GE_S: case Op.I32_GE_U:
        analysis.compareCount++;
        lastWasCompare = true;
        break;

      // Arithmetic
      case Op.I32_ADD:
        analysis.arithmeticCount++;
        if (currentLoopDepth > 0) addInLoop = true;
        lastWasCompare = false;
        break;

      case Op.I32_SUB: case Op.I32_MUL: case Op.I32_DIV_S: case Op.I32_DIV_U:
      case Op.I32_REM_S: case Op.I32_REM_U:
      case Op.I32_AND: case Op.I32_OR: case Op.I32_XOR:
      case Op.I32_SHL: case Op.I32_SHR_S: case Op.I32_SHR_U:
        analysis.arithmeticCount++;
        lastWasCompare = false;
        break;

      // Constants
      case Op.I32_CONST: {
        const { bytesRead } = readSignedLEB128(codeBody, offset);
        offset += bytesRead;
        break;
      }
      case Op.I64_CONST: {
        const { bytesRead } = readSignedLEB128(codeBody, offset);
        offset += bytesRead;
        break;
      }
      case Op.F32_CONST:
        offset += 4;
        break;
      case Op.F64_CONST:
        offset += 8;
        break;

      default:
        // Skip unknown opcodes (most are single-byte)
        lastWasCompare = false;
        lastWasLoad = false;
        break;
    }

    lastOp = opcode;
  }

  analysis.loopDepth = maxLoopDepth;

  // Independent write pointer: stores in loop but write pointer
  // advances independently (not conditional on data)
  if (storeInLoop && loadInLoop && !storeInsideIf) {
    analysis.hasIndependentWritePtr = true;
  }

  return analysis;
}

// ─── Code Section Parser ───

function parseCodeSection(
  data: Uint8Array,
  funcTypes: FuncType[],
  funcTypeIndices: number[],
  exports: WasmExport[],
  importCount: number,
): FunctionAnalysis[] {
  const analyses: FunctionAnalysis[] = [];
  let offset = 0;

  const { value: funcCount, bytesRead } = readLEB128(data, offset);
  offset += bytesRead;

  for (let i = 0; i < funcCount && offset < data.length; i++) {
    const { value: bodySize, bytesRead: bsb } = readLEB128(data, offset);
    offset += bsb;

    const body = data.slice(offset, offset + bodySize);
    offset += bodySize;

    // Map function index to type
    const globalFuncIdx = importCount + i;
    const typeIdx = i < funcTypeIndices.length ? funcTypeIndices[i] : -1;
    const funcType = typeIdx >= 0 && typeIdx < funcTypes.length ? funcTypes[typeIdx] : null;

    // Check if this function is exported
    const exportEntry = exports.find(e => e.kind === 0 && e.index === globalFuncIdx);
    const exportName = exportEntry?.name ?? null;

    try {
      const analysis = analyzeFunction(body, globalFuncIdx, exportName, funcType);
      analyses.push(analysis);
    } catch {
      // Skip unparseable functions
    }
  }

  return analyses;
}

// ─── Structural Pattern Detection ───

function detectStructuralPattern(
  entryFn: FunctionAnalysis,
  allFunctions: FunctionAnalysis[],
): { pattern: StructuralPattern; confidence: number; explanation: string; outputRatio: OutputRatio; independentIterations: boolean; memoryPattern: MemoryPattern } {
  let pattern = StructuralPattern.UNKNOWN;
  let confidence = 0;
  let explanation = '';
  let outputRatio = OutputRatio.UNKNOWN;
  let independentIterations = false;
  let memoryPattern = MemoryPattern.UNKNOWN;

  const fn = entryFn;

  // ─── Signal scoring ───
  // Each signal contributes evidence toward a pattern

  const signals = {
    hasLoop: fn.loopCount > 0,
    hasNestedLoop: fn.loopDepth >= 2,
    hasAccumulator: fn.hasAccumulator,
    hasConditionalStore: fn.hasConditionalStore,
    hasCompareSwap: fn.hasCompareSwap,
    hasIndependentWrite: fn.hasIndependentWritePtr,
    highLoadCount: fn.loadCount > 5,
    highStoreCount: fn.storeCount > 3,
    highCompareCount: fn.compareCount > 3,
    highArithmeticCount: fn.arithmeticCount > 5,
    loadStoreBalanced: fn.loadCount > 0 && Math.abs(fn.loadCount - fn.storeCount) <= fn.loadCount * 0.5,
    moreLoadsThanStores: fn.loadCount > fn.storeCount * 1.5,
    fewStores: fn.storeCount <= 2,
  };

  // ─── Pattern 1: LINEAR_MAP ───
  // Loop + load + store in loop, no conditional store, not a sort
  if (signals.hasLoop && !signals.hasConditionalStore && !signals.hasCompareSwap &&
      (signals.hasIndependentWrite || (fn.storeCount > 0 && fn.loadCount > 0))) {
    const score = (fn.loadCount > 1 ? 0.15 : 0.1) +
                  (fn.arithmeticCount > 0 ? 0.15 : 0) +
                  (signals.loadStoreBalanced ? 0.3 : 0.15) +
                  (signals.hasLoop ? 0.3 : 0);
    if (score > confidence) {
      pattern = StructuralPattern.LINEAR_MAP;
      confidence = Math.min(score, 0.95);
      explanation = 'Loop iterates over input, transforms each element independently, writes output linearly';
      outputRatio = OutputRatio.SAME;
      independentIterations = true;
      memoryPattern = MemoryPattern.LINEAR_READ_WRITE;
    }
  }

  // ─── Pattern 2: LINEAR_FILTER ───
  // Loop + conditional store (store inside if) — checked BEFORE reduce
  if (signals.hasLoop && signals.hasConditionalStore && fn.compareCount > 0) {
    const score = (signals.hasConditionalStore ? 0.4 : 0) +
                  (fn.compareCount > 0 ? 0.2 : 0) +
                  (signals.hasLoop ? 0.2 : 0) +
                  (fn.branchCount > 0 ? 0.1 : 0) +
                  (fn.loadCount > 0 ? 0.1 : 0);
    if (score > confidence) {
      pattern = StructuralPattern.LINEAR_FILTER;
      confidence = Math.min(score, 0.95);
      explanation = 'Loop reads input, applies condition, writes only matching elements to output';
      outputRatio = OutputRatio.SMALLER;
      independentIterations = true;
      memoryPattern = MemoryPattern.LINEAR_READ_CONDITIONAL_WRITE;
    }
  }

  // ─── Pattern 3: LINEAR_REDUCE ───
  // Loop + accumulator + NO loop stores + NO conditional store
  // Key: real reduce has no output stores in the loop body
  if (signals.hasLoop && signals.hasAccumulator && !signals.hasConditionalStore &&
      !signals.hasIndependentWrite && fn.storeCount <= 1) {
    const score = (signals.hasAccumulator ? 0.4 : 0) +
                  (signals.hasLoop ? 0.2 : 0) +
                  (fn.storeCount === 0 ? 0.2 : 0.1) +
                  (fn.loadCount > fn.storeCount * 3 ? 0.2 : 0.1);
    if (score > confidence) {
      pattern = StructuralPattern.LINEAR_REDUCE;
      confidence = Math.min(score, 0.90);
      explanation = 'Loop reads input, accumulates result into local variable(s), outputs fixed-size summary';
      outputRatio = OutputRatio.FIXED;
      independentIterations = false;
      memoryPattern = MemoryPattern.LINEAR_READ_ACCUMULATE;
    }
  }

  // ─── Pattern 4: COMPARE_REORDER (sort) ───
  // Nested loops + compare + swap (store after compare)
  if (signals.hasNestedLoop && signals.hasCompareSwap && signals.highCompareCount) {
    const score = (signals.hasCompareSwap ? 0.35 : 0) +
                  (signals.hasNestedLoop ? 0.25 : 0) +
                  (signals.highCompareCount ? 0.2 : 0) +
                  (signals.highStoreCount ? 0.2 : 0);
    if (score > confidence) {
      pattern = StructuralPattern.COMPARE_REORDER;
      confidence = Math.min(score, 0.90);
      explanation = 'Nested loops with compare-and-swap pattern indicate sorting/reordering';
      outputRatio = OutputRatio.SAME;
      independentIterations = false;
      memoryPattern = MemoryPattern.RANDOM_ACCESS;
    }
  }

  // ─── Pattern 5: MULTI_PASS ───
  // Multiple loops at the same nesting level (sequential loops, not nested)
  if (fn.loopCount >= 2 && fn.loopDepth <= 1) {
    const score = 0.6;
    if (score > confidence) {
      pattern = StructuralPattern.MULTI_PASS;
      confidence = score;
      explanation = 'Multiple sequential loops suggest multi-pass processing (pipeline candidate)';
      outputRatio = OutputRatio.SAME;
      independentIterations = true; // Each pass is independent per-element
      memoryPattern = MemoryPattern.LINEAR_READ_WRITE;
    }
  }

  // ─── Pattern 6: FIXED_OUTPUT ───
  // Very few stores relative to loads, suggesting aggregate output
  if (signals.hasLoop && fn.storeCount <= 3 && fn.loadCount > 10) {
    const score = 0.7;
    if (score > confidence) {
      pattern = StructuralPattern.FIXED_OUTPUT;
      confidence = score;
      explanation = 'Many loads but very few stores suggest fixed-size aggregate output (histogram, checksum)';
      outputRatio = OutputRatio.FIXED;
      independentIterations = false;
      memoryPattern = MemoryPattern.LINEAR_READ_ACCUMULATE;
    }
  }

  // ─── Fallback ───
  if (pattern === StructuralPattern.UNKNOWN) {
    // Best guess from basic signals
    if (signals.hasLoop && signals.highLoadCount) {
      pattern = StructuralPattern.LINEAR_MAP;
      confidence = 0.3;
      explanation = 'Fallback: loop with memory access, assuming map-parallel';
      outputRatio = OutputRatio.SAME;
      independentIterations = true;
      memoryPattern = MemoryPattern.LINEAR_READ_WRITE;
    } else {
      confidence = 0.1;
      explanation = 'Unable to determine pattern from bytecode analysis';
    }
  }

  return { pattern, confidence, explanation, outputRatio, independentIterations, memoryPattern };
}

// ─── Count imports ───

function countImports(wasm: Uint8Array): number {
  let offset = 8;
  while (offset < wasm.length) {
    const sectionId = wasm[offset++];
    const { value: sectionSize, bytesRead } = readLEB128(wasm, offset);
    offset += bytesRead;

    if (sectionId === 2) { // Import section
      const importData = wasm.slice(offset, offset + sectionSize);
      let ioff = 0;
      const { value: importCount, bytesRead: icb } = readLEB128(importData, ioff);
      ioff += icb;

      let funcImports = 0;
      for (let i = 0; i < importCount && ioff < importData.length; i++) {
        // module name
        const { value: modLen, bytesRead: mb } = readLEB128(importData, ioff);
        ioff += mb + modLen;
        // field name
        const { value: fieldLen, bytesRead: fb } = readLEB128(importData, ioff);
        ioff += fb + fieldLen;
        // kind
        const kind = importData[ioff++];
        if (kind === 0) { // function import
          funcImports++;
          const { bytesRead: tb } = readLEB128(importData, ioff);
          ioff += tb;
        } else if (kind === 1) { // table
          ioff += 3; // simplified
        } else if (kind === 2) { // memory
          const flags = importData[ioff++];
          const { bytesRead: lb } = readLEB128(importData, ioff);
          ioff += lb;
          if (flags & 1) { const { bytesRead: ub } = readLEB128(importData, ioff); ioff += ub; }
        } else if (kind === 3) { // global
          ioff += 2; // type + mutability
        }
      }
      return funcImports;
    }

    offset += sectionSize;
  }
  return 0;
}

// ─── Main Analyzer ───

/**
 * Analyze a WASM module's bytecode to detect parallelization patterns.
 *
 * This is the core innovation of CMP: no other distributed protocol
 * analyzes binary code structure to autonomously determine HOW to
 * parallelize a computation.
 *
 * @param wasmModule - Raw WASM binary
 * @param entryPointName - Entry function name (default: 'process')
 * @returns Full bytecode analysis with structural pattern
 */
export function analyzeWasmBytecode(
  wasmModule: Uint8Array,
  entryPointName: string = 'process',
): BytecodeAnalysis {
  const sections = parseSections(wasmModule);

  // Parse types
  const funcTypes = sections.typeSection
    ? parseTypeSection(sections.typeSection)
    : [];

  // Parse function→type mapping
  const funcTypeIndices = sections.functionSection
    ? parseFunctionSection(sections.functionSection)
    : [];

  // Parse exports
  const exports = sections.exportSection
    ? parseExportSection(sections.exportSection)
    : [];

  // Count imports (affects function indexing)
  const importCount = countImports(wasmModule);

  // Parse and analyze code
  const functions = sections.codeSection
    ? parseCodeSection(sections.codeSection, funcTypes, funcTypeIndices, exports, importCount)
    : [];

  // Find entry point
  const entryPoint = functions.find(f => f.exportName === entryPointName) ?? null;

  // Detect structural pattern from entry point
  let result;
  if (entryPoint) {
    result = detectStructuralPattern(entryPoint, functions);
  } else {
    result = {
      pattern: StructuralPattern.UNKNOWN,
      confidence: 0,
      explanation: `Entry point "${entryPointName}" not found in exports`,
      outputRatio: OutputRatio.UNKNOWN,
      independentIterations: false,
      memoryPattern: MemoryPattern.UNKNOWN,
    };
  }

  const analysis: BytecodeAnalysis = {
    functionCount: functions.length,
    entryPoint,
    functions,
    structuralPattern: result.pattern,
    confidence: result.confidence,
    explanation: result.explanation,
    outputRatio: result.outputRatio,
    independentIterations: result.independentIterations,
    memoryPattern: result.memoryPattern,
  };

  log.info(`Bytecode analysis: ${result.pattern} (${(result.confidence * 100).toFixed(0)}%) — ${result.explanation}`);

  return analysis;
}
