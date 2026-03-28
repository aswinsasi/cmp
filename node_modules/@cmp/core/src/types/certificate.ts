/**
 * CMP Certificate Types
 * Layer 7: Computation Certificate — cryptographic proof that
 * multiple independent devices produced identical results.
 *
 * A Computation Certificate is a standalone, verifiable document
 * proving a distributed computation was performed correctly.
 * It requires no blockchain, no trusted hardware, no ZK proofs —
 * only independent device agreement with Ed25519 signatures.
 *
 * @module types/certificate
 * @author Agent Viscro
 */

import { TaskId, MeshId, Hash256, Signature } from './primitives';

/**
 * Per-device attestation within a certificate.
 * Each device that executed the computation signs an attestation
 * proving it ran the specified code on the specified input and
 * produced the specified output.
 */
export interface DeviceAttestation {
  /** Device mesh ID (random per session, not device-persistent) */
  meshId: MeshId;
  /** Ed25519 public key of this device */
  publicKey: Uint8Array;
  /** CPU architecture (e.g., 'ARM64', 'x86_64') */
  architecture: string;
  /** CPU cores used */
  cores: number;
  /** Memory available (MB) */
  memoryMb: number;
  /** Execution time on this device (ms) */
  executionTimeMs: number;
  /** Peak memory usage during execution (MB) */
  memoryPeakMb: number;
  /** SHA-256 hash of the output this device produced */
  outputHash: Hash256;
  /** Timestamp when execution completed */
  completedAt: number;
  /**
   * Ed25519 signature over the canonical attestation payload:
   * SHA-256(certId + codeHash + inputHash + outputHash + timestamp)
   *
   * This signature proves this specific device, with this specific key,
   * computed this specific result from this specific code and input.
   */
  signature: Signature;
}

/**
 * Computation Certificate — the core document.
 *
 * Proves that N independent devices ran identical code on identical input
 * and produced identical output. Verifiable by anyone with the certificate
 * alone — no external service, no blockchain, no trusted hardware needed.
 */
export interface ComputationCertificate {
  /** Certificate version */
  version: '1.0';

  /** Unique certificate ID */
  certId: string;

  // ── What was computed ──

  /** SHA-256 hash of the WASM module that was executed */
  codeHash: Hash256;
  /** Entry point function name */
  entryPoint: string;
  /** SHA-256 hash of the input data */
  inputHash: Hash256;
  /** SHA-256 hash of the output data (all devices must agree on this) */
  outputHash: Hash256;
  /** The actual output data (optional — may be omitted for privacy) */
  outputData?: Uint8Array;

  // ── How it was computed ──

  /** Task decomposition strategy used */
  strategy: string;
  /** Verification mode (REDUNDANT, CHECKSUM, etc.) */
  verificationMode: string;
  /** Total chunks the task was split into */
  totalChunks: number;
  /** Total time from submission to completion (ms) */
  totalTimeMs: number;

  // ── Who computed it ──

  /** Number of independent devices that attested */
  deviceCount: number;
  /** Individual device attestations with signatures */
  attestations: DeviceAttestation[];

  // ── Consensus ──

  /**
   * Consensus result: what fraction of devices agreed.
   * 1.0 = unanimous (all devices produced identical output hashes)
   */
  consensus: number;
  /** Number of unique CPU architectures represented */
  uniqueArchitectures: number;
  /** Whether all attestation signatures are valid */
  signaturesValid: boolean;

  // ── Metadata ──

  /** When the certificate was generated */
  issuedAt: number;
  /** Mesh ID of the node that requested the computation */
  requesterId: MeshId;
  /** CMP protocol version */
  protocolVersion: string;

  /**
   * Requester's signature over the entire certificate.
   * This binds the requester to the certificate — they attest
   * that they received and accepted this result.
   */
  requesterSignature: Signature;
}

/**
 * Certificate verification result.
 */
export interface CertificateVerification {
  /** Whether the certificate is valid */
  valid: boolean;
  /** Number of valid attestation signatures */
  validSignatures: number;
  /** Total attestation signatures */
  totalSignatures: number;
  /** Whether all devices agreed on the output */
  consensusValid: boolean;
  /** Consensus ratio (0.0 - 1.0) */
  consensusRatio: number;
  /** Number of unique architectures */
  uniqueArchitectures: number;
  /** Human-readable summary */
  summary: string;
  /** Any issues found */
  issues: string[];
}