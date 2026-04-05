/**
 * CMP v4.0 — Built-in Pipeline Stages
 *
 * Ready-to-use stages for common streaming operations:
 *   filter(predicate)  — pass items matching condition
 *   map(function)      — transform each item
 *   batch(n)           — collect N items, emit as array
 *   window(ms)         — collect items for N ms, emit as array
 *   throttle(n)        — limit to N items per second
 *   sample(n)          — pass every Nth item
 *   log(label)         — print items to console (debugging)
 *   collect()          — accumulate all items into final result
 *
 * Each stage implements: (item: Uint8Array, config) => Uint8Array[]
 *
 * @module pipes/stages/builtin-stages
 * @author Agent Viscro
 */

import type { StageFn } from '../pipeline-types';

// ─── Stage Registry ───

const registry = new Map<string, StageFn>();

/**
 * Get a built-in stage by name.
 */
export function getBuiltinStage(name: string): StageFn | null {
  return registry.get(name) ?? null;
}

/**
 * Get all registered built-in stage names.
 */
export function getBuiltinStageNames(): string[] {
  return Array.from(registry.keys());
}

/**
 * Check if a stage name is a built-in.
 */
export function isBuiltinStage(name: string): boolean {
  return registry.has(name);
}

// ─── Internal Accumulators ───

// Batch and window need state across calls — we use config to pass accumulators.
// The pipeline manager initializes config._accumulator for stateful stages.

// ─── Filter Stage ───
// Config: { predicate: 'gt:100' | 'lt:50' | 'eq:0' | 'contains:hello' | 'nonzero' }

registry.set('filter', (item: Uint8Array, config: Record<string, any>): Uint8Array[] => {
  const pred = (config.predicate || config.handler || 'nonzero') as string;

  if (pred === 'nonzero') {
    // Pass if any byte is non-zero
    return item.some(b => b !== 0) ? [item] : [];
  }

  if (pred.startsWith('gt:')) {
    const threshold = parseInt(pred.substring(3), 10);
    // Interpret item as a single numeric value (first 4 bytes as uint32 LE)
    const val = readUint32(item);
    return val > threshold ? [item] : [];
  }

  if (pred.startsWith('lt:')) {
    const threshold = parseInt(pred.substring(3), 10);
    const val = readUint32(item);
    return val < threshold ? [item] : [];
  }

  if (pred.startsWith('eq:')) {
    const target = parseInt(pred.substring(3), 10);
    const val = readUint32(item);
    return val === target ? [item] : [];
  }

  if (pred.startsWith('contains:')) {
    const needle = pred.substring(9);
    const text = new TextDecoder().decode(item);
    return text.includes(needle) ? [item] : [];
  }

  if (pred.startsWith('minlen:')) {
    const minLen = parseInt(pred.substring(7), 10);
    return item.length >= minLen ? [item] : [];
  }

  // Default: pass everything
  return [item];
});

// ─── Map Stage ───
// Config: { transform: 'double' | 'uppercase' | 'reverse' | 'xor:KEY' }

registry.set('map', (item: Uint8Array, config: Record<string, any>): Uint8Array[] => {
  const transform = (config.transform || config.handler || 'identity') as string;

  if (transform === 'identity') {
    return [item];
  }

  if (transform === 'double') {
    const result = new Uint8Array(item.length);
    for (let i = 0; i < item.length; i++) result[i] = (item[i] * 2) & 0xFF;
    return [result];
  }

  if (transform === 'uppercase') {
    const text = new TextDecoder().decode(item);
    return [new TextEncoder().encode(text.toUpperCase())];
  }

  if (transform === 'reverse') {
    const result = new Uint8Array(item.length);
    for (let i = 0; i < item.length; i++) result[i] = item[item.length - 1 - i];
    return [result];
  }

  if (transform.startsWith('xor:')) {
    const key = parseInt(transform.substring(4), 10) || 0x42;
    const result = new Uint8Array(item.length);
    for (let i = 0; i < item.length; i++) result[i] = item[i] ^ key;
    return [result];
  }

  return [item];
});

// ─── Batch Stage ───
// Config: { size: number, _buffer?: Uint8Array[] }

registry.set('batch', (item: Uint8Array, config: Record<string, any>): Uint8Array[] => {
  const batchSize = (config.size || config.n || 10) as number;

  if (!config._buffer) config._buffer = [];
  config._buffer.push(item);

  if (config._buffer.length >= batchSize) {
    // Emit concatenated batch
    const total = config._buffer.reduce((s: number, b: Uint8Array) => s + b.length, 0);
    const batch = new Uint8Array(total);
    let offset = 0;
    for (const b of config._buffer) {
      batch.set(b, offset);
      offset += b.length;
    }
    config._buffer = [];
    return [batch];
  }

  return []; // Not enough items yet
});

// ─── Window Stage ───
// Config: { ms: number, _buffer?, _windowStart? }

registry.set('window', (item: Uint8Array, config: Record<string, any>): Uint8Array[] => {
  const windowMs = (config.ms || config.duration || 1000) as number;

  if (!config._buffer) {
    config._buffer = [];
    config._windowStart = Date.now();
  }

  config._buffer.push(item);

  const elapsed = Date.now() - config._windowStart;
  if (elapsed >= windowMs) {
    // Emit window
    const total = config._buffer.reduce((s: number, b: Uint8Array) => s + b.length, 0);
    const batch = new Uint8Array(total);
    let offset = 0;
    for (const b of config._buffer) {
      batch.set(b, offset);
      offset += b.length;
    }
    config._buffer = [];
    config._windowStart = Date.now();
    return [batch];
  }

  return [];
});

// ─── Throttle Stage ───
// Config: { rate: number (items/sec), _lastEmit?, _count? }

registry.set('throttle', (item: Uint8Array, config: Record<string, any>): Uint8Array[] => {
  const rate = (config.rate || config.n || 100) as number;
  const intervalMs = 1000 / rate;

  const now = Date.now();
  if (!config._lastEmit) config._lastEmit = 0;

  if (now - config._lastEmit >= intervalMs) {
    config._lastEmit = now;
    return [item];
  }

  return []; // Dropped (rate limited)
});

// ─── Sample Stage ───
// Config: { n: number (pass every Nth item), _count? }

registry.set('sample', (item: Uint8Array, config: Record<string, any>): Uint8Array[] => {
  const n = (config.n || config.every || 10) as number;

  if (!config._count) config._count = 0;
  config._count++;

  if (config._count % n === 0) {
    return [item];
  }

  return []; // Skipped
});

// ─── Log Stage ───
// Config: { label: string }

registry.set('log', (item: Uint8Array, config: Record<string, any>): Uint8Array[] => {
  const label = (config.label || 'pipe') as string;
  let display: string;
  try {
    display = new TextDecoder('utf-8', { fatal: true }).decode(item);
    if (display.length > 80) display = display.substring(0, 80) + '...';
  } catch {
    display = `[${item.length} bytes]`;
  }
  // Use console.log for debugging visibility
  console.log(`  [${label}] ${display}`);
  return [item]; // Pass through
});

// ─── Collect Stage ───
// Config: { _collected? }
// Accumulates all items. Emits nothing until flush.

registry.set('collect', (item: Uint8Array, config: Record<string, any>): Uint8Array[] => {
  if (!config._collected) config._collected = [];
  config._collected.push(item);
  // Collect never emits during streaming — call flushCollect() at pipeline stop
  return [];
});

/**
 * Flush the collect stage — concatenate all collected items.
 */
export function flushCollect(config: Record<string, any>): Uint8Array {
  const items: Uint8Array[] = config._collected || [];
  if (items.length === 0) return new Uint8Array(0);

  const total = items.reduce((s, b) => s + b.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of items) {
    result.set(b, offset);
    offset += b.length;
  }
  config._collected = [];
  return result;
}

/**
 * Flush the batch stage — emit whatever is buffered.
 */
export function flushBatch(config: Record<string, any>): Uint8Array | null {
  const buffer: Uint8Array[] = config._buffer || [];
  if (buffer.length === 0) return null;

  const total = buffer.reduce((s: number, b: Uint8Array) => s + b.length, 0);
  const batch = new Uint8Array(total);
  let offset = 0;
  for (const b of buffer) {
    batch.set(b, offset);
    offset += b.length;
  }
  config._buffer = [];
  return batch;
}

// ─── Helpers ───

function readUint32(data: Uint8Array): number {
  if (data.length < 4) {
    // Treat short data as a small number
    let val = 0;
    for (let i = 0; i < data.length; i++) val |= data[i] << (i * 8);
    return val;
  }
  return data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
}
