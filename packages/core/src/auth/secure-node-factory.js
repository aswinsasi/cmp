"use strict";
/**
 * CMP v1.5 — Secure Node Factory
 *
 * Creates a fully wired CMPNode with:
 *   - AuthenticatedTransport (Ed25519 frame signing)
 *   - FlowControlledTransport (credit-based backpressure)
 *   - AuthImmuneBridge (auth violations → immune system)
 *
 * Usage:
 *   const { node, auth, flowControl, bridge } = createSecureNode({
 *     transports: ['lan'],
 *   });
 *   await node.start();
 *
 * The factory creates the transport stack:
 *   LANTransport → FlowControlled → Authenticated → CMPNode
 *
 * And wires:
 *   AuthenticatedTransport.onAuthViolation → AuthImmuneBridge → ThreatDetector + QuarantineManager
 *
 * @module auth/secure-node-factory
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSecureNode = createSecureNode;
exports.stopSecureNode = stopSecureNode;
const cmp_node_1 = require("../cmp-node");
const lan_transport_1 = require("../../../transport/src/lan-transport");
const multi_transport_1 = require("../../../transport/src/multi-transport");
const authenticated_transport_1 = require("./authenticated-transport");
const flow_control_1 = require("./flow-control");
const auth_immune_bridge_1 = require("./auth-immune-bridge");
const message_auth_1 = require("./message-auth");
const threat_detector_1 = require("../immune/threat-detector");
const quarantine_manager_1 = require("../immune/quarantine-manager");
const antibody_generator_1 = require("../immune/antibody-generator");
/**
 * Create a CMPNode with full security stack.
 *
 * Transport stack (bottom to top):
 *   RAW → FlowControlled → Authenticated → CMPNode
 *
 * Immune wiring:
 *   Auth violations → Bridge → ThreatDetector + QuarantineManager
 */
function createSecureNode(config = {}) {
    // 1. Create auth keypair
    const authKeypair = config.authKeypair || (0, message_auth_1.generateAuthKeypair)();
    // 2. Create raw transport
    let rawTransport;
    let rawLanTransport = null;
    if (config._rawTransport) {
        rawTransport = config._rawTransport;
    }
    else if (config._transport) {
        rawTransport = config._transport;
    }
    else {
        const multi = new multi_transport_1.MultiTransport();
        const transports = config.transports || ['lan'];
        if (transports.includes('lan')) {
            const lan = new lan_transport_1.LANTransport();
            rawLanTransport = lan;
            multi.register(lan);
        }
        rawTransport = multi;
    }
    // 3. Wrap with flow control
    let flowControl = null;
    let currentTransport = rawTransport;
    if (!config.disableFlowControl) {
        flowControl = new flow_control_1.FlowControlledTransport(currentTransport, config.flowControl);
        currentTransport = flowControl;
    }
    // 4. Wrap with authentication
    let auth = null;
    if (!config.disableAuth) {
        auth = new authenticated_transport_1.AuthenticatedTransport(currentTransport, authKeypair);
        currentTransport = auth;
    }
    // 5. Create immune system components
    const threatDetector = new threat_detector_1.ThreatDetector();
    const quarantineManager = new quarantine_manager_1.QuarantineManager();
    const antibodyGenerator = new antibody_generator_1.AntibodyGenerator(
    // Use a temporary mesh ID — will be replaced when node starts
    toHex(authKeypair.publicKey.slice(0, 16)));
    quarantineManager.start();
    // 6. Create auth-immune bridge
    const bridge = new auth_immune_bridge_1.AuthImmuneBridge(threatDetector, quarantineManager, antibodyGenerator, config.immuneBridge);
    // Wire bridge to auth transport
    if (auth) {
        bridge.connect(auth);
    }
    // 7. Create CMPNode with the wrapped transport
    const nodeConfig = {
        ...config,
        _transport: currentTransport,
    };
    const node = new cmp_node_1.CMPNode(nodeConfig);
    return {
        node,
        auth,
        flowControl,
        bridge,
        immune: { threatDetector, quarantineManager, antibodyGenerator },
        rawLanTransport,
        authKeypair,
    };
}
/**
 * Stop all components of a secure node cleanly.
 */
async function stopSecureNode(result) {
    await result.node.stop();
    result.immune.quarantineManager.stop();
}
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
//# sourceMappingURL=secure-node-factory.js.map