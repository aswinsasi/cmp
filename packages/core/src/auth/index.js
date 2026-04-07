"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopSecureNode = exports.createSecureNode = exports.AuthImmuneBridge = exports.FlowControlledTransport = exports.AuthenticatedTransport = exports.PeerKeyRegistry = exports.MIN_AUTH_FRAME_SIZE = exports.SIGNATURE_SIZE = exports.PUBKEY_SIZE = exports.AUTH_TRAILER_SIZE = exports.hasAuthTrailer = exports.verifyFrame = exports.signFrame = exports.generateAuthKeypair = void 0;
// ── Phase A ──
var message_auth_1 = require("./message-auth");
Object.defineProperty(exports, "generateAuthKeypair", { enumerable: true, get: function () { return message_auth_1.generateAuthKeypair; } });
Object.defineProperty(exports, "signFrame", { enumerable: true, get: function () { return message_auth_1.signFrame; } });
Object.defineProperty(exports, "verifyFrame", { enumerable: true, get: function () { return message_auth_1.verifyFrame; } });
Object.defineProperty(exports, "hasAuthTrailer", { enumerable: true, get: function () { return message_auth_1.hasAuthTrailer; } });
Object.defineProperty(exports, "AUTH_TRAILER_SIZE", { enumerable: true, get: function () { return message_auth_1.AUTH_TRAILER_SIZE; } });
Object.defineProperty(exports, "PUBKEY_SIZE", { enumerable: true, get: function () { return message_auth_1.PUBKEY_SIZE; } });
Object.defineProperty(exports, "SIGNATURE_SIZE", { enumerable: true, get: function () { return message_auth_1.SIGNATURE_SIZE; } });
Object.defineProperty(exports, "MIN_AUTH_FRAME_SIZE", { enumerable: true, get: function () { return message_auth_1.MIN_AUTH_FRAME_SIZE; } });
Object.defineProperty(exports, "PeerKeyRegistry", { enumerable: true, get: function () { return message_auth_1.PeerKeyRegistry; } });
var authenticated_transport_1 = require("./authenticated-transport");
Object.defineProperty(exports, "AuthenticatedTransport", { enumerable: true, get: function () { return authenticated_transport_1.AuthenticatedTransport; } });
var flow_control_1 = require("./flow-control");
Object.defineProperty(exports, "FlowControlledTransport", { enumerable: true, get: function () { return flow_control_1.FlowControlledTransport; } });
// ── Phase B ──
var auth_immune_bridge_1 = require("./auth-immune-bridge");
Object.defineProperty(exports, "AuthImmuneBridge", { enumerable: true, get: function () { return auth_immune_bridge_1.AuthImmuneBridge; } });
var secure_node_factory_1 = require("./secure-node-factory");
Object.defineProperty(exports, "createSecureNode", { enumerable: true, get: function () { return secure_node_factory_1.createSecureNode; } });
Object.defineProperty(exports, "stopSecureNode", { enumerable: true, get: function () { return secure_node_factory_1.stopSecureNode; } });
//# sourceMappingURL=index.js.map