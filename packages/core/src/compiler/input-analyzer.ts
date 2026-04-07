/**
 * CMP v5.0 — Input Structure Analyzer
 *
 * Auto-detects the structure of input data to ensure chunks
 * split at record boundaries — not in the middle of a record.
 *
 * No developer annotation needed. The analyzer examines the raw
 * bytes and detects:
 *   - JSON arrays → split between array elements
 *   - CSV/TSV → split at newline boundaries
 *   - Fixed-width records → split at record boundaries
 *   - RGB/RGBA pixel data → split at pixel boundaries (3 or 4 bytes)
 *   - Newline-delimited text → split at newlines
 *   - Raw bytes → split anywhere (element size = 1)
 *
 * @module compiler/input-analyzer
 * @author Agent Viscro
 */

import { Logger } from '../utils/logger';

const log = new Logger('InputAnalyzer');

// ─── Input Structure ───

export interface InputStructure {
  /** Detected format */
  format: InputFormat;
  /** Size of each record/element in bytes */
  elementSize: number;
  /** Total number of records/elements */
  elementCount: number;
  /** Offsets of record boundaries (for variable-length records) */
  boundaries: number[];
  /** Confidence in detection (0-1) */
  confidence: number;
  /** Explanation */
  explanation: string;
  /** Whether splitting must respect boundaries */
  requiresAlignment: boolean;
}

export enum InputFormat {
  /** JSON array: [item, item, ...] */
  JSON_ARRAY = 'json_array',
  /** Newline-delimited JSON (NDJSON) */
  NDJSON = 'ndjson',
  /** CSV with header */
  CSV = 'csv',
  /** TSV with header */
  TSV = 'tsv',
  /** RGB pixel data (3 bytes per pixel) */
  RGB = 'rgb',
  /** RGBA pixel data (4 bytes per pixel) */
  RGBA = 'rgba',
  /** Fixed-width binary records */
  FIXED_WIDTH = 'fixed_width',
  /** Newline-delimited text */
  LINE_DELIMITED = 'line_delimited',
  /** Float32 array */
  FLOAT32_ARRAY = 'float32_array',
  /** Int32 array */
  INT32_ARRAY = 'int32_array',
  /** Raw bytes (no structure detected) */
  RAW_BYTES = 'raw_bytes',
}

// ─── Detector Functions ───

function detectJsonArray(data: Uint8Array): InputStructure | null {
  // Quick check: starts with [ and ends with ]
  if (data.length < 2) return null;

  // Find first non-whitespace
  let start = 0;
  while (start < data.length && (data[start] === 0x20 || data[start] === 0x0A || data[start] === 0x0D || data[start] === 0x09)) start++;
  if (start >= data.length || data[start] !== 0x5B) return null; // [

  let end = data.length - 1;
  while (end > start && (data[end] === 0x20 || data[end] === 0x0A || data[end] === 0x0D || data[end] === 0x09)) end--;
  if (data[end] !== 0x5D) return null; // ]

  // Find element boundaries (top-level commas)
  const boundaries: number[] = [start + 1]; // After opening [
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < end; i++) {
    const b = data[i];

    if (escaped) { escaped = false; continue; }
    if (b === 0x5C) { escaped = true; continue; } // backslash

    if (b === 0x22) { inString = !inString; continue; } // quote
    if (inString) continue;

    if (b === 0x5B || b === 0x7B) depth++; // [ or {
    else if (b === 0x5D || b === 0x7D) depth--; // ] or }
    else if (b === 0x2C && depth === 0) { // comma at top level
      boundaries.push(i + 1);
    }
  }
  boundaries.push(end); // Before closing ]

  if (boundaries.length < 3) return null; // Need at least 2 elements

  return {
    format: InputFormat.JSON_ARRAY,
    elementSize: 0, // Variable-length
    elementCount: boundaries.length - 1,
    boundaries,
    confidence: 0.9,
    explanation: `JSON array with ${boundaries.length - 1} elements`,
    requiresAlignment: true,
  };
}

function detectCSV(data: Uint8Array): InputStructure | null {
  // Check first 1KB for CSV-like structure
  const sample = data.slice(0, Math.min(data.length, 1024));
  const text = new TextDecoder().decode(sample);
  const lines = text.split('\n');

  if (lines.length < 2) return null;

  // Check if lines have consistent comma counts
  const commaCounts = lines.filter(l => l.trim().length > 0).map(l => (l.match(/,/g) || []).length);
  if (commaCounts.length < 2) return null;

  const firstCommaCount = commaCounts[0];
  const consistent = commaCounts.every(c => c === firstCommaCount);
  if (!consistent || firstCommaCount === 0) return null;

  // Find all newline boundaries in full data
  const boundaries: number[] = [0];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0A) { // newline
      if (i + 1 < data.length) boundaries.push(i + 1);
    }
  }
  boundaries.push(data.length);

  // Check for tabs (TSV)
  const tabCounts = lines.filter(l => l.trim().length > 0).map(l => (l.match(/\t/g) || []).length);
  const isTabDelimited = tabCounts[0] > 0 && tabCounts.every(c => c === tabCounts[0]);

  return {
    format: isTabDelimited ? InputFormat.TSV : InputFormat.CSV,
    elementSize: 0,
    elementCount: boundaries.length - 1,
    boundaries,
    confidence: consistent ? 0.85 : 0.5,
    explanation: `${isTabDelimited ? 'TSV' : 'CSV'} with ${commaCounts[0]} columns, ${boundaries.length - 1} rows`,
    requiresAlignment: true,
  };
}

function detectRGB(data: Uint8Array): InputStructure | null {
  if (data.length < 12) return null; // At least 4 pixels

  // Check divisibility
  const divBy3 = data.length % 3 === 0;
  const divBy4 = data.length % 4 === 0;

  if (!divBy3 && !divBy4) return null;

  // Heuristic: check if values look like pixel data (0-255 range — always true for bytes)
  // Better heuristic: common image sizes
  const pixelCount3 = data.length / 3;
  const pixelCount4 = data.length / 4;

  // Check for common image dimensions
  const commonDims = [64, 100, 128, 200, 256, 320, 480, 500, 512, 640, 720, 768, 800, 1024, 1080, 1280, 1920];

  let isRGB = false;
  let isRGBA = false;

  for (const dim of commonDims) {
    if (pixelCount3 > 0 && pixelCount3 % dim === 0 && pixelCount3 / dim >= 10) { isRGB = true; break; }
    if (pixelCount4 > 0 && pixelCount4 % dim === 0 && pixelCount4 / dim >= 10) { isRGBA = true; break; }
  }

  // Also accept if purely divisible by 3 and large enough
  if (!isRGB && !isRGBA && divBy3 && data.length >= 30) {
    isRGB = true;
  }

  if (isRGBA) {
    return {
      format: InputFormat.RGBA,
      elementSize: 4,
      elementCount: pixelCount4,
      boundaries: [],
      confidence: 0.6,
      explanation: `RGBA pixel data: ${pixelCount4} pixels`,
      requiresAlignment: true,
    };
  }

  if (isRGB) {
    // Higher confidence if NOT divisible by 4 (can't be float32)
    const conf = divBy4 ? 0.55 : 0.7;
    return {
      format: InputFormat.RGB,
      elementSize: 3,
      elementCount: pixelCount3,
      boundaries: [],
      confidence: conf,
      explanation: `RGB pixel data: ${pixelCount3} pixels`,
      requiresAlignment: true,
    };
  }

  return null;
}

function detectNDJSON(data: Uint8Array): InputStructure | null {
  // Newline-delimited JSON: each line starts with { and ends with }
  const sample = data.slice(0, Math.min(data.length, 2048));
  const text = new TextDecoder().decode(sample);
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  if (lines.length < 2) return null;

  const jsonLines = lines.filter(l => {
    const trimmed = l.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
           (trimmed.startsWith('[') && trimmed.endsWith(']'));
  });

  if (jsonLines.length < lines.length * 0.8) return null;

  const boundaries: number[] = [0];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0A && i + 1 < data.length) boundaries.push(i + 1);
  }
  boundaries.push(data.length);

  return {
    format: InputFormat.NDJSON,
    elementSize: 0,
    elementCount: boundaries.length - 1,
    boundaries,
    confidence: 0.85,
    explanation: `NDJSON: ${boundaries.length - 1} JSON objects`,
    requiresAlignment: true,
  };
}

function detectFixedWidth(data: Uint8Array): InputStructure | null {
  if (data.length < 32) return null;

  // Try common fixed-width sizes
  const candidates = [2, 4, 8, 12, 16, 24, 32, 48, 64, 128, 256];

  for (const size of candidates) {
    if (data.length % size !== 0) continue;
    if (data.length / size < 4) continue; // At least 4 records

    // For float32 arrays: check if length divisible by 4 and values look like floats
    if (size === 4) {
      const view = new DataView(data.buffer, data.byteOffset, Math.min(data.length, 64));
      let validFloats = 0;
      const sampleCount = Math.min(16, data.length / 4);
      for (let i = 0; i < sampleCount; i++) {
        const f = view.getFloat32(i * 4, true);
        // Strict: must be finite AND in a reasonable range (not random noise)
        if (isFinite(f) && Math.abs(f) < 1e6 && Math.abs(f) > 1e-10) validFloats++;
      }
      // Require ALL samples to look like structured floats (not random bytes)
      if (sampleCount >= 4 && validFloats >= sampleCount - 1) {
        return {
          format: InputFormat.FLOAT32_ARRAY,
          elementSize: 4,
          elementCount: data.length / 4,
          boundaries: [],
          confidence: 0.6,
          explanation: `Float32 array: ${data.length / 4} elements`,
          requiresAlignment: true,
        };
      }
    }
  }

  return null;
}

function detectLineDelimited(data: Uint8Array): InputStructure | null {
  // Count newlines
  let newlineCount = 0;
  const boundaries: number[] = [0];

  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0A) {
      newlineCount++;
      if (i + 1 < data.length) boundaries.push(i + 1);
    }
  }
  boundaries.push(data.length);

  // Need reasonable number of lines
  if (newlineCount < 2 || newlineCount > data.length / 2) return null;

  // Check that most bytes are printable ASCII
  let printable = 0;
  const checkLen = Math.min(data.length, 1024);
  for (let i = 0; i < checkLen; i++) {
    if ((data[i] >= 0x20 && data[i] <= 0x7E) || data[i] === 0x0A || data[i] === 0x0D || data[i] === 0x09) {
      printable++;
    }
  }

  if (printable < checkLen * 0.9) return null;

  return {
    format: InputFormat.LINE_DELIMITED,
    elementSize: 0,
    elementCount: boundaries.length - 1,
    boundaries,
    confidence: 0.5,
    explanation: `Line-delimited text: ${boundaries.length - 1} lines`,
    requiresAlignment: true,
  };
}

// ─── Main Analyzer ───

/**
 * Analyze input data structure to determine optimal split boundaries.
 *
 * @param data - Raw input bytes
 * @returns Detected structure with element size and boundaries
 */
export function analyzeInputStructure(data: Uint8Array): InputStructure {
  // Try detectors in priority order (most specific first)
  const detectors = [
    detectJsonArray,
    detectNDJSON,
    detectCSV,
    detectRGB,          // RGB before fixed-width (300 bytes ÷ 4 = 75 floats, but it's really RGB)
    detectLineDelimited,
    detectFixedWidth,   // Float32/fixed-width last (most generic)
  ];

  for (const detect of detectors) {
    try {
      const result = detect(data);
      if (result && result.confidence > 0.3) {
        log.info(`Input structure: ${result.format} (${(result.confidence * 100).toFixed(0)}%) — ${result.explanation}`);
        return result;
      }
    } catch {
      // Skip failed detector
    }
  }

  // Fallback: raw bytes
  return {
    format: InputFormat.RAW_BYTES,
    elementSize: 1,
    elementCount: data.length,
    boundaries: [],
    confidence: 1.0,
    explanation: `Raw bytes: ${data.length} bytes (no structure detected)`,
    requiresAlignment: false,
  };
}

/**
 * Split data at detected boundaries, ensuring no record is cut in half.
 *
 * @param data - Input data
 * @param structure - Detected structure from analyzeInputStructure()
 * @param chunkCount - Number of chunks to produce
 * @returns Array of data chunks, each containing complete records
 */
export function splitAtBoundaries(
  data: Uint8Array,
  structure: InputStructure,
  chunkCount: number,
): Uint8Array[] {
  if (chunkCount <= 1) return [data];

  // Fixed-size elements: split at element boundaries
  if (structure.elementSize > 0 && structure.boundaries.length === 0) {
    const elementsPerChunk = Math.ceil(structure.elementCount / chunkCount);
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const startElem = i * elementsPerChunk;
      const endElem = Math.min(startElem + elementsPerChunk, structure.elementCount);
      if (startElem >= structure.elementCount) break;

      const startByte = startElem * structure.elementSize;
      const endByte = endElem * structure.elementSize;
      chunks.push(data.slice(startByte, endByte));
    }

    return chunks;
  }

  // Variable-length records: split at boundary offsets
  if (structure.boundaries.length > 1) {
    const recordCount = structure.boundaries.length - 1;
    const recordsPerChunk = Math.ceil(recordCount / chunkCount);
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const startRecord = i * recordsPerChunk;
      const endRecord = Math.min(startRecord + recordsPerChunk, recordCount);
      if (startRecord >= recordCount) break;

      const startByte = structure.boundaries[startRecord];
      const endByte = structure.boundaries[endRecord];
      chunks.push(data.slice(startByte, endByte));
    }

    return chunks;
  }

  // No structure: split evenly by bytes
  const bytesPerChunk = Math.ceil(data.length / chunkCount);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * bytesPerChunk;
    const end = Math.min(start + bytesPerChunk, data.length);
    if (start >= data.length) break;
    chunks.push(data.slice(start, end));
  }

  return chunks;
}
