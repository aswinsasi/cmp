/**
 * CMP v1.4 — CRDT Implementations
 * Conflict-free Replicated Data Types for Lifeform state.
 * CRDTs guarantee merge without conflicts — the enabling technology
 * for Computational Fusion.
 *
 * Implements:
 *   - GCounter (grow-only counter)
 *   - PNCounter (positive-negative counter)
 *   - LWWRegister (last-writer-wins register)
 *   - ORSet (observed-remove set)
 *   - MVRegister (multi-value register)
 *
 * @module lifeform/crdt/crdts
 * @author Agent Viscro
 */

// ─── CRDT Interface ───

export enum CRDTType {
  G_COUNTER = 'g_counter',
  PN_COUNTER = 'pn_counter',
  LWW_REGISTER = 'lww_register',
  OR_SET = 'or_set',
  MV_REGISTER = 'mv_register',
}

export interface CRDT<T = any> {
  /** CRDT type identifier */
  readonly type: CRDTType;
  /** Get the current resolved value */
  value(): T;
  /** Merge with another CRDT of the same type */
  merge(other: CRDT<T>): void;
  /** Serialize to JSON-safe object */
  serialize(): any;
  /** Clone this CRDT */
  clone(): CRDT<T>;
}

// ═══════════════════════════════════════
// GCounter — Grow-Only Counter
// ═══════════════════════════════════════

/**
 * Grow-only counter. Each node increments its own slot.
 * Value = sum of all slots. Merge = max of each slot.
 */
export class GCounter implements CRDT<number> {
  readonly type = CRDTType.G_COUNTER;
  /** nodeId → count */
  private counts = new Map<string, number>();
  private nodeId: string;

  constructor(nodeId: string, initial?: Map<string, number>) {
    this.nodeId = nodeId;
    if (initial) {
      this.counts = new Map(initial);
    }
  }

  /** Increment by amount (must be positive) */
  increment(amount: number = 1): void {
    if (amount < 0) throw new Error('GCounter can only increment');
    const current = this.counts.get(this.nodeId) ?? 0;
    this.counts.set(this.nodeId, current + amount);
  }

  /** Get total count across all nodes */
  value(): number {
    let total = 0;
    for (const count of this.counts.values()) total += count;
    return total;
  }

  /** Merge: take max of each node's count */
  merge(other: CRDT<number>): void {
    if (!(other instanceof GCounter)) throw new Error('Can only merge with GCounter');
    for (const [nodeId, count] of (other as GCounter).counts) {
      const existing = this.counts.get(nodeId) ?? 0;
      this.counts.set(nodeId, Math.max(existing, count));
    }
  }

  serialize(): any {
    return { type: this.type, nodeId: this.nodeId, counts: Object.fromEntries(this.counts) };
  }

  clone(): GCounter {
    return new GCounter(this.nodeId, new Map(this.counts));
  }

  static deserialize(data: any): GCounter {
    return new GCounter(data.nodeId, new Map(Object.entries(data.counts).map(([k, v]) => [k, v as number])));
  }
}

// ═══════════════════════════════════════
// PNCounter — Positive-Negative Counter
// ═══════════════════════════════════════

/**
 * Counter that supports both increment and decrement.
 * Implemented as two GCounters: P (positive) and N (negative).
 * Value = P.value() - N.value()
 */
export class PNCounter implements CRDT<number> {
  readonly type = CRDTType.PN_COUNTER;
  private p: GCounter;
  private n: GCounter;

  constructor(nodeId: string, p?: GCounter, n?: GCounter) {
    this.p = p ?? new GCounter(nodeId);
    this.n = n ?? new GCounter(nodeId);
  }

  /** Increment by amount */
  increment(amount: number = 1): void {
    if (amount < 0) throw new Error('Use decrement() for negative values');
    this.p.increment(amount);
  }

  /** Decrement by amount */
  decrement(amount: number = 1): void {
    if (amount < 0) throw new Error('Decrement amount must be positive');
    this.n.increment(amount);
  }

  /** Get net count (positive - negative) */
  value(): number {
    return this.p.value() - this.n.value();
  }

  /** Merge both P and N counters */
  merge(other: CRDT<number>): void {
    if (!(other instanceof PNCounter)) throw new Error('Can only merge with PNCounter');
    this.p.merge((other as PNCounter).p);
    this.n.merge((other as PNCounter).n);
  }

  serialize(): any {
    return { type: this.type, p: this.p.serialize(), n: this.n.serialize() };
  }

  clone(): PNCounter {
    return new PNCounter('', this.p.clone() as GCounter, this.n.clone() as GCounter);
  }

  static deserialize(data: any): PNCounter {
    return new PNCounter('', GCounter.deserialize(data.p), GCounter.deserialize(data.n));
  }
}

// ═══════════════════════════════════════
// LWWRegister — Last-Writer-Wins Register
// ═══════════════════════════════════════

/**
 * Register where the most recent write wins.
 * Stores any JSON-serializable value with a timestamp.
 */
export class LWWRegister<T = any> implements CRDT<T | null> {
  readonly type = CRDTType.LWW_REGISTER;
  private val: T | null;
  private ts: number;
  private nodeId: string;

  constructor(nodeId: string, value: T | null = null, timestamp: number = 0) {
    this.nodeId = nodeId;
    this.val = value;
    this.ts = timestamp;
  }

  /** Set value with current timestamp */
  set(value: T): void {
    this.val = value;
    this.ts = Date.now();
  }

  /** Set value with explicit timestamp */
  setAt(value: T, timestamp: number): void {
    if (timestamp > this.ts) {
      this.val = value;
      this.ts = timestamp;
    }
  }

  /** Get current value */
  value(): T | null {
    return this.val;
  }

  /** Get timestamp of current value */
  timestamp(): number {
    return this.ts;
  }

  /** Merge: keep value with higher timestamp */
  merge(other: CRDT<T | null>): void {
    if (!(other instanceof LWWRegister)) throw new Error('Can only merge with LWWRegister');
    const otherReg = other as LWWRegister<T>;
    if (otherReg.ts > this.ts) {
      this.val = otherReg.val;
      this.ts = otherReg.ts;
    } else if (otherReg.ts === this.ts && otherReg.nodeId > this.nodeId) {
      // Tie-break by node ID (deterministic)
      this.val = otherReg.val;
      this.ts = otherReg.ts;
    }
  }

  serialize(): any {
    return { type: this.type, nodeId: this.nodeId, value: this.val, timestamp: this.ts };
  }

  clone(): LWWRegister<T> {
    return new LWWRegister<T>(this.nodeId, this.val, this.ts);
  }

  static deserialize<T>(data: any): LWWRegister<T> {
    return new LWWRegister<T>(data.nodeId, data.value, data.timestamp);
  }
}

// ═══════════════════════════════════════
// ORSet — Observed-Remove Set
// ═══════════════════════════════════════

/**
 * Set that supports both add and remove without conflicts.
 * Each element is tagged with a unique ID on add. Remove removes
 * only the observed tags. Concurrent add+remove = element survives.
 */
export class ORSet<T = string> implements CRDT<Set<T>> {
  readonly type = CRDTType.OR_SET;
  /** element (serialized) → Set of unique tags */
  private elements = new Map<string, Set<string>>();
  /** Tombstoned tags (removed) */
  private tombstones = new Set<string>();
  private nodeId: string;
  private tagCounter = 0;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  /** Add an element */
  add(element: T): void {
    const key = JSON.stringify(element);
    const tag = `${this.nodeId}:${++this.tagCounter}:${Date.now()}`;

    if (!this.elements.has(key)) {
      this.elements.set(key, new Set());
    }
    this.elements.get(key)!.add(tag);
  }

  /** Remove an element (removes all observed tags) */
  remove(element: T): void {
    const key = JSON.stringify(element);
    const tags = this.elements.get(key);
    if (tags) {
      for (const tag of tags) {
        this.tombstones.add(tag);
      }
      this.elements.delete(key);
    }
  }

  /** Check if element is in the set */
  has(element: T): boolean {
    const key = JSON.stringify(element);
    const tags = this.elements.get(key);
    if (!tags) return false;
    // Element is present if it has any non-tombstoned tags
    for (const tag of tags) {
      if (!this.tombstones.has(tag)) return true;
    }
    return false;
  }

  /** Get all elements in the set */
  value(): Set<T> {
    const result = new Set<T>();
    for (const [key, tags] of this.elements) {
      for (const tag of tags) {
        if (!this.tombstones.has(tag)) {
          result.add(JSON.parse(key));
          break; // Only need one live tag
        }
      }
    }
    return result;
  }

  /** Number of elements */
  get size(): number {
    return this.value().size;
  }

  /** Merge with another ORSet */
  merge(other: CRDT<Set<T>>): void {
    if (!(other instanceof ORSet)) throw new Error('Can only merge with ORSet');
    const otherSet = other as ORSet<T>;

    // Union elements
    for (const [key, tags] of otherSet.elements) {
      if (!this.elements.has(key)) {
        this.elements.set(key, new Set());
      }
      const myTags = this.elements.get(key)!;
      for (const tag of tags) {
        myTags.add(tag);
      }
    }

    // Union tombstones
    for (const tag of otherSet.tombstones) {
      this.tombstones.add(tag);
    }

    // Clean up: remove elements where all tags are tombstoned
    for (const [key, tags] of this.elements) {
      let hasLive = false;
      for (const tag of tags) {
        if (!this.tombstones.has(tag)) {
          hasLive = true;
          break;
        }
      }
      if (!hasLive) this.elements.delete(key);
    }
  }

  serialize(): any {
    const elements: Record<string, string[]> = {};
    for (const [key, tags] of this.elements) {
      elements[key] = [...tags];
    }
    return {
      type: this.type,
      nodeId: this.nodeId,
      elements,
      tombstones: [...this.tombstones],
      tagCounter: this.tagCounter,
    };
  }

  clone(): ORSet<T> {
    const copy = new ORSet<T>(this.nodeId);
    for (const [key, tags] of this.elements) {
      copy.elements.set(key, new Set(tags));
    }
    copy.tombstones = new Set(this.tombstones);
    copy.tagCounter = this.tagCounter;
    return copy;
  }

  static deserialize<T>(data: any): ORSet<T> {
    const set = new ORSet<T>(data.nodeId);
    for (const [key, tags] of Object.entries(data.elements)) {
      set.elements.set(key, new Set(tags as string[]));
    }
    set.tombstones = new Set(data.tombstones);
    set.tagCounter = data.tagCounter;
    return set;
  }
}

// ═══════════════════════════════════════
// MVRegister — Multi-Value Register
// ═══════════════════════════════════════

/**
 * Register that preserves ALL concurrent writes.
 * Value is an array of all concurrently written values.
 * Merge combines values, resolves via vector clock.
 */
export class MVRegister<T = any> implements CRDT<T[]> {
  readonly type = CRDTType.MV_REGISTER;
  /** Each entry: { value, clock: { nodeId: counter } } */
  private entries: Array<{ value: T; clock: Map<string, number> }> = [];
  private nodeId: string;
  private counter = 0;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  /** Set a value (generates a new vector clock entry) */
  set(value: T): void {
    this.counter++;
    const clock = new Map<string, number>();
    // Include all known clocks + our increment
    for (const entry of this.entries) {
      for (const [nid, cnt] of entry.clock) {
        clock.set(nid, Math.max(clock.get(nid) ?? 0, cnt));
      }
    }
    clock.set(this.nodeId, this.counter);

    // Replace all entries with just this one (our write supersedes our previous writes)
    this.entries = [{ value, clock }];
  }

  /** Get all concurrent values */
  value(): T[] {
    return this.entries.map(e => e.value);
  }

  /** Get single value (first) or null */
  single(): T | null {
    return this.entries.length > 0 ? this.entries[0].value : null;
  }

  /** Merge: keep values that are not dominated by another entry's clock */
  merge(other: CRDT<T[]>): void {
    if (!(other instanceof MVRegister)) throw new Error('Can only merge with MVRegister');
    const otherReg = other as MVRegister<T>;

    const combined = [...this.entries, ...otherReg.entries];

    // Remove dominated entries: entry A dominates B if A's clock >= B's clock for all nodes
    const survivors: typeof combined = [];
    for (let i = 0; i < combined.length; i++) {
      let dominated = false;
      for (let j = 0; j < combined.length; j++) {
        if (i === j) continue;
        if (this.dominates(combined[j].clock, combined[i].clock)) {
          dominated = true;
          break;
        }
      }
      if (!dominated) survivors.push(combined[i]);
    }

    // Deduplicate by value
    const seen = new Set<string>();
    this.entries = [];
    for (const entry of survivors) {
      const key = JSON.stringify(entry.value);
      if (!seen.has(key)) {
        seen.add(key);
        this.entries.push(entry);
      }
    }
  }

  /** Check if clock A strictly dominates clock B */
  private dominates(a: Map<string, number>, b: Map<string, number>): boolean {
    let strictlyGreater = false;
    // A must be >= B for all keys in B
    for (const [nid, cnt] of b) {
      const aCnt = a.get(nid) ?? 0;
      if (aCnt < cnt) return false;
      if (aCnt > cnt) strictlyGreater = true;
    }
    // A must be > B for at least one key
    if (!strictlyGreater) {
      for (const [nid, cnt] of a) {
        if ((b.get(nid) ?? 0) < cnt) {
          strictlyGreater = true;
          break;
        }
      }
    }
    return strictlyGreater;
  }

  serialize(): any {
    return {
      type: this.type,
      nodeId: this.nodeId,
      counter: this.counter,
      entries: this.entries.map(e => ({
        value: e.value,
        clock: Object.fromEntries(e.clock),
      })),
    };
  }

  clone(): MVRegister<T> {
    const copy = new MVRegister<T>(this.nodeId);
    copy.counter = this.counter;
    copy.entries = this.entries.map(e => ({
      value: e.value,
      clock: new Map(e.clock),
    }));
    return copy;
  }

  static deserialize<T>(data: any): MVRegister<T> {
    const reg = new MVRegister<T>(data.nodeId);
    reg.counter = data.counter;
    reg.entries = data.entries.map((e: any) => ({
      value: e.value,
      clock: new Map(Object.entries(e.clock).map(([k, v]) => [k, v as number])),
    }));
    return reg;
  }
}

// ═══════════════════════════════════════
// CRDT Factory
// ═══════════════════════════════════════

export function createCRDT(type: CRDTType, nodeId: string, initialValue?: any): CRDT {
  switch (type) {
    case CRDTType.G_COUNTER:
      return new GCounter(nodeId);
    case CRDTType.PN_COUNTER:
      return new PNCounter(nodeId);
    case CRDTType.LWW_REGISTER: {
      const reg = new LWWRegister(nodeId);
      if (initialValue !== undefined) reg.set(initialValue);
      return reg;
    }
    case CRDTType.OR_SET:
      return new ORSet(nodeId);
    case CRDTType.MV_REGISTER:
      return new MVRegister(nodeId);
    default:
      throw new Error(`Unknown CRDT type: ${type}`);
  }
}

export function deserializeCRDT(data: any): CRDT {
  switch (data.type) {
    case CRDTType.G_COUNTER: return GCounter.deserialize(data);
    case CRDTType.PN_COUNTER: return PNCounter.deserialize(data);
    case CRDTType.LWW_REGISTER: return LWWRegister.deserialize(data);
    case CRDTType.OR_SET: return ORSet.deserialize(data);
    case CRDTType.MV_REGISTER: return MVRegister.deserialize(data);
    default: throw new Error(`Unknown CRDT type: ${data.type}`);
  }
}
