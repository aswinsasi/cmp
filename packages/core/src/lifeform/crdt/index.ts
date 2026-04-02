/**
 * CMP v1.4 — CRDT Module
 * @module lifeform/crdt
 */

export {
  CRDT, CRDTType,
  GCounter, PNCounter, LWWRegister, ORSet, MVRegister,
  createCRDT, deserializeCRDT,
} from './crdts';

export { CRDTState } from './crdt-state';
export type { StateDelta, StateSnapshot } from './crdt-state';
