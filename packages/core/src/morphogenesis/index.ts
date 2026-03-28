/**
 * CMP v1.3 — Mesh Morphogenesis
 * Self-organizing sub-meshes ("organs") based on workload affinity.
 *
 * @module morphogenesis
 * @author Agent Viscro
 */

export { AffinityTracker } from './affinity-tracker';
export { OrganManager } from './organ-manager';
export type { OrganEventRecord } from './organ-manager';
export { OrganRouter } from './organ-router';
export type { RouteDecision, OrganRouterConfig } from './organ-router';
export { MorphogenSignaler } from './morphogen-signaler';
