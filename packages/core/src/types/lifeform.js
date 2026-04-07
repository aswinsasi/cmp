"use strict";
/**
 * CMP v1.4 — Lifeform Core Type Definitions
 * Autonomous computational entities that live on the mesh.
 *
 * A Lifeform has:
 *   - Soul: cryptographic identity (Ed25519 keypair + mesh ID)
 *   - Genome: WASM binary defining behavior
 *   - State: CRDT-based replicated state
 *   - Economy: CCU balance for survival
 *
 * @module types/lifeform
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifeformMessageType = exports.LifeformState = void 0;
// ─── Lifeform Lifecycle ───
var LifeformState;
(function (LifeformState) {
    /** Spawning — setting up WASM, state, identity */
    LifeformState["SPAWNING"] = "spawning";
    /** Alive — actively processing causes */
    LifeformState["ALIVE"] = "alive";
    /** Migrating — moving to a different host */
    LifeformState["MIGRATING"] = "migrating";
    /** Fused — merged with another Lifeform (sub-state of ALIVE) */
    LifeformState["FUSED"] = "fused";
    /** Hibernating — paused to save resources */
    LifeformState["HIBERNATING"] = "hibernating";
    /** Dead — terminated, state archived */
    LifeformState["DEAD"] = "dead";
})(LifeformState || (exports.LifeformState = LifeformState = {}));
// ─── Wire Protocol Message Types ───
var LifeformMessageType;
(function (LifeformMessageType) {
    // Core
    LifeformMessageType[LifeformMessageType["LIFEFORM_SPAWN"] = 192] = "LIFEFORM_SPAWN";
    LifeformMessageType[LifeformMessageType["LIFEFORM_SPAWN_ACK"] = 193] = "LIFEFORM_SPAWN_ACK";
    LifeformMessageType[LifeformMessageType["LIFEFORM_CAUSE"] = 194] = "LIFEFORM_CAUSE";
    LifeformMessageType[LifeformMessageType["LIFEFORM_RESPONSE"] = 195] = "LIFEFORM_RESPONSE";
    LifeformMessageType[LifeformMessageType["LIFEFORM_STATE_DELTA"] = 196] = "LIFEFORM_STATE_DELTA";
    LifeformMessageType[LifeformMessageType["LIFEFORM_STATE_ACK"] = 197] = "LIFEFORM_STATE_ACK";
    // Migration
    LifeformMessageType[LifeformMessageType["LIFEFORM_MIGRATE_OFFER"] = 198] = "LIFEFORM_MIGRATE_OFFER";
    LifeformMessageType[LifeformMessageType["LIFEFORM_MIGRATE_ACK"] = 199] = "LIFEFORM_MIGRATE_ACK";
    LifeformMessageType[LifeformMessageType["LIFEFORM_HOST_CHANGE"] = 200] = "LIFEFORM_HOST_CHANGE";
    // Replication
    LifeformMessageType[LifeformMessageType["LIFEFORM_REPLICATE_OFFER"] = 201] = "LIFEFORM_REPLICATE_OFFER";
    LifeformMessageType[LifeformMessageType["LIFEFORM_REPLICA_RELEASE"] = 202] = "LIFEFORM_REPLICA_RELEASE";
    // DNS
    LifeformMessageType[LifeformMessageType["LIFEFORM_DNS_UPDATE"] = 203] = "LIFEFORM_DNS_UPDATE";
    LifeformMessageType[LifeformMessageType["LIFEFORM_DNS_QUERY"] = 204] = "LIFEFORM_DNS_QUERY";
    LifeformMessageType[LifeformMessageType["LIFEFORM_DNS_RESPONSE"] = 205] = "LIFEFORM_DNS_RESPONSE";
    // Synapse
    LifeformMessageType[LifeformMessageType["LIFEFORM_SYNAPSE_OFFER"] = 206] = "LIFEFORM_SYNAPSE_OFFER";
    LifeformMessageType[LifeformMessageType["LIFEFORM_SYNAPSE_ACK"] = 207] = "LIFEFORM_SYNAPSE_ACK";
    // Lifecycle
    LifeformMessageType[LifeformMessageType["LIFEFORM_KILL"] = 208] = "LIFEFORM_KILL";
    LifeformMessageType[LifeformMessageType["LIFEFORM_HEARTBEAT"] = 209] = "LIFEFORM_HEARTBEAT";
    LifeformMessageType[LifeformMessageType["LIFEFORM_CCU_TOPUP"] = 210] = "LIFEFORM_CCU_TOPUP";
    LifeformMessageType[LifeformMessageType["LIFEFORM_QUERY"] = 211] = "LIFEFORM_QUERY";
    // Fusion
    LifeformMessageType[LifeformMessageType["LIFEFORM_FUSION_PROPOSE"] = 212] = "LIFEFORM_FUSION_PROPOSE";
    LifeformMessageType[LifeformMessageType["LIFEFORM_FUSION_ACCEPT"] = 213] = "LIFEFORM_FUSION_ACCEPT";
    LifeformMessageType[LifeformMessageType["LIFEFORM_FUSION_REJECT"] = 214] = "LIFEFORM_FUSION_REJECT";
    LifeformMessageType[LifeformMessageType["LIFEFORM_FUSION_EXECUTE"] = 215] = "LIFEFORM_FUSION_EXECUTE";
    LifeformMessageType[LifeformMessageType["LIFEFORM_FISSION_NOTIFY"] = 216] = "LIFEFORM_FISSION_NOTIFY";
    // Evolution
    LifeformMessageType[LifeformMessageType["LIFEFORM_MUTATE"] = 217] = "LIFEFORM_MUTATE";
    LifeformMessageType[LifeformMessageType["LIFEFORM_GENERATION_RESULT"] = 218] = "LIFEFORM_GENERATION_RESULT";
    // Intent
    LifeformMessageType[LifeformMessageType["LIFEFORM_INTENT_DECLARE"] = 219] = "LIFEFORM_INTENT_DECLARE";
    LifeformMessageType[LifeformMessageType["LIFEFORM_INTENT_REVOKE"] = 220] = "LIFEFORM_INTENT_REVOKE";
    LifeformMessageType[LifeformMessageType["INTENT_SAMPLE_REQUEST"] = 221] = "INTENT_SAMPLE_REQUEST";
    LifeformMessageType[LifeformMessageType["INTENT_SAMPLE_RESPONSE"] = 222] = "INTENT_SAMPLE_RESPONSE";
    LifeformMessageType[LifeformMessageType["INTENT_VIOLATION"] = 223] = "INTENT_VIOLATION";
    // State query
    LifeformMessageType[LifeformMessageType["LIFEFORM_STATE_READ"] = 224] = "LIFEFORM_STATE_READ";
})(LifeformMessageType || (exports.LifeformMessageType = LifeformMessageType = {}));
//# sourceMappingURL=lifeform.js.map