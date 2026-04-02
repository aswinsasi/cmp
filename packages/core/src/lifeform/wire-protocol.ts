/**
 * CMP v1.4 — Lifeform Wire Protocol
 * Serialization/deserialization for all 33 Lifeform message types.
 * Uses JSON encoding over the existing CMP Frame format (16-byte header).
 *
 * Messages are encoded as CMP Frames with type in the 0xC0-0xE0 range.
 * Payload is JSON for v1.4 (binary optimization in v1.5).
 *
 * @module lifeform/wire-protocol
 * @author Agent Viscro
 */

import { LifeformMessageType } from '../types/lifeform';

// ─── Message Payloads ───

export interface SpawnMessage {
  name: string;
  wasmModuleHash: string;       // hex
  initialCcu: number;
  minReplicas: number;
  maxReplicas: number;
  spawnerId: string;            // hex
  preferredHost: string | null; // hex
  initialState: Record<string, any>;
}

export interface SpawnAckMessage {
  name: string;
  lifeformId: string;           // hex
  hostId: string;               // hex
  success: boolean;
  error?: string;
}

export interface CauseMessage {
  causeId: string;              // hex
  type: string;                 // CauseType
  chainId: string;              // hex
  chainDepth: number;
  maxChainDepth: number;
  deadlineMs: number;
  sourceId: string;             // hex
  sourceType: string;
  targetName: string;           // Lifeform name (resolved via DNS)
  payload: string;              // base64
  ccuAttached: number;
  expectsResponse: boolean;
  correlationId: string | null; // hex
  emittedAt: number;
}

export interface ResponseMessage {
  correlationId: string;        // hex
  targetName: string;
  payload: string;              // base64
  success: boolean;
  error?: string;
}

export interface StateDeltaMessage {
  lifeformId: string;           // hex
  deltaSequence: number;
  changedKeys: string[];
  changes: Record<string, any>;
  extractedAt: number;
}

export interface StateAckMessage {
  lifeformId: string;           // hex
  deltaSequence: number;
  accepted: boolean;
}

export interface MigrateOfferMessage {
  migrationId: string;          // hex
  lifeformId: string;           // hex
  lifeformName: string;
  fromHostId: string;           // hex
  reason: string;
  stateSize: number;
  genomeHash: string;           // hex
  ccuBalance: number;
}

export interface MigrateAckMessage {
  migrationId: string;          // hex
  accepted: boolean;
  error?: string;
}

export interface HostChangeMessage {
  lifeformName: string;
  oldHostId: string;            // hex
  newHostId: string;            // hex
}

export interface DNSUpdateMessage {
  name: string;
  lifeformId: string;           // hex
  hostId: string;               // hex
  replicaHostIds: string[];     // hex[]
  redirect: string | null;
  version: number;
}

export interface DNSQueryMessage {
  pattern: string;
  requesterId: string;          // hex
}

export interface DNSResponseMessage {
  records: Array<{
    name: string;
    lifeformId: string;
    hostId: string;
    redirect: string | null;
  }>;
}

export interface SynapseOfferMessage {
  fromName: string;
  toName: string;
  initialStrength: number;
}

export interface SynapseAckMessage {
  fromName: string;
  toName: string;
  accepted: boolean;
}

export interface FusionProposeMessage {
  proposalId: string;           // hex
  proposerName: string;
  targetName: string;
  compositeName: string;
  stateConflictStrategy: string;
  ccuContributionRatio: number;
  primaryGenome: string;
  maxFusionDurationMs: number;
  expiresAt: number;
}

export interface FusionAcceptMessage {
  proposalId: string;           // hex
  targetName: string;
}

export interface FusionRejectMessage {
  proposalId: string;           // hex
  targetName: string;
  reason: string;
}

export interface IntentDeclareMessage {
  intentId: string;             // hex
  lifeformName: string;
  description: string;
  predicate: any;               // IntentPredicate
  sampleIntervalMs: number;
  samplesPerInterval: number;
  violationAction: string;
  ccuStaked: number;
  expiresAt: number;
}

// ─── Encoder / Decoder ───

/**
 * Encode a Lifeform message payload to bytes.
 * Uses JSON encoding over the wire.
 */
export function encodeLifeformMessage(type: LifeformMessageType, payload: any): Uint8Array {
  const json = JSON.stringify({ msgType: type, ...payload });
  return new TextEncoder().encode(json);
}

/**
 * Decode a Lifeform message payload from bytes.
 * Returns { type, ...payload } or null if invalid.
 */
export function decodeLifeformMessage(data: Uint8Array): { type: LifeformMessageType; [key: string]: any } | null {
  try {
    const json = new TextDecoder().decode(data);
    const parsed = JSON.parse(json);
    if (typeof parsed.msgType !== 'number') return null;
    const { msgType, ...rest } = parsed;
    return { ...rest, type: msgType };
  } catch {
    return null;
  }
}

/**
 * Check if a message type code is in the Lifeform range (0xC0-0xE0).
 */
export function isLifeformMessage(typeCode: number): boolean {
  return typeCode >= 0xC0 && typeCode <= 0xE0;
}

/**
 * Get human-readable name for a Lifeform message type.
 */
export function lifeformMessageName(type: LifeformMessageType): string {
  const names: Record<number, string> = {
    0xC0: 'SPAWN',
    0xC1: 'SPAWN_ACK',
    0xC2: 'CAUSE',
    0xC3: 'RESPONSE',
    0xC4: 'STATE_DELTA',
    0xC5: 'STATE_ACK',
    0xC6: 'MIGRATE_OFFER',
    0xC7: 'MIGRATE_ACK',
    0xC8: 'HOST_CHANGE',
    0xC9: 'REPLICATE_OFFER',
    0xCA: 'REPLICA_RELEASE',
    0xCB: 'DNS_UPDATE',
    0xCC: 'DNS_QUERY',
    0xCD: 'DNS_RESPONSE',
    0xCE: 'SYNAPSE_OFFER',
    0xCF: 'SYNAPSE_ACK',
    0xD0: 'KILL',
    0xD1: 'HEARTBEAT',
    0xD2: 'CCU_TOPUP',
    0xD3: 'QUERY',
    0xD4: 'FUSION_PROPOSE',
    0xD5: 'FUSION_ACCEPT',
    0xD6: 'FUSION_REJECT',
    0xD7: 'FUSION_EXECUTE',
    0xD8: 'FISSION_NOTIFY',
    0xD9: 'MUTATE',
    0xDA: 'GENERATION_RESULT',
    0xDB: 'INTENT_DECLARE',
    0xDC: 'INTENT_REVOKE',
    0xDD: 'INTENT_SAMPLE_REQ',
    0xDE: 'INTENT_SAMPLE_RES',
    0xDF: 'INTENT_VIOLATION',
    0xE0: 'STATE_READ',
  };
  return names[type] ?? `UNKNOWN(0x${type.toString(16)})`;
}
