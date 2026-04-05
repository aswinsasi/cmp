/**
 * CMP v4.0 — WASM Module Builder
 *
 * Constructs valid .wasm binary modules from opcodes.
 * No external toolchain (wabt, wat2wasm, etc.) needed.
 *
 * This lets CMP build real, executable WASM modules at runtime
 * for built-in operations like sort, filter, transform, reduce.
 *
 * Convention for CMP WASM modules:
 *   - Export "memory" (at least 1 page = 64KB)
 *   - Export "process" (main entry): (inputLen: i32) → outputLen: i32
 *   - Input: host writes to memory[0..inputLen]
 *   - Output: WASM writes to memory[inputLen..inputLen+outputLen]
 *   - Host reads output from memory[inputLen] for outputLen bytes
 *
 * @module wasm/wasm-module-builder
 * @author Agent Viscro
 */

// ─── WASM Opcodes ───

export const Op = {
  // Control
  unreachable: 0x00, nop: 0x01, block: 0x02, loop: 0x03,
  if_: 0x04, else_: 0x05, end: 0x0B, br: 0x0C, br_if: 0x0D,
  return_: 0x0F, call: 0x10,

  // Variables
  local_get: 0x20, local_set: 0x21, local_tee: 0x22,

  // Memory
  i32_load: 0x28, i32_load8_u: 0x2D, i32_load8_s: 0x2C,
  i32_store: 0x36, i32_store8: 0x3A,

  // Constants
  i32_const: 0x41,

  // Comparison
  i32_eqz: 0x45, i32_eq: 0x46, i32_ne: 0x47,
  i32_lt_s: 0x48, i32_lt_u: 0x49, i32_gt_s: 0x4A, i32_gt_u: 0x4B,
  i32_le_s: 0x4C, i32_le_u: 0x4D, i32_ge_s: 0x4E, i32_ge_u: 0x4F,

  // Arithmetic
  i32_add: 0x6A, i32_sub: 0x6B, i32_mul: 0x6C,
  i32_div_s: 0x6D, i32_div_u: 0x6E,
  i32_rem_s: 0x6F, i32_rem_u: 0x70,
  i32_and: 0x71, i32_or: 0x72, i32_xor: 0x73,
  i32_shl: 0x74, i32_shr_s: 0x75, i32_shr_u: 0x76,

  // Block types
  void_: 0x40, i32: 0x7F,
} as const;

// ─── LEB128 Encoding ───

export function encodeLEB128(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  do {
    let byte = v & 0x7F;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return bytes;
}

export function encodeSignedLEB128(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  let more = true;
  while (more) {
    let byte = v & 0x7F;
    v >>= 7;
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return bytes;
}

// ─── Section Builder ───

function buildSection(id: number, content: number[]): number[] {
  return [id, ...encodeLEB128(content.length), ...content];
}

// ─── Function Type ───

export interface FuncType {
  params: number[];  // e.g., [Op.i32, Op.i32]
  results: number[]; // e.g., [Op.i32]
}

// ─── Function Body ───

export interface FuncBody {
  /** Local variable declarations: [count, type] pairs */
  locals: Array<[number, number]>;
  /** Bytecode */
  code: number[];
}

// ─── Export Entry ───

export interface ExportEntry {
  name: string;
  kind: number; // 0=func, 2=memory
  index: number;
}

// ─── Module Builder ───

export class WasmModuleBuilder {
  private types: FuncType[] = [];
  private funcs: number[] = []; // Type indices
  private bodies: FuncBody[] = [];
  private exports: ExportEntry[] = [];
  private memoryPages: number = 1;

  /**
   * Add a function type. Returns the type index.
   */
  addType(params: number[], results: number[]): number {
    this.types.push({ params, results });
    return this.types.length - 1;
  }

  /**
   * Add a function. Returns the function index.
   */
  addFunction(typeIndex: number, locals: Array<[number, number]>, code: number[]): number {
    this.funcs.push(typeIndex);
    this.bodies.push({ locals, code });
    return this.funcs.length - 1;
  }

  /**
   * Add an export.
   */
  addExport(name: string, kind: number, index: number): void {
    this.exports.push({ name, kind, index });
  }

  /**
   * Set memory pages (default: 1 page = 64KB).
   */
  setMemoryPages(pages: number): void {
    this.memoryPages = pages;
  }

  /**
   * Build the complete WASM binary.
   */
  build(): Uint8Array {
    const sections: number[][] = [];

    // Type section (1)
    if (this.types.length > 0) {
      const content: number[] = [...encodeLEB128(this.types.length)];
      for (const t of this.types) {
        content.push(0x60); // func
        content.push(...encodeLEB128(t.params.length), ...t.params);
        content.push(...encodeLEB128(t.results.length), ...t.results);
      }
      sections.push(buildSection(1, content));
    }

    // Function section (3)
    if (this.funcs.length > 0) {
      const content = [...encodeLEB128(this.funcs.length), ...this.funcs.flatMap(f => encodeLEB128(f))];
      sections.push(buildSection(3, content));
    }

    // Memory section (5)
    sections.push(buildSection(5, [1, 0x00, ...encodeLEB128(this.memoryPages)]));

    // Export section (7)
    if (this.exports.length > 0) {
      const content: number[] = [...encodeLEB128(this.exports.length)];
      for (const e of this.exports) {
        const nameBytes = new TextEncoder().encode(e.name);
        content.push(...encodeLEB128(nameBytes.length), ...nameBytes);
        content.push(e.kind, ...encodeLEB128(e.index));
      }
      sections.push(buildSection(7, content));
    }

    // Code section (10)
    if (this.bodies.length > 0) {
      const bodiesBytes: number[] = [...encodeLEB128(this.bodies.length)];
      for (const body of this.bodies) {
        const funcBody: number[] = [];

        // Local declarations
        funcBody.push(...encodeLEB128(body.locals.length));
        for (const [count, type] of body.locals) {
          funcBody.push(...encodeLEB128(count), type);
        }

        // Code + end
        funcBody.push(...body.code, Op.end);

        // Wrap with size
        bodiesBytes.push(...encodeLEB128(funcBody.length), ...funcBody);
      }
      sections.push(buildSection(10, bodiesBytes));
    }

    // Assemble
    const magic = [0x00, 0x61, 0x73, 0x6D]; // \0asm
    const version = [0x01, 0x00, 0x00, 0x00];
    const allBytes = [...magic, ...version, ...sections.flat()];

    return new Uint8Array(allBytes);
  }

  /**
   * Convenience: build a CMP-convention module with a single "process" function.
   * Automatically exports memory and the process function.
   */
  static buildProcessModule(
    params: number[],
    results: number[],
    locals: Array<[number, number]>,
    code: number[],
    memoryPages: number = 1,
  ): Uint8Array {
    const builder = new WasmModuleBuilder();
    builder.setMemoryPages(memoryPages);
    const typeIdx = builder.addType(params, results);
    const funcIdx = builder.addFunction(typeIdx, locals, code);
    builder.addExport('memory', 2, 0);
    builder.addExport('process', 0, funcIdx);
    return builder.build();
  }
}
