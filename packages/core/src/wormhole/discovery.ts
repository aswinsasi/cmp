/**
 * CMP v2.0 — Wormhole Discovery
 *
 * Discovers and tracks wormhole nodes — devices that bridge two
 * physically separate CMP meshes. A device becomes a wormhole when
 * it has both local mesh connectivity AND internet/WAN connectivity
 * to another mesh.
 *
 * Maintains a directory of known remote meshes with their
 * capabilities (bloom filter), latency, and available wormhole nodes.
 *
 * @module wormhole/discovery
 * @author Agent Viscro
 */

import {
  WormholeNode,
  RemoteMeshEntry,
  WormholeAnnounceWire,
  WormholeDirectoryWire,
  WormholeConfig,
  DEFAULT_WORMHOLE_CONFIG,
} from '../types/wormhole';

function randomId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Simple Bloom Filter ───

export class SimpleBloomFilter {
  private bits: Uint8Array;
  private size: number;

  constructor(sizeBits: number = 256) {
    this.size = sizeBits;
    this.bits = new Uint8Array(Math.ceil(sizeBits / 8));
  }

  add(item: string): void {
    const h1 = this.hash1(item) % this.size;
    const h2 = this.hash2(item) % this.size;
    const h3 = (h1 + h2) % this.size;
    this.setBit(h1);
    this.setBit(h2);
    this.setBit(h3);
  }

  mightContain(item: string): boolean {
    const h1 = this.hash1(item) % this.size;
    const h2 = this.hash2(item) % this.size;
    const h3 = (h1 + h2) % this.size;
    return this.getBit(h1) && this.getBit(h2) && this.getBit(h3);
  }

  toArray(): number[] {
    return Array.from(this.bits);
  }

  static fromArray(arr: number[]): SimpleBloomFilter {
    const bf = new SimpleBloomFilter(arr.length * 8);
    bf.bits = new Uint8Array(arr);
    return bf;
  }

  private setBit(pos: number): void {
    this.bits[pos >> 3] |= (1 << (pos & 7));
  }

  private getBit(pos: number): boolean {
    return (this.bits[pos >> 3] & (1 << (pos & 7))) !== 0;
  }

  private hash1(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0);
  }

  private hash2(s: string): number {
    let h = 0x6789abcd;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h, 31) + s.charCodeAt(i);
    }
    return (h >>> 0);
  }
}

// ─── Events ───

export interface WormholeDiscoveryEvent {
  kind: 'wormhole_found' | 'wormhole_lost' | 'remote_mesh_found' | 'directory_updated';
  wormholeId?: string;
  remoteMeshFingerprint?: string;
}

// ─── Wormhole Discovery ───

export class WormholeDiscovery {
  /** Known wormhole nodes: localMeshId → WormholeNode */
  private wormholes = new Map<string, WormholeNode>();
  /** Known remote meshes: fingerprint → RemoteMeshEntry */
  private remoteMeshes = new Map<string, RemoteMeshEntry>();
  /** Is this node itself a wormhole? */
  private isWormhole = false;
  /** Our local mesh fingerprint */
  private localMeshFingerprint: string;
  /** Capability bloom filter for our local mesh */
  private localCapabilities: SimpleBloomFilter;

  private config: WormholeConfig;
  private deviceId: string;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Listeners */
  private listeners = new Set<(event: WormholeDiscoveryEvent) => void>();

  /** Broadcast callback */
  private onBroadcast: ((wire: WormholeAnnounceWire) => void) | null = null;

  /** Stats */
  private stats = {
    wormholesDiscovered: 0,
    wormholesLost: 0,
    remoteMeshesKnown: 0,
    directorySyncs: 0,
  };

  constructor(deviceId: string, localMeshFingerprint: string, config?: Partial<WormholeConfig>) {
    this.deviceId = deviceId;
    this.localMeshFingerprint = localMeshFingerprint;
    this.config = { ...DEFAULT_WORMHOLE_CONFIG, ...config };
    this.localCapabilities = new SimpleBloomFilter(this.config.bloomFilterSize);
  }

  /** Start periodic cleanup */
  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.wormholeTimeoutMs);
  }

  /** Stop */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Subscribe to events */
  onEvent(listener: (event: WormholeDiscoveryEvent) => void): void {
    this.listeners.add(listener);
  }

  /** Set broadcast callback */
  setBroadcast(fn: (wire: WormholeAnnounceWire) => void): void {
    this.onBroadcast = fn;
  }

  // ── Wormhole Registration ──

  /**
   * Declare this node as a wormhole to a remote mesh.
   * Call when this device has connectivity to another CMP mesh.
   */
  declareWormhole(remoteMeshFingerprint: string, remoteMeshLabel: string, latencyMs: number): void {
    this.isWormhole = true;

    const node: WormholeNode = {
      localMeshId: this.deviceId,
      remoteMeshFingerprint,
      remoteMeshLabel,
      quality: this.calculateQuality(latencyMs),
      latencyMs,
      discoveredAt: Date.now(),
      lastSeenAt: Date.now(),
      active: true,
    };

    this.wormholes.set(this.deviceId, node);
    this.registerRemoteMesh(remoteMeshFingerprint, remoteMeshLabel, this.deviceId, latencyMs, []);

    // Announce to local mesh
    if (this.onBroadcast) {
      this.onBroadcast({
        localMeshId: this.deviceId,
        remoteMeshFingerprint,
        remoteMeshLabel,
        quality: node.quality,
        latencyMs,
        capabilityBloom: this.localCapabilities.toArray(),
        timestamp: Date.now(),
      });
    }

    this.emit({ kind: 'wormhole_found', wormholeId: this.deviceId, remoteMeshFingerprint });
  }

  /**
   * Receive a wormhole announcement from a peer.
   */
  receiveAnnounce(wire: WormholeAnnounceWire): void {
    // Don't process our own announcements
    if (wire.localMeshId === this.deviceId) return;

    const existing = this.wormholes.get(wire.localMeshId);
    const isNew = !existing;

    const node: WormholeNode = {
      localMeshId: wire.localMeshId,
      remoteMeshFingerprint: wire.remoteMeshFingerprint,
      remoteMeshLabel: wire.remoteMeshLabel,
      quality: wire.quality,
      latencyMs: wire.latencyMs,
      discoveredAt: existing?.discoveredAt || Date.now(),
      lastSeenAt: Date.now(),
      active: true,
    };

    this.wormholes.set(wire.localMeshId, node);
    this.registerRemoteMesh(
      wire.remoteMeshFingerprint, wire.remoteMeshLabel,
      wire.localMeshId, wire.latencyMs, wire.capabilityBloom,
    );

    if (isNew) {
      this.stats.wormholesDiscovered++;
      this.emit({ kind: 'wormhole_found', wormholeId: wire.localMeshId, remoteMeshFingerprint: wire.remoteMeshFingerprint });
    }
  }

  /**
   * Receive a directory update from a peer.
   */
  receiveDirectory(wire: WormholeDirectoryWire): void {
    for (const entry of wire.entries) {
      this.registerRemoteMesh(
        entry.fingerprint, entry.fingerprint,
        wire.senderId, entry.bestLatencyMs, entry.capabilityBloom,
      );
    }
    this.stats.directorySyncs++;
    this.emit({ kind: 'directory_updated' });
  }

  // ── Query ──

  /** Get all known wormholes */
  getWormholes(): WormholeNode[] {
    return [...this.wormholes.values()].filter(w => w.active);
  }

  /** Get wormholes connecting to a specific remote mesh */
  getWormholesTo(remoteMeshFingerprint: string): WormholeNode[] {
    return this.getWormholes().filter(w => w.remoteMeshFingerprint === remoteMeshFingerprint);
  }

  /** Get the best wormhole to a remote mesh (highest quality) */
  getBestWormholeTo(remoteMeshFingerprint: string): WormholeNode | null {
    const candidates = this.getWormholesTo(remoteMeshFingerprint)
      .filter(w => w.quality >= this.config.minWormholeQuality);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, w) => w.quality > best.quality ? w : best);
  }

  /** Get all known remote meshes */
  getRemoteMeshes(): RemoteMeshEntry[] {
    return [...this.remoteMeshes.values()];
  }

  /** Get a remote mesh by fingerprint */
  getRemoteMesh(fingerprint: string): RemoteMeshEntry | null {
    return this.remoteMeshes.get(fingerprint) || null;
  }

  /** Check if a remote mesh likely has a specific capability */
  remoteHasCapability(fingerprint: string, capability: string): boolean {
    const mesh = this.remoteMeshes.get(fingerprint);
    if (!mesh || mesh.capabilityBloom.length === 0) return false;
    const bloom = SimpleBloomFilter.fromArray(mesh.capabilityBloom);
    return bloom.mightContain(capability);
  }

  /** Is this node a wormhole? */
  isWormholeNode(): boolean {
    return this.isWormhole;
  }

  /** Add a capability to our local mesh's bloom filter */
  addLocalCapability(capability: string): void {
    this.localCapabilities.add(capability);
  }

  /** Get our local mesh fingerprint */
  getLocalMeshFingerprint(): string {
    return this.localMeshFingerprint;
  }

  /** Get stats */
  getStats() {
    return {
      ...this.stats,
      activeWormholes: this.getWormholes().length,
      remoteMeshesKnown: this.remoteMeshes.size,
      isWormhole: this.isWormhole,
    };
  }

  // ── Internal ──

  private registerRemoteMesh(
    fingerprint: string, label: string,
    wormholeNodeId: string, latencyMs: number, capabilityBloom: number[],
  ): void {
    // Don't register our own mesh
    if (fingerprint === this.localMeshFingerprint) return;

    if (this.remoteMeshes.size >= this.config.maxRemoteMeshes && !this.remoteMeshes.has(fingerprint)) {
      return; // At capacity
    }

    let entry = this.remoteMeshes.get(fingerprint);
    const isNew = !entry;

    if (!entry) {
      entry = {
        fingerprint,
        label,
        wormholeNodes: [],
        estimatedPeers: 0,
        bestLatencyMs: latencyMs,
        capabilityBloom,
        firstSeen: Date.now(),
        lastUpdated: Date.now(),
      };
      this.remoteMeshes.set(fingerprint, entry);
    }

    // Update wormhole nodes
    if (!entry.wormholeNodes.includes(wormholeNodeId)) {
      entry.wormholeNodes.push(wormholeNodeId);
    }

    // Update best latency
    if (latencyMs < entry.bestLatencyMs) {
      entry.bestLatencyMs = latencyMs;
    }

    // Update bloom filter if provided
    if (capabilityBloom.length > 0) {
      entry.capabilityBloom = capabilityBloom;
    }

    entry.lastUpdated = Date.now();

    if (isNew) {
      this.stats.remoteMeshesKnown++;
      this.emit({ kind: 'remote_mesh_found', remoteMeshFingerprint: fingerprint });
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, wormhole] of this.wormholes) {
      if (now - wormhole.lastSeenAt > this.config.wormholeTimeoutMs) {
        wormhole.active = false;
        this.stats.wormholesLost++;
        this.emit({ kind: 'wormhole_lost', wormholeId: id });
      }
    }
  }

  private calculateQuality(latencyMs: number): number {
    // Quality degrades with latency: 100ms → 0.9, 500ms → 0.5, 1000ms → 0.2
    return Math.max(0.1, 1.0 - (latencyMs / 1200));
  }

  private emit(event: WormholeDiscoveryEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
  }
}
