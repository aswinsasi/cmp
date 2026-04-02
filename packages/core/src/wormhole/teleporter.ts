/**
 * CMP v2.0 — Lifeform Teleporter
 *
 * Serializes a Lifeform (soul + CRDT state + genome + CCU balance +
 * synapses + causal history + intents), transmits it through a
 * wormhole node, and reconstitutes it on a remote mesh.
 *
 * This is NOT migration (same mesh, different host).
 * This is TELEPORTATION (different mesh entirely).
 *
 * Key difference from migration:
 *   - Migration: Lifeform moves between hosts in the SAME mesh
 *   - Teleportation: Lifeform moves to a completely DIFFERENT mesh
 *     with its own immune system, reputation, and economic model
 *
 * Sovereignty: each mesh maintains its own rules. A teleported Lifeform
 * starts with fresh reputation on the destination mesh but keeps its
 * CCU balance and full computation history.
 *
 * @module wormhole/teleporter
 * @author Agent Viscro
 */

import {
  TeleportRequest,
  TeleportState,
  TeleportReason,
  TeleportPayload,
  TeleportInitiateWire,
  TeleportAckWire,
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Events ───

export interface TeleportEvent {
  kind: 'initiated' | 'payload_sent' | 'in_transit' | 'ack_received' |
        'complete' | 'failed' | 'incoming';
  teleportId: string;
  lifeformName: string;
  data?: any;
}

// ─── Teleporter ───

export class LifeformTeleporter {
  /** Active outgoing teleports: teleportId → TeleportRequest */
  private outgoing = new Map<string, TeleportRequest>();
  /** Active incoming teleports: teleportId → TeleportPayload */
  private incoming = new Map<string, TeleportPayload>();
  /** Teleport timers */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private config: WormholeConfig;
  private localMeshFingerprint: string;

  /** Listeners */
  private listeners = new Set<(event: TeleportEvent) => void>();

  /** Callback to send teleport through wormhole */
  private sendThroughWormhole: ((wormholeNodeId: string, msgType: number, payload: any) => void) | null = null;

  /** Stats */
  private stats = {
    teleportsInitiated: 0,
    teleportsCompleted: 0,
    teleportsFailed: 0,
    teleportsReceived: 0,
  };

  constructor(localMeshFingerprint: string, config?: Partial<WormholeConfig>) {
    this.localMeshFingerprint = localMeshFingerprint;
    this.config = { ...DEFAULT_WORMHOLE_CONFIG, ...config };
  }

  /** Set transport callback */
  setTransport(fn: (wormholeNodeId: string, msgType: number, payload: any) => void): void {
    this.sendThroughWormhole = fn;
  }

  /** Subscribe to events */
  onEvent(listener: (event: TeleportEvent) => void): void {
    this.listeners.add(listener);
  }

  // ══════════════════════════════════════
  // Outgoing Teleport (send a Lifeform away)
  // ══════════════════════════════════════

  /**
   * Initiate teleportation of a Lifeform to a remote mesh.
   *
   * @param lifeformName - Name of the Lifeform to teleport
   * @param lifeformId - Lifeform ID (hex)
   * @param destMeshFingerprint - Target mesh
   * @param wormholeNodeId - Wormhole to use
   * @param reason - Why teleporting
   * @returns TeleportRequest or null if at capacity
   */
  initiate(
    lifeformName: string,
    lifeformId: string,
    destMeshFingerprint: string,
    wormholeNodeId: string,
    reason: TeleportReason = TeleportReason.MANUAL,
  ): TeleportRequest | null {
    const activeCount = [...this.outgoing.values()].filter(
      t => t.state !== TeleportState.COMPLETE && t.state !== TeleportState.FAILED,
    ).length;

    if (activeCount >= this.config.maxActiveTeleports) return null;

    const request: TeleportRequest = {
      id: `tp-${randomId()}`,
      lifeformName,
      lifeformId,
      sourceMeshFingerprint: this.localMeshFingerprint,
      destMeshFingerprint,
      wormholeNodeId,
      reason,
      state: TeleportState.PREPARING,
      initiatedAt: Date.now(),
    };

    this.outgoing.set(request.id, request);
    this.stats.teleportsInitiated++;

    // Set timeout
    const timer = setTimeout(() => {
      this.failTeleport(request.id, 'Timeout');
    }, this.config.teleportTimeoutMs);
    this.timers.set(request.id, timer);

    this.emit({ kind: 'initiated', teleportId: request.id, lifeformName });
    return request;
  }

  /**
   * Send the teleport payload through the wormhole.
   * Call after preparing the full payload from the Lifeform.
   */
  sendPayload(teleportId: string, payload: TeleportPayload): boolean {
    const request = this.outgoing.get(teleportId);
    if (!request || request.state !== TeleportState.PREPARING) return false;

    request.state = TeleportState.IN_TRANSIT;

    if (this.sendThroughWormhole) {
      // Send initiate first
      this.sendThroughWormhole(request.wormholeNodeId, 0xEE, {
        teleportId: request.id,
        lifeformName: request.lifeformName,
        lifeformId: request.lifeformId,
        sourceMeshFingerprint: request.sourceMeshFingerprint,
        destMeshFingerprint: request.destMeshFingerprint,
        reason: request.reason,
        payloadSizeEstimate: JSON.stringify(payload).length,
        timestamp: Date.now(),
      } as TeleportInitiateWire);

      // Send payload
      this.sendThroughWormhole(request.wormholeNodeId, 0xEF, payload);
    }

    this.emit({ kind: 'payload_sent', teleportId, lifeformName: request.lifeformName });
    return true;
  }

  /**
   * Receive acknowledgement from the destination mesh.
   */
  receiveAck(wire: TeleportAckWire): void {
    const request = this.outgoing.get(wire.teleportId);
    if (!request) return;

    // Clear timeout
    const timer = this.timers.get(wire.teleportId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(wire.teleportId);
    }

    if (wire.success) {
      request.state = TeleportState.COMPLETE;
      request.completedAt = Date.now();
      this.stats.teleportsCompleted++;
      this.emit({
        kind: 'complete', teleportId: wire.teleportId,
        lifeformName: request.lifeformName,
        data: { newHostId: wire.newHostId },
      });
    } else {
      request.state = TeleportState.FAILED;
      this.stats.teleportsFailed++;
      this.emit({
        kind: 'failed', teleportId: wire.teleportId,
        lifeformName: request.lifeformName,
        data: { error: wire.error },
      });
    }
  }

  // ══════════════════════════════════════
  // Incoming Teleport (receive a Lifeform)
  // ══════════════════════════════════════

  /**
   * Receive a teleport payload from a remote mesh.
   * Returns the payload for the caller to reconstitute the Lifeform.
   */
  receivePayload(payload: TeleportPayload): TeleportPayload {
    this.incoming.set(payload.teleportId, payload);
    this.stats.teleportsReceived++;

    this.emit({
      kind: 'incoming', teleportId: payload.teleportId,
      lifeformName: payload.soul.name,
      data: {
        sourceMesh: payload.sourceMeshFingerprint,
        ccuBalance: payload.ccuBalance,
        synapseCount: payload.synapses.length,
      },
    });

    return payload;
  }

  /**
   * Acknowledge a received teleport (send back to source mesh).
   */
  acknowledgeReceived(teleportId: string, success: boolean, newHostId?: string, error?: string): TeleportAckWire {
    const wire: TeleportAckWire = {
      teleportId,
      success,
      newHostId,
      error,
      timestamp: Date.now(),
    };

    // The ack would be sent back through the wormhole by the caller

    return wire;
  }

  // ══════════════════════════════════════
  // Payload Builder
  // ══════════════════════════════════════

  /**
   * Build a teleport payload from Lifeform components.
   * The caller provides the raw data; we package it for transmission.
   */
  buildPayload(
    teleportId: string,
    soul: {
      id: Uint8Array; name: string; publicKey: Uint8Array; secretKey: Uint8Array;
      creatorId: Uint8Array; bornAt: number; generation: number; parentId: Uint8Array | null;
    },
    stateSnapshot: any,
    wasmModule: Uint8Array,
    ccuBalance: number,
    synapses: { targetName: string; targetMeshFingerprint: string; weight: number }[],
    dagSummary: { branchId: string; headHash: string; recentNodes: number; totalCcu: number; totalComputeMs: number },
    intents: any[] = [],
  ): TeleportPayload {
    return {
      teleportId,
      soul: {
        id: toHex(soul.id),
        name: soul.name,
        publicKey: toHex(soul.publicKey),
        secretKey: toHex(soul.secretKey),
        creatorId: toHex(soul.creatorId),
        bornAt: soul.bornAt,
        generation: soul.generation,
        parentId: soul.parentId ? toHex(soul.parentId) : null,
      },
      stateSnapshot,
      wasmModuleB64: Buffer.from(wasmModule).toString('base64'),
      ccuBalance,
      synapses,
      dagSummary,
      intents,
      sourceMeshFingerprint: this.localMeshFingerprint,
      timestamp: Date.now(),
    };
  }

  // ══════════════════════════════════════
  // Query
  // ══════════════════════════════════════

  /** Get outgoing teleport by ID */
  getOutgoing(teleportId: string): TeleportRequest | null {
    return this.outgoing.get(teleportId) || null;
  }

  /** Get incoming payload by ID */
  getIncoming(teleportId: string): TeleportPayload | null {
    return this.incoming.get(teleportId) || null;
  }

  /** Get all active outgoing teleports */
  getActiveOutgoing(): TeleportRequest[] {
    return [...this.outgoing.values()].filter(
      t => t.state !== TeleportState.COMPLETE && t.state !== TeleportState.FAILED,
    );
  }

  /** Get stats */
  getStats() {
    return {
      ...this.stats,
      activeOutgoing: this.getActiveOutgoing().length,
      pendingIncoming: this.incoming.size,
    };
  }

  /** Stop all timers */
  stop(): void {
    for (const [, timer] of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  // ── Internal ──

  private failTeleport(teleportId: string, reason: string): void {
    const request = this.outgoing.get(teleportId);
    if (!request || request.state === TeleportState.COMPLETE || request.state === TeleportState.FAILED) return;

    request.state = TeleportState.FAILED;
    this.stats.teleportsFailed++;
    this.timers.delete(teleportId);
    this.emit({ kind: 'failed', teleportId, lifeformName: request.lifeformName, data: { error: reason } });
  }

  private emit(event: TeleportEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch {}
    }
  }
}
