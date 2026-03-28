/**
 * CMP v1.3 — Precognition Module (Layer 9)
 * Speculative pre-computation during idle periods.
 *
 * @module precognition
 * @author Agent Viscro
 */

export { PhantomCache } from './phantom-cache';
export { MispredictionTracker } from './misprediction-tracker';
export { DreamScheduler } from './dream-scheduler';
export { ConfirmationShortcut } from './confirmation-shortcut';
export type { ShortcutResult, ConfirmationShortcutConfig } from './confirmation-shortcut';
export { SpeculativeDistributor } from './speculative-distributor';
export type { IdlePeerInfo } from './speculative-distributor';
