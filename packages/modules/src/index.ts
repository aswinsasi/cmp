/**
 * @cmp/modules — Pre-built WASM modules for CMP
 * Zero WASM knowledge needed. Just import and run.
 *
 * Usage:
 *   import { Grayscale, Sepia, Blur } from '@cmp/modules';
 *
 *   const result = await Grayscale.run(node, imagePixels);
 *   const result = await Sepia.run(node, imagePixels);
 *   const result = await Blur.run(node, imagePixels, { width: 800, height: 600 });
 *
 * @author Agent Viscro
 */

import * as fs from 'fs';
import * as path from 'path';
import { CMPNode } from '../../core/src';

const DIST_DIR = path.join(__dirname, '..', 'dist');

/** Load a pre-built WASM module from dist/ */
function loadWasm(name: string): Uint8Array {
  const filePath = path.join(DIST_DIR, `${name}.wasm`);
  return new Uint8Array(fs.readFileSync(filePath));
}

/** Base interface for all CMP modules */
export interface ModuleResult {
  data: Uint8Array;
  totalTimeMs: number;
  devicesUsed: number;
  chunksExecuted: number;
  localFallback: boolean;
}

/** Common options for all modules */
export interface ModuleOptions {
  /** Number of chunks to split across peers */
  chunkHint?: number;
  /** Max execution time in ms */
  deadline?: number;
}

// ═══════════════════════════════════════
// IMAGE MODULES
// ═══════════════════════════════════════

/**
 * Convert RGB pixels to grayscale.
 * Uses luminance formula: 0.299R + 0.587G + 0.114B
 */
export const Grayscale = {
  wasm: null as Uint8Array | null,

  async run(node: CMPNode, rgbPixels: Uint8Array, opts: ModuleOptions = {}): Promise<ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('grayscale');
    return node.compute(this.wasm, rgbPixels, {
      entryPoint: 'process',
      deadline: opts.deadline || 10000,
      chunkHint: opts.chunkHint,
    });
  },
};

/**
 * Apply sepia tone filter to RGB pixels.
 */
export const Sepia = {
  wasm: null as Uint8Array | null,

  async run(node: CMPNode, rgbPixels: Uint8Array, opts: ModuleOptions = {}): Promise<ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('sepia');
    return node.compute(this.wasm, rgbPixels, {
      entryPoint: 'process',
      deadline: opts.deadline || 10000,
      chunkHint: opts.chunkHint,
    });
  },
};

/**
 * Invert pixel values (create negative image).
 */
export const Invert = {
  wasm: null as Uint8Array | null,

  async run(node: CMPNode, rgbPixels: Uint8Array, opts: ModuleOptions = {}): Promise<ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('invert');
    return node.compute(this.wasm, rgbPixels, {
      entryPoint: 'process',
      deadline: opts.deadline || 10000,
      chunkHint: opts.chunkHint,
    });
  },
};

/**
 * Adjust image brightness.
 * @param adjustment -128 (darker) to +127 (brighter)
 */
export const Brightness = {
  wasm: null as Uint8Array | null,

  async run(node: CMPNode, rgbPixels: Uint8Array, adjustment: number, opts: ModuleOptions = {}): Promise<ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('brightness');
    // Prepend adjustment byte
    const clamped = Math.max(-128, Math.min(127, Math.round(adjustment)));
    const input = new Uint8Array(1 + rgbPixels.length);
    input[0] = clamped < 0 ? 256 + clamped : clamped; // unsigned byte
    input.set(rgbPixels, 1);

    const result = await node.compute(this.wasm, input, {
      entryPoint: 'process',
      deadline: opts.deadline || 10000,
      chunkHint: opts.chunkHint,
    });

    return { ...result, data: result.data }; // data already excludes header byte
  },
};

/**
 * Adjust image contrast.
 * @param level 0 (minimum) to 255 (maximum), 128 = no change
 */
export const Contrast = {
  wasm: null as Uint8Array | null,

  async run(node: CMPNode, rgbPixels: Uint8Array, level: number, opts: ModuleOptions = {}): Promise<ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('contrast');
    const clamped = Math.max(0, Math.min(255, Math.round(level)));
    const input = new Uint8Array(1 + rgbPixels.length);
    input[0] = clamped;
    input.set(rgbPixels, 1);

    return node.compute(this.wasm, input, {
      entryPoint: 'process',
      deadline: opts.deadline || 10000,
      chunkHint: opts.chunkHint,
    });
  },
};

/**
 * Convert to binary black/white (threshold).
 * @param threshold 0-255, pixels above this → white, below → black
 */
export const Threshold = {
  wasm: null as Uint8Array | null,

  async run(node: CMPNode, pixels: Uint8Array, threshold: number = 128, opts: ModuleOptions = {}): Promise<ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('threshold');
    const clamped = Math.max(0, Math.min(255, Math.round(threshold)));
    const input = new Uint8Array(1 + pixels.length);
    input[0] = clamped;
    input.set(pixels, 1);

    return node.compute(this.wasm, input, {
      entryPoint: 'process',
      deadline: opts.deadline || 10000,
      chunkHint: opts.chunkHint,
    });
  },
};

/**
 * Apply 3x3 box blur.
 * Requires image dimensions since blur needs neighbor pixel access.
 * NOTE: Best run WITHOUT chunking (chunkHint: 1) since blur needs full rows.
 */
export const Blur = {
  wasm: null as Uint8Array | null,

  async run(node: CMPNode, rgbPixels: Uint8Array, dims: { width: number; height: number }, opts: ModuleOptions = {}): Promise<ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('blur');
    // Prepend width and height as BE u16
    const input = new Uint8Array(4 + rgbPixels.length);
    input[0] = (dims.width >> 8) & 0xFF;
    input[1] = dims.width & 0xFF;
    input[2] = (dims.height >> 8) & 0xFF;
    input[3] = dims.height & 0xFF;
    input.set(rgbPixels, 4);

    return node.compute(this.wasm, input, {
      entryPoint: 'process',
      deadline: opts.deadline || 15000,
      chunkHint: 1, // Blur needs full image context
    });
  },
};

// ═══════════════════════════════════════
// CRYPTO MODULES
// ═══════════════════════════════════════

/**
 * XOR cipher — symmetric encrypt/decrypt.
 * @param key Single byte key (0-255), default 0x42
 */
export const XORCipher = {
  wasm: null as Uint8Array | null,

  async encrypt(node: CMPNode, data: Uint8Array, key: number = 0x42, opts: ModuleOptions = {}): Promise<ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('xor-cipher');
    const input = new Uint8Array(1 + data.length);
    input[0] = key & 0xFF;
    input.set(data, 1);

    return node.compute(this.wasm, input, {
      entryPoint: 'encrypt',
      deadline: opts.deadline || 10000,
      chunkHint: opts.chunkHint,
    });
  },

  async decrypt(node: CMPNode, data: Uint8Array, key: number = 0x42, opts: ModuleOptions = {}): Promise<ModuleResult> {
    return this.encrypt(node, data, key, opts); // XOR is symmetric
  },
};

// ═══════════════════════════════════════
// DATA ANALYSIS MODULES
// ═══════════════════════════════════════

/**
 * Byte histogram — count frequency of each byte value.
 * Returns 256 × u32 counters (1024 bytes).
 */
export const Histogram = {
  wasm: null as Uint8Array | null,

  async run(node: CMPNode, data: Uint8Array, opts: ModuleOptions = {}): Promise<{ counts: Uint32Array } & ModuleResult> {
    if (!this.wasm) this.wasm = loadWasm('histogram');
    const result = await node.compute(this.wasm, data, {
      entryPoint: 'process',
      deadline: opts.deadline || 10000,
      chunkHint: 1, // Histogram needs full data for accurate counts
    });

    // Parse 256 × u32 LE counters
    const counts = new Uint32Array(result.data.buffer, result.data.byteOffset, 256);
    return { ...result, counts };
  },
};

// ═══════════════════════════════════════
// MODULE REGISTRY
// ═══════════════════════════════════════

/** All available modules */
export const modules = {
  grayscale: Grayscale,
  sepia: Sepia,
  invert: Invert,
  brightness: Brightness,
  contrast: Contrast,
  threshold: Threshold,
  blur: Blur,
  xorCipher: XORCipher,
  histogram: Histogram,
};

/** List available module names */
export function listModules(): string[] {
  return Object.keys(modules);
}
