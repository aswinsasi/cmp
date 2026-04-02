/**
 * CMP v1.5 — Authentication, Flow Control & Immune Bridge Module
 *
 * Phase A exports:
 *   - Message signing/verification (Ed25519)
 *   - Authenticated transport wrapper
 *   - Credit-based flow control
 *   - Peer key registry (TOFU)
 *
 * Phase B exports:
 *   - Auth-immune bridge
 *   - Secure node factory
 *
 * @module auth
 * @author Agent Viscro
 */

// ── Phase A ──

export {
  generateAuthKeypair,
  signFrame,
  verifyFrame,
  hasAuthTrailer,
  AUTH_TRAILER_SIZE,
  PUBKEY_SIZE,
  SIGNATURE_SIZE,
  MIN_AUTH_FRAME_SIZE,
  PeerKeyRegistry,
  type AuthKeypair,
  type VerifyResult,
  type PeerKeyEntry,
} from './message-auth';

export {
  AuthenticatedTransport,
  type AuthTransportStats,
  type AuthViolationEvent,
  type AuthViolationHandler,
} from './authenticated-transport';

export {
  FlowControlledTransport,
  type FlowControlConfig,
  type FlowControlStats,
} from './flow-control';

// ── Phase B ──

export {
  AuthImmuneBridge,
  type AuthImmuneBridgeConfig,
  type AuthImmuneBridgeStats,
} from './auth-immune-bridge';

export {
  createSecureNode,
  stopSecureNode,
  type SecureNodeConfig,
  type SecureNodeResult,
} from './secure-node-factory';
