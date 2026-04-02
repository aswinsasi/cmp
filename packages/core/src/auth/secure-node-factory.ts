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

import { CMPNode, CMPNodeConfig } from '../cmp-node';
import { LANTransport } from '../../../transport/src/lan-transport';
import { MultiTransport } from '../../../transport/src/multi-transport';
import { ITransport } from '../../../transport/src/interface';
import { AuthenticatedTransport } from './authenticated-transport';
import { FlowControlledTransport, FlowControlConfig } from './flow-control';
import { AuthImmuneBridge, AuthImmuneBridgeConfig } from './auth-immune-bridge';
import { generateAuthKeypair, AuthKeypair } from './message-auth';
import { ThreatDetector } from '../immune/threat-detector';
import { QuarantineManager } from '../immune/quarantine-manager';
import { AntibodyGenerator } from '../immune/antibody-generator';

// ─── Config ───

export interface SecureNodeConfig extends CMPNodeConfig {
  /** Auth keypair (auto-generated if not provided) */
  authKeypair?: AuthKeypair;
  /** Flow control config overrides */
  flowControl?: Partial<FlowControlConfig>;
  /** Auth-immune bridge config overrides */
  immuneBridge?: Partial<AuthImmuneBridgeConfig>;
  /** Disable auth (for backward compat testing) */
  disableAuth?: boolean;
  /** Disable flow control */
  disableFlowControl?: boolean;
  /** External transport to wrap (for testing) */
  _rawTransport?: ITransport;
}

// ─── Result ───

export interface SecureNodeResult {
  /** The CMPNode instance */
  node: CMPNode;
  /** The authenticated transport layer (for stats, key access, etc.) */
  auth: AuthenticatedTransport | null;
  /** The flow control layer (for stats, credit management) */
  flowControl: FlowControlledTransport | null;
  /** The auth-immune bridge (for threat monitoring) */
  bridge: AuthImmuneBridge;
  /** The immune system components */
  immune: {
    threatDetector: ThreatDetector;
    quarantineManager: QuarantineManager;
    antibodyGenerator: AntibodyGenerator;
  };
  /** The raw LAN transport (for connectTo, beaconing control) */
  rawLanTransport: LANTransport | null;
  /** The auth keypair used by this node */
  authKeypair: AuthKeypair;
}

/**
 * Create a CMPNode with full security stack.
 *
 * Transport stack (bottom to top):
 *   RAW → FlowControlled → Authenticated → CMPNode
 *
 * Immune wiring:
 *   Auth violations → Bridge → ThreatDetector + QuarantineManager
 */
export function createSecureNode(config: SecureNodeConfig = {}): SecureNodeResult {
  // 1. Create auth keypair
  const authKeypair = config.authKeypair || generateAuthKeypair();

  // 2. Create raw transport
  let rawTransport: ITransport;
  let rawLanTransport: LANTransport | null = null;

  if (config._rawTransport) {
    rawTransport = config._rawTransport;
  } else if (config._transport) {
    rawTransport = config._transport;
  } else {
    const multi = new MultiTransport();
    const transports = config.transports || ['lan'];
    if (transports.includes('lan')) {
      const lan = new LANTransport();
      rawLanTransport = lan;
      multi.register(lan);
    }
    rawTransport = multi;
  }

  // 3. Wrap with flow control
  let flowControl: FlowControlledTransport | null = null;
  let currentTransport: ITransport = rawTransport;

  if (!config.disableFlowControl) {
    flowControl = new FlowControlledTransport(currentTransport, config.flowControl);
    currentTransport = flowControl;
  }

  // 4. Wrap with authentication
  let auth: AuthenticatedTransport | null = null;

  if (!config.disableAuth) {
    auth = new AuthenticatedTransport(currentTransport, authKeypair);
    currentTransport = auth;
  }

  // 5. Create immune system components
  const threatDetector = new ThreatDetector();
  const quarantineManager = new QuarantineManager();
  const antibodyGenerator = new AntibodyGenerator(
    // Use a temporary mesh ID — will be replaced when node starts
    toHex(authKeypair.publicKey.slice(0, 16)),
  );
  quarantineManager.start();

  // 6. Create auth-immune bridge
  const bridge = new AuthImmuneBridge(
    threatDetector,
    quarantineManager,
    antibodyGenerator,
    config.immuneBridge,
  );

  // Wire bridge to auth transport
  if (auth) {
    bridge.connect(auth);
  }

  // 7. Create CMPNode with the wrapped transport
  const nodeConfig: CMPNodeConfig = {
    ...config,
    _transport: currentTransport,
  };

  const node = new CMPNode(nodeConfig);

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
export async function stopSecureNode(result: SecureNodeResult): Promise<void> {
  await result.node.stop();
  result.immune.quarantineManager.stop();
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
