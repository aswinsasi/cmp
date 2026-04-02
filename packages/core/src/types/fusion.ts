/**
 * CMP v1.4 — Computational Fusion/Fission Types
 * Two Lifeforms can MERGE into a single composite entity (Fusion)
 * and later SPLIT back (Fission). Completely unprecedented in computing.
 *
 * Fusion merges: CRDT state, WASM genomes, identities, CCU balances.
 * The composite can do things NEITHER component could alone.
 *
 * @module types/fusion
 * @author Agent Viscro
 */

import { LifeformSoul } from './lifeform';

// ─── Fusion Proposal ───

export interface FusionProposal {
  /** Unique proposal ID (16 bytes) */
  id: Uint8Array;
  /** Proposing Lifeform ID */
  proposerId: Uint8Array;
  /** Target Lifeform to fuse with */
  targetId: Uint8Array;
  /** Proposed fusion configuration */
  fusionConfig: FusionConfig;
  /** Proposer's Ed25519 signature */
  proposerSignature: Uint8Array;     // 64 bytes
  /** Timestamp */
  proposedAt: number;
  /** Expiry (target must respond by this time) */
  expiresAt: number;
}

// ─── Fusion Configuration ───

export interface FusionConfig {
  /** Name for the composite entity */
  compositeName: string;
  /** How to handle state key conflicts */
  stateConflictStrategy: StateConflictStrategy;
  /** CCU contribution ratio (e.g., 0.5 = each contributes equally) */
  ccuContributionRatio: number;
  /** Which genome is "primary" (executes first on each cause) */
  primaryGenome: 'proposer' | 'target';
  /** Conditions under which automatic fission should occur */
  fissionTriggers: FissionTrigger[];
  /** Maximum fusion duration (0 = permanent until explicit fission) */
  maxFusionDurationMs: number;
}

export enum StateConflictStrategy {
  /** Keep the CRDT value with higher timestamp */
  TIMESTAMP_WINS = 'timestamp_wins',
  /** Prefix all keys with original Lifeform name */
  NAMESPACE_PREFIX = 'namespace_prefix',
  /** Merge CRDTs directly (only works if same CRDT type) */
  CRDT_MERGE = 'crdt_merge',
}

export enum FissionTrigger {
  /** Split when load drops below threshold */
  LOW_LOAD = 'low_load',
  /** Split when CCU balance drops below threshold */
  LOW_CCU = 'low_ccu',
  /** Split after a fixed duration */
  DURATION_EXPIRED = 'duration_expired',
  /** Split when an intent is satisfied */
  INTENT_SATISFIED = 'intent_satisfied',
  /** Manual fission only */
  MANUAL_ONLY = 'manual_only',
}

// ─── Composite Identity ───

export interface CompositeSoul {
  /** New composite ID: SHA-256(componentA.id + componentB.id)[0:16] */
  compositeId: Uint8Array;
  /** Component Lifeform Souls */
  components: [LifeformSoul, LifeformSoul];
  /** Composite Ed25519 keypair */
  compositePublicKey: Uint8Array;    // 32 bytes
  compositeSecretKey: Uint8Array;    // 64 bytes
  /** Both component signatures agreeing to fusion */
  componentSignatures: [Uint8Array, Uint8Array];
  /** Fusion timestamp */
  fusedAt: number;
  /** Fusion configuration */
  fusionConfig: FusionConfig;
}

// ─── Composite Genome ───

export interface CompositeGenome {
  /** Both WASM module hashes */
  moduleHashes: [Uint8Array, Uint8Array];
  /** Execution order */
  executionOrder: 'a_first' | 'b_first' | 'parallel';
  /** Shared state namespace mappings */
  stateNamespaces: {
    componentA: string;   // e.g., "sensor" — keys prefixed with "sensor."
    componentB: string;   // e.g., "processor" — keys prefixed with "processor."
    shared: string;       // e.g., "shared" — both can read/write
  };
}

// ─── Fission Result ───

export interface FissionResult {
  /** Original composite ID */
  compositeId: Uint8Array;
  /** Restored component A */
  componentA: {
    id: Uint8Array;
    ccuBalance: number;
    stateKeys: string[];
  };
  /** Restored component B */
  componentB: {
    id: Uint8Array;
    ccuBalance: number;
    stateKeys: string[];
  };
  /** Fission timestamp */
  fissionedAt: number;
  /** Trigger that caused fission */
  trigger: FissionTrigger | 'manual';
}
