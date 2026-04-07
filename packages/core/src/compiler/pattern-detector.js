"use strict";
/**
 * CMP v4.0 — Pattern Detector
 *
 * Analyzes WASM module exports and task metadata to detect
 * which parallelization pattern best fits the submitted code.
 *
 * Detection strategy:
 *   1. Parse WASM exports section to get function names
 *   2. Run all pattern detectors against the exports
 *   3. Rank by confidence, return best match
 *   4. If no pattern exceeds threshold → fallback to GENERIC
 *
 * @module compiler/pattern-detector
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatternDetector = exports.PatternRegistry = void 0;
exports.parseWasmExports = parseWasmExports;
const logger_1 = require("../utils/logger");
const compiler_types_1 = require("./compiler-types");
// Import all patterns
const data_patterns_1 = require("./patterns/data-patterns");
const compute_patterns_1 = require("./patterns/compute-patterns");
const log = new logger_1.Logger('PatternDet');
// ─── Pattern Registry ───
class PatternRegistry {
    patterns = [];
    constructor() {
        // Register all patterns in priority order
        // (Higher priority patterns are checked first and win ties)
        this.patterns = [
            new data_patterns_1.SortPattern(),
            new compute_patterns_1.MatrixPattern(),
            new compute_patterns_1.MLTrainPattern(),
            new data_patterns_1.ReducePattern(),
            new data_patterns_1.FilterPattern(),
            new data_patterns_1.SearchPattern(),
            new compute_patterns_1.HashPattern(),
            new compute_patterns_1.CompressPattern(),
            new data_patterns_1.MapPattern(), // Map is a catch-all for data-parallel, so check last
            new compute_patterns_1.GenericPattern(), // Generic is always the fallback
        ];
    }
    /**
     * Get all registered patterns.
     */
    getAll() {
        return this.patterns;
    }
    /**
     * Get a specific pattern by name.
     */
    get(name) {
        return this.patterns.find(p => p.name === name);
    }
    /**
     * Register a custom pattern.
     */
    register(pattern) {
        // Insert before GenericPattern (which should always be last)
        const genericIdx = this.patterns.findIndex(p => p.name === compiler_types_1.ParallelPattern.GENERIC);
        if (genericIdx >= 0) {
            this.patterns.splice(genericIdx, 0, pattern);
        }
        else {
            this.patterns.push(pattern);
        }
    }
}
exports.PatternRegistry = PatternRegistry;
// ─── WASM Export Parser ───
/**
 * Extract export function names from a WASM module binary.
 * Parses the WASM export section (section ID 7).
 * Returns empty array for non-WASM or unparseable modules.
 */
function parseWasmExports(wasmModule) {
    // Check WASM magic: \0asm
    if (wasmModule.length < 8 ||
        wasmModule[0] !== 0x00 || wasmModule[1] !== 0x61 ||
        wasmModule[2] !== 0x73 || wasmModule[3] !== 0x6D) {
        return [];
    }
    const exports = [];
    try {
        let offset = 8; // Skip magic + version
        while (offset < wasmModule.length) {
            const sectionId = wasmModule[offset++];
            const { value: sectionSize, bytesRead } = readLEB128(wasmModule, offset);
            offset += bytesRead;
            const sectionEnd = offset + sectionSize;
            if (sectionId === 7) {
                // Export section
                const { value: exportCount, bytesRead: ecBytes } = readLEB128(wasmModule, offset);
                offset += ecBytes;
                for (let i = 0; i < exportCount && offset < sectionEnd; i++) {
                    // Read name
                    const { value: nameLen, bytesRead: nlBytes } = readLEB128(wasmModule, offset);
                    offset += nlBytes;
                    const name = new TextDecoder().decode(wasmModule.slice(offset, offset + nameLen));
                    offset += nameLen;
                    // Read kind (0=func, 1=table, 2=mem, 3=global)
                    const kind = wasmModule[offset++];
                    // Read index
                    const { bytesRead: idxBytes } = readLEB128(wasmModule, offset);
                    offset += idxBytes;
                    // Only collect function exports
                    if (kind === 0) {
                        exports.push(name);
                    }
                    else if (kind === 2) {
                        exports.push(name); // Also collect memory exports (like 'memory')
                    }
                }
                break; // Found export section, done
            }
            else {
                // Skip this section
                offset = sectionEnd;
            }
        }
    }
    catch {
        // Parsing failed — return what we have
    }
    return exports;
}
/**
 * Read an unsigned LEB128 integer from a byte array.
 */
function readLEB128(data, offset) {
    let value = 0;
    let shift = 0;
    let bytesRead = 0;
    while (offset + bytesRead < data.length) {
        const byte = data[offset + bytesRead];
        value |= (byte & 0x7F) << shift;
        bytesRead++;
        if ((byte & 0x80) === 0)
            break;
        shift += 7;
        if (shift > 35)
            break; // Prevent overflow
    }
    return { value, bytesRead };
}
// ─── Pattern Detector ───
class PatternDetector {
    registry;
    config;
    constructor(config = {}) {
        this.registry = new PatternRegistry();
        this.config = { ...compiler_types_1.DEFAULT_COMPILER_CONFIG, ...config };
    }
    /**
     * Detect the best parallelization pattern for a task.
     *
     * @param wasmModule - The WASM module binary
     * @param inputData - The input data
     * @param meta - Task metadata (devices, entry point, etc.)
     * @returns All pattern matches sorted by confidence (best first)
     */
    detect(wasmModule, inputData, meta) {
        // Parse WASM exports
        const wasmExports = parseWasmExports(wasmModule);
        meta = { ...meta, wasmExports };
        // Run all detectors
        const matches = [];
        for (const pattern of this.registry.getAll()) {
            const match = pattern.detect(wasmExports, inputData, meta);
            if (match.confidence > 0) {
                matches.push(match);
            }
        }
        // Sort by confidence (highest first)
        matches.sort((a, b) => b.confidence - a.confidence);
        return matches;
    }
    /**
     * Get the best pattern match.
     * Falls back to GENERIC if nothing exceeds minConfidence.
     */
    detectBest(wasmModule, inputData, meta) {
        const matches = this.detect(wasmModule, inputData, meta);
        // Return best match above threshold, or generic fallback
        const best = matches.find(m => m.confidence >= this.config.minConfidence && m.pattern !== compiler_types_1.ParallelPattern.GENERIC);
        if (best)
            return best;
        // Return generic
        return matches.find(m => m.pattern === compiler_types_1.ParallelPattern.GENERIC)
            ?? { pattern: compiler_types_1.ParallelPattern.GENERIC, confidence: 0.2, reason: 'No pattern detected', suggestedChunks: 1, orderPreserving: true };
    }
    /**
     * Get the pattern registry for direct access.
     */
    getRegistry() {
        return this.registry;
    }
}
exports.PatternDetector = PatternDetector;
//# sourceMappingURL=pattern-detector.js.map