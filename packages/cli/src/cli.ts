#!/usr/bin/env npx tsx
/**
 * CMP CLI — Interactive Mesh Node
 *
 * Real distributed computation demo:
 *   encrypt <message>  → Mesh encrypts your text using WASM XOR cipher
 *   decrypt <hex>      → Mesh decrypts ciphertext back to plaintext
 *   compute            → Send raw data to mesh
 *   peers / status     → Mesh info
 *
 * @author Agent Viscro
 */

import fs from 'fs';
import readline from 'readline';
import { CMPNode } from '../../core/src/cmp-node';
import { LogLevel, Logger, toHex, shortId, TaskType } from '../../core/src';
import type { CMP_MER } from '../../core/src/types/mcl';
import { DecompositionStrategy } from '../../core/src/types/mcl';
import { V2Bridge } from '../../core/src/v2-bridge';
import { doConsciousness, doSpacetime, doWormhole, doV2Status, v2HelpText } from './v2-cli-commands';
import { doV3Command, v3HelpText } from './v3-cli-commands';

const VERSION = '1.2.0';
const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

// Active readline instance (set during interactive mode)
let activeRL: readline.Interface | null = null;

function log(icon: string, color: string, msg: string, detail?: string): void {
  const t = new Date().toISOString().substring(11, 19);
  const line = `  ${C.d}${t}${C.r} ${color}${icon}${C.r} ${msg}${detail ? `  ${C.d}${detail}${C.r}` : ''}`;

  if (activeRL) {
    // Clear current input line, print event, restore prompt
    process.stdout.write('\r\x1b[K'); // clear line
    console.log(line);
    activeRL.prompt(true); // restore prompt without newline
  } else {
    console.log(line);
  }
}

// ── Real WASM XOR Cipher Module (104 bytes) ──
// Exports: memory, encrypt(ptr, len) -> len
// XORs each byte with 0x42. Apply twice to decrypt.
const ENCRYPT_WASM = new Uint8Array([
  0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,5,3,1,0,1,
  7,20,2,6,109,101,109,111,114,121,2,0,7,101,110,99,114,121,112,116,0,0,
  10,54,1,52,1,1,127,65,0,33,2,2,64,3,64,32,2,32,1,79,13,1,32,0,32,2,
  106,32,0,32,2,106,45,0,0,65,194,0,115,58,0,0,32,2,65,1,106,33,2,12,
  0,11,11,32,1,11
]);

// ── Args ──
const args = process.argv.slice(2);
const command = args[0] || 'help';
function getFlag(n: string): boolean { return args.includes(`--${n}`); }
function getNumOpt(n: string, d: number): number {
  const i = args.indexOf(`--${n}`); return i !== -1 && i + 1 < args.length ? parseInt(args[i + 1], 10) : d;
}
function getStrOpt(n: string, d: string): string {
  const i = args.indexOf(`--${n}`); return i !== -1 && i + 1 < args.length ? args[i + 1] : d;
}

// ══════════════════════════════════════════════
// START: Interactive node
// ══════════════════════════════════════════════

async function cmdStart(): Promise<void> {
  console.log(`
  ${C.cyan}\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557${C.r}
  ${C.cyan}\u2551${C.r}  ${C.b}CMP${C.r} \u2014 Compute Mesh Protocol v${VERSION}      ${C.cyan}\u2551${C.r}
  ${C.cyan}\u2551${C.r}  ${C.d}Agent Viscro${C.r}                             ${C.cyan}\u2551${C.r}
  ${C.cyan}\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d${C.r}
`);

  const verbose = getFlag('verbose');
  const share = getNumOpt('share', 50);
  const useBle = getFlag('ble');
  const useWebrtc = getFlag('webrtc');
  const signalUrl = getStrOpt('signal', '');
  Logger.setLevel(verbose ? LogLevel.DEBUG : LogLevel.INFO);

  let transport: any = undefined;
  let transportLabel = 'LAN';
  let webrtcTransport: any = null; // Keep reference for REPL commands

  if (useBle) {
    try {
      const { BLETransport } = await import('../../transport/src/ble-transport');
      transport = new BLETransport();
      transportLabel = 'BLE (Bluetooth)';
    } catch (err: any) {
      console.log(`  ${C.red}BLE transport failed to load: ${err.message}${C.r}`);
      console.log(`  ${C.d}Install: npm install @stoprocent/noble @stoprocent/bleno${C.r}`);
      console.log(`  ${C.d}Falling back to LAN transport${C.r}\n`);
    }
  }

  if (useWebrtc) {
    try {
      const { MultiTransport } = await import('../../transport/src/multi-transport');
      const { LANTransport } = await import('../../transport/src/lan-transport');
      const { WebRTCTransport } = await import('../../transport/src/webrtc-transport');
      const { WebSocketSignaling, InBandSignaling } = await import('../../transport/src/webrtc-signaling');

      const multi = new MultiTransport();
      const lan = new LANTransport();
      multi.register(lan);

      let signaling: any;
      if (signalUrl) {
        // WebSocket signaling → connects to a relay server
        signaling = new WebSocketSignaling(signalUrl, { reconnect: true });
        transportLabel = `LAN + WebRTC (signal: ${signalUrl})`;
      } else {
        // InBand signaling → fully serverless, SDP/ICE rides LAN multicast
        signaling = new InBandSignaling(lan);
        transportLabel = 'LAN + WebRTC (serverless)';
      }

      webrtcTransport = new WebRTCTransport(signaling, { debug: verbose });
      multi.register(webrtcTransport);
      transport = multi;

      log('◈', C.magenta, `WebRTC transport loaded`, signalUrl ? `signal server: ${signalUrl}` : 'in-band signaling (serverless)');
    } catch (err: any) {
      console.log(`  ${C.red}WebRTC transport failed to load: ${err.message}${C.r}`);
      console.log(`  ${C.d}Install: npm install @roamhq/wrtc ws${C.r}`);
      console.log(`  ${C.d}Falling back to LAN transport${C.r}\n`);
    }
  }

  const node = new CMPNode({
    ...(transport ? { _transport: transport } : { transports: ['lan'] }),
    maxResourceShare: share / 100,
    acceptingTasks: true,
    logLevel: verbose ? LogLevel.DEBUG : LogLevel.INFO,
  });

  await node.start();

  // ── Layers 11-13: Consciousness, Spacetime, Wormholes (v2.0) ──
  const v2bridge = node.getV2Bridge();
  if (v2bridge) {
    log('◈', C.cyan, 'v2.0 Consciousness active', 'Layers 11-13 (pheromones, spacetime, wormholes)');
  }

    // ── v3.0: Cortex, Holographic Memory, GPU, Neuromorphic, Entanglement, Meta-Evolution, Dreaming ──
  let v3bridge: any = null;
  try {
    const { V3Bridge } = await import('../../core/src/v3-bridge');
    const { encodeMessage } = await import('../../core/src/layers/serializer');

    const peerTable = node.getPeerTable();
    const transport = node.getTransport();

    const v3FrameTransport = {
      encodeFrame: (type: number, payload: Uint8Array) => encodeMessage(type as any, payload),
      sendTo: async (addr: string, data: Uint8Array) => transport.sendTo(addr, data),
    };

    const v3PeerResolver = {
      getAddressForMeshId: (meshIdHex: string): string | null => {
        return (node as any).resolveAddress(meshIdHex);
      },
      getLocalMeshId: () => node.meshIdHex(),
    };

    v3bridge = new V3Bridge(
      node.meshIdHex(),
      () => {
        try {
          return peerTable.getActive().map((p: any) => ({
            deviceId: p.hexId,
            address: (node as any).resolveAddress(p.hexId) || '',
            latencyMs: 5,
          }));
        } catch { return []; }
      },
      v3FrameTransport,
      v3PeerResolver,
    );
    v3bridge.start();
    node.setV3Handler(v3bridge);
    log('◈', C.magenta, 'v3.0 systems active', 'Cortex, Memory, GPU, Neural, Entangle, Evolve, Dream');
  } catch (err: any) {
    // v3.0 modules are optional
  }

  // ── Layer 9: Precognition (v1.3) ──
  let dreamScheduler: any = null;
  let phantomCache: any = null;
  let mispredictionTracker: any = null;
  try {
    const { DreamScheduler } = await import('../../core/src/precognition/dream-scheduler');
    const { PhantomCache } = await import('../../core/src/precognition/phantom-cache');
    const { MispredictionTracker } = await import('../../core/src/precognition/misprediction-tracker');

    phantomCache = new PhantomCache();
    phantomCache.start();
    mispredictionTracker = new MispredictionTracker();

    const mclEngine = node.getMCLEngine();
    dreamScheduler = new DreamScheduler(
      () => mclEngine.getStore().getAll(),
      () => 0.05, // CPU load — simplified for CLI
      () => 0,    // Active tasks count
      { minMersForPrediction: 3, predictionIntervalMs: 30000 },
    );
    dreamScheduler.start();
    log('◈', C.magenta, 'Precognition (Layer 9) active', 'dream scheduler running');
  } catch (err: any) {
    // Precognition is optional — don't fail if it can't load
  }

  // ── Immune System (v1.3) ──
  let threatDetector: any = null;
  let antibodyGenerator: any = null;
  let quarantineManager: any = null;
  try {
    const { ThreatDetector } = await import('../../core/src/immune/threat-detector');
    const { AntibodyGenerator } = await import('../../core/src/immune/antibody-generator');
    const { QuarantineManager } = await import('../../core/src/immune/quarantine-manager');

    threatDetector = new ThreatDetector();
    antibodyGenerator = new AntibodyGenerator(node.meshIdHex());
    quarantineManager = new QuarantineManager();
    quarantineManager.start();
    log('◈', C.magenta, 'Immune System active', 'threat detection running');
  } catch (err: any) {
    // Immune system is optional
  }

  // ── Computation Metabolism (v1.3) ──
  let metabolismManager: any = null;
  let meshBreathing: any = null;
  let metabolicNegotiator: any = null;
  try {
    const { MetabolicProfileManager } = await import('../../core/src/metabolism/metabolic-profile');
    const { MeshBreathing } = await import('../../core/src/metabolism/mesh-breathing');
    const { MetabolicNegotiator } = await import('../../core/src/metabolism/metabolic-negotiator');

    metabolismManager = new MetabolicProfileManager();
    metabolismManager.setDeviceStateReader(() => ({
      powerSource: 1, // PLUGGED (simplified for CLI)
      batteryPercent: 100,
      thermalState: 0, // NOMINAL
      cpuLoad: 0.05,
    }));
    metabolismManager.start();

    meshBreathing = new MeshBreathing();
    metabolicNegotiator = new MetabolicNegotiator();

    // Update own profile in mesh breathing
    const ownProfile = metabolismManager.getProfile();
    meshBreathing.updateProfile(node.shortMeshId(), ownProfile);

    log('◈', C.magenta, 'Metabolism active', `state: ${ownProfile.state}`);
  } catch (err: any) {
    // Metabolism is optional
  }

  // ── Temporal Compute Futures (v1.3) ──
  let futureMarket: any = null;
  try {
    const { FutureMarket } = await import('../../core/src/futures/future-market');

    // Simple ledger adapter wrapping the node's incentive ledger
    const status = node.getStatus();
    const simpleLedger = {
      getBalance: (hex: string) => node.getStatus().credits,
      deduct: (hex: string, amount: number) => true, // Simplified
      credit: (hex: string, amount: number) => {},
      getReputation: (hex: string) => 5000,
      adjustReputation: (hex: string, delta: number) => {},
    };

    futureMarket = new FutureMarket(simpleLedger, { minWindowDurationMs: 60000 });
    futureMarket.start();
    log('◈', C.magenta, 'Futures Market active', 'compute futures trading');
  } catch (err: any) {
    // Futures is optional
  }

  // ── Mesh Morphogenesis (v1.3) ──
  let organManager: any = null;
  let organRouter: any = null;
  let affinityTracker: any = null;
  try {
    const { AffinityTracker } = await import('../../core/src/morphogenesis/affinity-tracker');
    const { OrganManager } = await import('../../core/src/morphogenesis/organ-manager');
    const { OrganRouter } = await import('../../core/src/morphogenesis/organ-router');

    affinityTracker = new AffinityTracker({ minSpecializationScore: 0.3 });
    organManager = new OrganManager(affinityTracker, { minOrganSize: 3, signalIntervalMs: 30000 });
    organRouter = new OrganRouter(organManager);
    log('◈', C.magenta, 'Morphogenesis active', 'organ self-organization');
  } catch (err: any) {
    // Morphogenesis is optional
  }

  // ── Lifeforms (v1.4) ──
  let lfManager: any = null;
  let fusionEngine: any = null;
  let intentRegistry: any = null;
  let intentVerifier: any = null;
  let violationHandler: any = null;
  let evolutionMutator: any = null;
  let generationTracker: any = null;
  try {
    const { LifeformManager } = await import('../../core/src/lifeform/manager');
    const { FusionEngine } = await import('../../core/src/lifeform/fusion');
    const { IntentRegistry, IntentVerifier, ViolationHandler } = await import('../../core/src/lifeform/intent');
    const { GenomeMutator, GenerationTracker } = await import('../../core/src/lifeform/evolution');

    lfManager = new LifeformManager({ deviceId: node.shortMeshId(), maxHostedLifeforms: 20 });
    fusionEngine = new FusionEngine();
    intentRegistry = new IntentRegistry();
    intentVerifier = new IntentVerifier();
    violationHandler = new ViolationHandler();
    evolutionMutator = new GenomeMutator();
    generationTracker = new GenerationTracker();
    lfManager.start();

    // Wire transport handler for multi-device Lifeforms
    try {
      const { LifeformTransportHandler } = await import('../../core/src/lifeform/transport-handler');
      const { encodeMessage } = await import('../../core/src/layers/serializer');

      const peerTable = node.getPeerTable();
      const transport = node.getTransport();

      const peerResolver = {
        getAddressForMeshId: (meshIdHex: string) => {
          const peers = peerTable.getActive();
          const peer = peers.find((p: any) => p.hexId === meshIdHex);
          return peer ? peer.transports[0] : null;
        },
        getActivePeerIds: () => peerTable.getActive().map((p: any) => p.hexId),
        getLocalMeshId: () => node.meshIdHex(),
      };

      const frameTransport = {
        sendTo: async (addr: string, data: Uint8Array) => transport.sendTo(addr, data),
        encodeFrame: (type: number, payload: Uint8Array) => encodeMessage(type, payload),
      };

      const lfTransport = new LifeformTransportHandler(peerResolver, frameTransport);
      lfTransport.setManager(lfManager);
      node.setLifeformHandler(lfTransport);

      // Wire remote cause delivery callback
      lfManager.onSendCause(async (targetHost: string, cause: any) => {
        await lfTransport.sendCause(targetHost, cause);
      });

    } catch (err: any) {
      // Transport wiring is optional
    }

    log('◈', C.magenta, 'Lifeforms active', 'v1.4 computational entities');
  } catch (err: any) {
    // Lifeforms is optional
  }

  log('\u25cf', C.green, `Node started: ${C.b}${node.shortMeshId()}${C.r}`, node.meshIdHex());
  log('\u25c9', C.blue, `Listening on ${transportLabel}`, `resource share: ${share}%`);
  log('\u25cc', C.d, `Scanning for peers...`);

  // ── Live events ──
  const bus = node.events();
  bus.on('peer:discovered', (d) => log('\u25c8', C.cyan, `Peer discovered: ${C.b}${shortId(d.meshId)}${C.r}`, d.transport));
  bus.on('peer:handshake_complete', (d) => log('\ud83d\udd17', C.green, `Handshake complete: ${C.b}${shortId(d.meshId)}${C.r}`, 'encrypted session'));
  bus.on('capability:updated', (d) => log('\u2b21', C.blue, `Capability received: ${C.b}${shortId(d.meshId)}${C.r}`));
  bus.on('capability:mesh_changed', (d) => log('\u25c6', C.magenta, `Mesh: ${C.b}${d.peerCount}${C.r} peers, ${C.b}${d.totalCores}${C.r} cores`));
  bus.on('task:request_received', (d) => log('\ud83d\udce5', C.yellow, `Task request: ${C.b}${shortId(d.taskId)}${C.r}`, `from ${shortId(d.requesterId)}`));
  bus.on('task:bid_received', (d) => log('\ud83c\udff7\ufe0f', C.cyan, `Bid received from ${C.b}${shortId(d.bidderId)}${C.r}`));
  bus.on('task:assigned', (d) => log('\u2713', C.green, `Task assigned: ${C.b}${shortId(d.taskId)}${C.r}`, `to ${d.assignees.length} devices`));
  bus.on('chunk:received', (d) => log('\u2699\ufe0f', C.yellow, `Executing chunk: ${C.b}${shortId(d.chunkId)}${C.r}`, `task ${shortId(d.taskId)}`));
  bus.on('credit:earned', (d) => log('\ud83d\udcb0', C.green, `Earned ${C.b}${d.amount} CCU${C.r}`, `balance: ${node.getStatus().credits}`));
  bus.on('peer:lost', (d) => log('\u2717', C.red, `Peer lost: ${C.b}${shortId(d.meshId)}${C.r}`, d.reason));

  // ── Help ──
  console.log(`
  ${C.b}Commands:${C.r}
    ${C.cyan}encrypt${C.r} [--chunks N] <msg>   Encrypt text using mesh WASM cipher
    ${C.cyan}decrypt${C.r} <hex>                Decrypt hex ciphertext back to text
    ${C.cyan}connect${C.r} <ip>                  Connect to a peer by IP
    ${C.cyan}peers${C.r}                        Show connected peers
    ${C.cyan}status${C.r}                       Show mesh + MCL status
    ${C.magenta}mcl${C.r} [status|mers|hint|export|purge]  Mesh Cognition Layer${webrtcTransport ? `
    ${C.magenta}webrtc${C.r} [status|peers|stats]    WebRTC transport info` : ''}${dreamScheduler ? `
    ${C.magenta}dream${C.r} [status|predictions|cache|stats|generate]  Precognition` : ''}${threatDetector ? `
    ${C.magenta}immune${C.r} [status|antibodies|quarantine|threats]  Immune System` : ''}${metabolismManager ? `
    ${C.magenta}metabolism${C.r} [status|mesh|forecast]  Computation Metabolism` : ''}${futureMarket ? `
    ${C.magenta}futures${C.r} [status|list|sell|my]    Temporal Compute Futures` : ''}${organManager ? `
    ${C.magenta}organs${C.r} [status|list|affinity|routing]  Mesh Morphogenesis` : ''}${lfManager ? `
    ${C.magenta}lf${C.r} [status|spawn|list|cause|kill|...]  Lifeforms (v1.4)` : ''}${v3bridge ? `
    ${C.magenta}v3${C.r}                           v3.0 status (Cortex, Memory, GPU, Neural, Dream)
    ${C.magenta}memory${C.r} [write|read|delete]    Holographic Memory (Layer 15)
    ${C.magenta}cortex${C.r} [load|infer|unload]    Mesh Cortex (Layer 14)
    ${C.magenta}gpu${C.r} [matmul|relu]             Mesh GPU (Layer 16)
    ${C.magenta}neural${C.r} [topology|log]         Neuromorphic Router
    ${C.magenta}entangle${C.r} [create|break|list]  Computation Entanglement
    ${C.magenta}evolve${C.r} [drift|history]        Protocol Meta-Evolution
    ${C.magenta}dream3${C.r} [now|fossils|report]   Mesh Dreaming` : ''}
    ${C.cyan}help${C.r}                         Show all commands
    ${C.cyan}quit${C.r}                         Shutdown
`);

  // ── REPL ──
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `  ${C.cyan}cmp>${C.r} ` });
  activeRL = rl;

  // Hook all Logger output to respect readline prompt
  const rlPrint = (line: string) => {
    if (activeRL) {
      process.stdout.write('\r\x1b[K');
      process.stdout.write(line + '\n');
      activeRL.prompt(true);
    } else {
      process.stdout.write(line + '\n');
    }
  };
  Logger.setOutputHook(rlPrint);

  // Also hook console.log for [WebRTC] debug lines so they restore the prompt
  const origConsoleLog = console.log;
  console.log = (...args: any[]) => {
    const firstArg = typeof args[0] === 'string' ? args[0] : '';
    if (firstArg === '[WebRTC]' && activeRL) {
      const line = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
      rlPrint(`  ${C.d}${line}${C.r}`);
    } else {
      origConsoleLog.apply(console, args);
    }
  };

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || '';
    const arg = trimmed.substring(cmd.length).trim();

    switch (cmd) {
      case 'encrypt':
      case 'e':
        if (!arg) { console.log(`  ${C.d}Usage: encrypt [--chunks N] <message>${C.r}`); break; }
        {
          // Parse optional --chunks N
          let chunks = 0;
          let message = arg;
          const chunksMatch = arg.match(/^--chunks\s+(\d+)\s+(.+)$/);
          if (chunksMatch) {
            chunks = parseInt(chunksMatch[1], 10);
            message = chunksMatch[2];
          }
          await doEncrypt(node, message, chunks);
        }
        break;

      case 'decrypt':
      case 'd':
        if (!arg) { console.log(`  ${C.d}Usage: decrypt <hex ciphertext>${C.r}`); break; }
        await doDecrypt(node, arg);
        break;

      case 'connect':
      case 'c':
        if (!arg) {
          console.log(`  ${C.d}Usage: connect <ip address>${C.r}`);
          console.log(`  ${C.d}Example: connect 192.168.43.100${C.r}`);
          console.log(`  ${C.d}Run 'ipconfig' on the other machine to find its IP${C.r}`);
          break;
        }
        log('\u25cc', C.cyan, `Connecting to ${C.b}${arg}${C.r}...`);
        node.connectTo(arg);
        console.log(`  ${C.d}Beacon sent. Wait a few seconds for handshake.${C.r}`);
        break;

      case 'peers':
      case 'p':
        doPeers(node);
        break;

      case 'status':
      case 's':
        doStatus(node);
        break;

      case 'run':
      case 'r':
        if (!arg) {
          console.log(`  ${C.b}Usage:${C.r}`);
          console.log(`    ${C.cyan}run${C.r} <language> <file>           Run code (WASM: mesh, others: local)`);
          console.log(`    ${C.cyan}run${C.r} <language> -c "<code>"      Run inline code on the mesh`);
          console.log(`    ${C.cyan}run${C.r} js -c "function process(data) { return data.toString().toUpperCase(); }" "hello"`);
          console.log(`    ${C.cyan}run${C.r} python script.py "input data"`);
          console.log(`    ${C.cyan}run${C.r} php task.php "input data"`);
          console.log(`  ${C.d}Type 'languages' to see available languages${C.r}`);
          break;
        }
        await doRun(node, arg);
        break;

      case 'languages':
      case 'langs':
        doLanguages();
        break;

      case 'certify':
        if (!arg) {
          console.log(`  ${C.d}Usage: certify <message>${C.r}`);
          console.log(`  ${C.d}Encrypts text across mesh with a Computation Certificate${C.r}`);
          break;
        }
        await doCertify(node, arg);
        break;

      case 'mcl':
        {
          const mclParts = arg.split(/\s+/);
          const mclCmd = mclParts[0]?.toLowerCase() || 'status';
          const mclArg = arg.substring(mclCmd.length).trim();
          doMCL(node, mclCmd, mclArg);
        }
        break;

      case 'webrtc':
      case 'wrtc':
        {
          if (!webrtcTransport) {
            console.log(`  ${C.d}WebRTC not enabled. Start with: npx tsx src/cli.ts start --webrtc${C.r}`);
            break;
          }
          const wrtcCmd = (arg.split(/\s+/)[0] || 'status').toLowerCase();
          await doWebRTC(webrtcTransport, wrtcCmd);
        }
        break;

      case 'dream':
        {
          if (!dreamScheduler) {
            console.log(`  ${C.d}Precognition not available.${C.r}`);
            break;
          }
          const dreamCmd = (arg.split(/\s+/)[0] || 'status').toLowerCase();
          doDream(dreamScheduler, phantomCache, mispredictionTracker, dreamCmd);
        }
        break;

      case 'immune':
        {
          if (!threatDetector) {
            console.log(`  ${C.d}Immune system not available.${C.r}`);
            break;
          }
          const immuneCmd = (arg.split(/\s+/)[0] || 'status').toLowerCase();
          doImmune(threatDetector, antibodyGenerator, quarantineManager, immuneCmd);
        }
        break;

      case 'metabolism':
      case 'meta':
        {
          if (!metabolismManager) {
            console.log(`  ${C.d}Metabolism not available.${C.r}`);
            break;
          }
          const metaCmd = (arg.split(/\s+/)[0] || 'status').toLowerCase();
          doMetabolism(metabolismManager, meshBreathing, metabolicNegotiator, metaCmd);
        }
        break;

      case 'futures':
      case 'future':
        {
          if (!futureMarket) {
            console.log(`  ${C.d}Futures market not available.${C.r}`);
            break;
          }
          const futCmd = (arg.split(/\s+/)[0] || 'status').toLowerCase();
          const futArg = arg.substring(futCmd.length).trim();
          doFutures(futureMarket, node, futCmd, futArg);
        }
        break;

      case 'organs':
      case 'organ':
        {
          if (!organManager) {
            console.log(`  ${C.d}Morphogenesis not available.${C.r}`);
            break;
          }
          const orgCmd = (arg.split(/\s+/)[0] || 'status').toLowerCase();
          doOrgans(organManager, organRouter, affinityTracker, orgCmd);
        }
        break;

      case 'lf':
      case 'lifeform':
        {
          if (!lfManager) {
            console.log(`  ${C.d}Lifeforms not available.${C.r}`);
            break;
          }
          const lfCmd = (arg.split(/\s+/)[0] || 'status').toLowerCase();
          const lfArg = arg.substring(lfCmd.length).trim();
          await doLifeform(lfManager, fusionEngine, intentRegistry, intentVerifier, violationHandler, evolutionMutator, generationTracker, lfCmd, lfArg);
        }
        break;

      case 'consciousness':
      case 'c11':
        if (!v2bridge) { console.log(`  ${C.d}v2.0 not available.${C.r}`); break; }
        doConsciousness(v2bridge, arg);
        break;

      case 'spacetime':
      case 'c12':
        if (!v2bridge) { console.log(`  ${C.d}v2.0 not available.${C.r}`); break; }
        doSpacetime(v2bridge, arg);
        break;

      case 'wormhole':
      case 'c13':
        if (!v2bridge) { console.log(`  ${C.d}v2.0 not available.${C.r}`); break; }
        doWormhole(v2bridge, arg);
        break;

case 'memory':
      case 'cortex':
      case 'gpu':
      case 'neural':
      case 'entangle':
      case 'evolve':
      case 'dream3':
      case 'v3':
        {
          if (!v3bridge) { console.log(`  ${C.d}v3.0 not available.${C.r}`); break; }
          const v3Sub = (arg.split(/\s+/)[0] || '').toLowerCase();
          const v3Arg = arg.substring(v3Sub.length).trim();
          await doV3Command(v3bridge, cmd, v3Sub, v3Arg);
        }
        break;
 
      case 'help':
      case 'h':
        console.log(`
  ${C.b}Commands:${C.r}
    ${C.cyan}connect${C.r} <ip>                  Connect to a peer by IP (for hotspots)
    ${C.cyan}encrypt${C.r} [--chunks N] <msg>   Encrypt text using mesh WASM cipher
    ${C.cyan}decrypt${C.r} <hex>                Decrypt hex ciphertext back to text
    ${C.cyan}certify${C.r} <msg>               Encrypt with Computation Certificate (Layer 7)
    ${C.cyan}run${C.r} <lang> <file|code> [input]  Run code (WASM distributes, others run local)
    ${C.cyan}languages${C.r}                    Show supported languages
    ${C.cyan}peers${C.r}                        Show connected peers
    ${C.cyan}status${C.r}                       Show mesh status

  ${C.b}MCL (v1.2):${C.r}
    ${C.magenta}mcl${C.r}                          MCL status (MERs, pollination, profile)
    ${C.magenta}mcl mers${C.r} [type]              List stored MERs (filter: inference|map_reduce|...)
    ${C.magenta}mcl hint${C.r} [type]              Show strategy hint for a task type
    ${C.magenta}mcl export${C.r} [file.json]       Export MERs to JSON (console or file)
    ${C.magenta}mcl purge${C.r}                    Remove expired MERs

  ${C.b}WebRTC:${C.r}
    ${C.magenta}webrtc${C.r}                       WebRTC status (ID, peers, signaling)
    ${C.magenta}webrtc peers${C.r}                 List WebRTC DataChannel peers
    ${C.magenta}webrtc stats${C.r}                 Show RTT, bandwidth, candidate types

  ${C.b}Precognition (v1.3):${C.r}
    ${C.magenta}dream${C.r}                        Precognition status (idle, predictions, cache)
    ${C.magenta}dream predictions${C.r}            List active predictions with confidence
    ${C.magenta}dream cache${C.r}                  Show phantom cache entries
    ${C.magenta}dream stats${C.r}                  Misprediction stats and aggressiveness
    ${C.magenta}dream generate${C.r}               Force prediction generation now
    ${C.magenta}dream flush${C.r}                  Clear cache and reset tracker

  ${C.b}Immune System (v1.3):${C.r}
    ${C.magenta}immune${C.r}                       Immune system status
    ${C.magenta}immune antibodies${C.r}            List loaded antibodies
    ${C.magenta}immune quarantine${C.r}            Show quarantined devices
    ${C.magenta}immune threats${C.r}               Recent threat events
    ${C.magenta}immune behavior${C.r}              Device behavior records

  ${C.b}Metabolism (v1.3):${C.r}
    ${C.magenta}metabolism${C.r}                    Metabolic state and energy budget
    ${C.magenta}metabolism mesh${C.r}               Mesh-wide metabolic summary
    ${C.magenta}metabolism forecast${C.r}           Capacity forecast (next 4 hours)

  ${C.b}Futures (v1.3):${C.r}
    ${C.magenta}futures${C.r}                       Futures market status
    ${C.magenta}futures list${C.r}                  Show available futures on market
    ${C.magenta}futures sell${C.r} <cores> <mb> <min> <ccu>  List compute future for sale
    ${C.magenta}futures my${C.r}                    Show my futures (seller/buyer)

  ${C.b}Morphogenesis (v1.3):${C.r}
    ${C.magenta}organs${C.r}                        Organ status (count, members)
    ${C.magenta}organs list${C.r}                   List active organs
    ${C.magenta}organs affinity${C.r}               Show device affinity profiles
    ${C.magenta}organs routing${C.r}                Organ routing statistics
    ${C.magenta}organs events${C.r}                 Recent organ events

  ${C.b}Lifeforms (v1.4):${C.r}
    ${C.magenta}lf${C.r}                            Lifeform manager status
    ${C.magenta}lf spawn${C.r} <name> [ccu]         Spawn a Lifeform (default: 100 CCU)
    ${C.magenta}lf list${C.r}                       List all hosted Lifeforms
    ${C.magenta}lf cause${C.r} <name> [payload]     Send a cause to a Lifeform
    ${C.magenta}lf state${C.r} <name>               Show Lifeform CRDT state
    ${C.magenta}lf kill${C.r} <name>                Kill a Lifeform
    ${C.magenta}lf synapse${C.r} <from> <to>        Create a synapse
    ${C.magenta}lf fuse${C.r} <nameA> <nameB> [composite]  Fuse two Lifeforms
    ${C.magenta}lf fission${C.r} <compositeId>      Split a composite Lifeform
    ${C.magenta}lf intent${C.r} <name> <key> <op> <val>  Declare an intent
    ${C.magenta}lf intents${C.r} <name>             List intents for a Lifeform
    ${C.magenta}lf simulate${C.r}                   Run a full demo simulation
${v2HelpText()}
${v3bridge ? v3HelpText() : ''}
 
    ${C.cyan}quit${C.r}                         Shutdown
`);
        break;

      case 'quit':
      case 'q':
      case 'exit':
        console.log(`\n  ${C.yellow}Shutting down...${C.r}`);
        if (v3bridge) v3bridge.stop();
        if (lfManager) lfManager.stop();
        await node.stop();
        console.log(`  ${C.green}Node stopped.${C.r}\n`);
        process.exit(0);
        break;

      case '': break;
      default:
        // Treat as encrypt if it looks like text
        if (trimmed.length > 0 && !trimmed.startsWith('--')) {
          await doEncrypt(node, trimmed);
        } else {
          console.log(`  ${C.d}Unknown command. Type 'help'.${C.r}`);
        }
    }
    rl.prompt();
  });

  rl.on('close', async () => { activeRL = null; Logger.setOutputHook(null); await node.stop(); process.exit(0); });
}

// ══════════════════════════════════════════════
// ENCRYPT: Real WASM mesh encryption
// ══════════════════════════════════════════════

async function doEncrypt(node: CMPNode, message: string, chunkHint: number = 0): Promise<void> {
  const inputBytes = new TextEncoder().encode(message);
  const peers = node.getStatus().peers;

  console.log();
  log('\u26a1', C.cyan, `${C.b}ENCRYPT via MESH${C.r}`);
  log('\u2192', C.d, `Plaintext: "${C.b}${message}${C.r}"`);
  log('\u2192', C.d, `${inputBytes.length} bytes \u2192 WASM XOR cipher`, `peers: ${peers}${chunkHint > 0 ? `, chunks: ${chunkHint}` : ''}`);
  console.log();

  const startTime = Date.now();

  try {
    const result = await node.compute(ENCRYPT_WASM, inputBytes, {
      entryPoint: 'encrypt',
      deadline: 10000,
      ...(chunkHint > 0 ? { chunkHint } : {}),
    });

    const elapsed = Date.now() - startTime;

    // Convert output to hex for display
    const hexOutput = Buffer.from(result.data).toString('hex');

    console.log();
    if (result.localFallback) {
      log('\u26a0', C.yellow, `${C.b}LOCAL EXECUTION${C.r} \u2014 no peers, ran locally`);
    } else {
      log('\u2713', C.green, `${C.b}MESH ENCRYPTED${C.r}`);
    }

    console.log();
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    console.log(`  ${C.d}Plaintext    ${C.r}${C.b}${message}${C.r}`);
    console.log(`  ${C.d}Ciphertext   ${C.r}${C.green}${hexOutput}${C.r}`);
    console.log(`  ${C.d}Time         ${C.r}${elapsed}ms`);
    console.log(`  ${C.d}Chunks       ${C.r}${result.chunksExecuted}`);
    console.log(`  ${C.d}Devices      ${C.r}${result.devicesUsed}`);
    console.log(`  ${C.d}Mesh         ${C.r}${result.localFallback ? `${C.yellow}No (local)` : `${C.green}Yes`}${C.r}`);
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    console.log(`\n  ${C.d}To decrypt: ${C.cyan}decrypt ${hexOutput}${C.r}`);
  } catch (err: any) {
    log('\u2717', C.red, `Encrypt failed: ${err.message}`);
  }
  console.log();
}

// ══════════════════════════════════════════════
// CERTIFY: Compute with Computation Certificate (Layer 7)
// ══════════════════════════════════════════════

async function doCertify(node: CMPNode, message: string): Promise<void> {
  const inputBytes = new TextEncoder().encode(message);
  const peers = node.getStatus().peers;

  console.log();
  log('\u26a1', C.cyan, `${C.b}CERTIFIED COMPUTE${C.r}`);
  log('\u2192', C.d, `Plaintext: "${C.b}${message}${C.r}"`);
  log('\u2192', C.d, `${inputBytes.length} bytes \u2192 WASM XOR cipher \u2192 Computation Certificate`);
  log('\u2192', C.d, `Mode: REDUNDANT verification, peers: ${peers}`);
  console.log();

  const startTime = Date.now();

  try {
    const result = await node.computeCertified(ENCRYPT_WASM, inputBytes, {
      entryPoint: 'encrypt',
      deadline: 15000,
    });

    const elapsed = Date.now() - startTime;
    const hexOutput = Buffer.from(result.data).toString('hex');

    console.log();
    if (result.localFallback) {
      log('\u26a0', C.yellow, `${C.b}LOCAL EXECUTION${C.r} \u2014 no peers, certificate requires mesh`);
    } else {
      log('\u2713', C.green, `${C.b}MESH COMPUTED + CERTIFIED${C.r}`);
    }

    console.log();
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    console.log(`  ${C.d}Plaintext    ${C.r}${C.b}${message}${C.r}`);
    console.log(`  ${C.d}Ciphertext   ${C.r}${C.green}${hexOutput}${C.r}`);
    console.log(`  ${C.d}Time         ${C.r}${elapsed}ms`);
    console.log(`  ${C.d}Chunks       ${C.r}${result.chunksExecuted}`);
    console.log(`  ${C.d}Devices      ${C.r}${result.devicesUsed}`);
    console.log(`  ${C.d}Mesh         ${C.r}${result.localFallback ? `${C.yellow}No (local)` : `${C.green}Yes`}${C.r}`);
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);

    if (result.certificate) {
      const cert = result.certificate;
      const verification = node.verifyCert(cert);

      console.log();
      console.log(`  ${C.b}\u{1f4dc} Computation Certificate${C.r}`);
      console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
      console.log(`  ${C.d}Cert ID      ${C.r}${C.cyan}${cert.certId}${C.r}`);
      console.log(`  ${C.d}Code Hash    ${C.r}${toHex(cert.codeHash).substring(0, 16)}...`);
      console.log(`  ${C.d}Input Hash   ${C.r}${toHex(cert.inputHash).substring(0, 16)}...`);
      console.log(`  ${C.d}Output Hash  ${C.r}${toHex(cert.outputHash).substring(0, 16)}...`);
      console.log(`  ${C.d}Devices      ${C.r}${cert.deviceCount}`);
      console.log(`  ${C.d}Consensus    ${C.r}${(cert.consensus * 100).toFixed(0)}%`);
      console.log(`  ${C.d}Architectures${C.r} ${cert.uniqueArchitectures}`);
      console.log(`  ${C.d}Signatures   ${C.r}${cert.signaturesValid ? `${C.green}All valid` : `${C.red}INVALID`}${C.r}`);
      console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);

      // Show device attestations
      console.log(`  ${C.b}Device Attestations:${C.r}`);
      for (let i = 0; i < cert.attestations.length; i++) {
        const att = cert.attestations[i];
        console.log(`  ${C.d}  [${i + 1}]${C.r} ${shortId(att.meshId)} | ${att.architecture} | ${att.cores} cores | ${att.executionTimeMs}ms | ${att.memoryPeakMb}MB peak`);
      }

      console.log();
      console.log(`  ${C.d}Verification ${C.r}${verification.valid ? `${C.green}${verification.summary}` : `${C.red}${verification.summary}`}${C.r}`);

      // Save certificate JSON to file
      const certJSON = node.exportCert(cert);
      const certFile = `cert-${Date.now()}.json`;
      try {
        fs.writeFileSync(certFile, certJSON);
        console.log(`  ${C.d}Saved to     ${C.r}${C.cyan}${certFile}${C.r}`);
      } catch {
        console.log(`  ${C.d}(could not save certificate file)${C.r}`);
      }
      console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    } else {
      console.log();
      console.log(`  ${C.yellow}No certificate generated (local execution or single device)${C.r}`);
    }
  } catch (err: any) {
    log('\u2717', C.red, `Certified compute failed: ${err.message}`);
  }
  console.log();
}

// ══════════════════════════════════════════════
// DECRYPT: XOR cipher is symmetric — encrypt again = decrypt
// ══════════════════════════════════════════════

async function doDecrypt(node: CMPNode, hexInput: string): Promise<void> {
  // Parse hex to bytes
  const cleanHex = hexInput.replace(/\s/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(cleanHex) || cleanHex.length % 2 !== 0) {
    console.log(`  ${C.red}Invalid hex. Paste the ciphertext from encrypt output.${C.r}`);
    return;
  }

  const inputBytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    inputBytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }

  console.log();
  log('\u26a1', C.cyan, `${C.b}DECRYPT via MESH${C.r}`);
  log('\u2192', C.d, `Ciphertext: ${C.green}${cleanHex}${C.r}`);
  log('\u2192', C.d, `${inputBytes.length} bytes \u2192 WASM XOR decipher`);
  console.log();

  const startTime = Date.now();

  try {
    const result = await node.compute(ENCRYPT_WASM, inputBytes, {
      entryPoint: 'encrypt', // XOR is symmetric: encrypt = decrypt
      deadline: 10000,
    });

    const elapsed = Date.now() - startTime;
    const plaintext = new TextDecoder().decode(result.data);

    console.log();
    if (result.localFallback) {
      log('\u26a0', C.yellow, `${C.b}LOCAL EXECUTION${C.r}`);
    } else {
      log('\u2713', C.green, `${C.b}MESH DECRYPTED${C.r}`);
    }

    console.log();
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    console.log(`  ${C.d}Ciphertext   ${C.r}${C.green}${cleanHex}${C.r}`);
    console.log(`  ${C.d}Plaintext    ${C.r}${C.b}${plaintext}${C.r}`);
    console.log(`  ${C.d}Time         ${C.r}${elapsed}ms`);
    console.log(`  ${C.d}Devices      ${C.r}${result.devicesUsed}`);
    console.log(`  ${C.d}Mesh         ${C.r}${result.localFallback ? `${C.yellow}No (local)` : `${C.green}Yes`}${C.r}`);
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  } catch (err: any) {
    log('\u2717', C.red, `Decrypt failed: ${err.message}`);
  }
  console.log();
}

// ══════════════════════════════════════════════
// PEERS / STATUS
// ══════════════════════════════════════════════

function doPeers(node: CMPNode): void {
  const peers = node.getPeers();
  console.log();
  if (peers.length === 0) {
    log('\u25cc', C.d, 'No peers connected');
    console.log(`  ${C.d}Start another node in a new terminal${C.r}`);
  } else {
    log('\u25c6', C.cyan, `${C.b}${peers.length}${C.r} connected peers:`);
    console.log();
    console.log(`  ${C.b}${'ID'.padEnd(10)}${'State'.padEnd(10)}${'Tier'.padEnd(6)}${'Cores'.padEnd(8)}${'Memory'.padEnd(10)}${C.r}`);
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    for (const p of peers) {
      const mem = p.memoryMb ? (p.memoryMb < 1024 ? `${p.memoryMb}MB` : `${(p.memoryMb / 1024).toFixed(1)}GB`) : '?';
      console.log(`  ${p.shortId.padEnd(10)}${C.green}${p.state.padEnd(10)}${C.r}T${(p.tier || '?').toString().padEnd(5)}${(p.cores?.toString() || '?').padEnd(8)}${mem}`);
    }
  }
  console.log();
}

function doStatus(node: CMPNode): void {
  const s = node.getStatus();
  const up = Math.floor(s.uptime / 1000);
  const upStr = up < 60 ? `${up}s` : `${Math.floor(up / 60)}m ${up % 60}s`;
  const mem = s.resources.totalMemoryMb < 1024 ? `${s.resources.totalMemoryMb} MB` : `${(s.resources.totalMemoryMb / 1024).toFixed(1)} GB`;
  const repColor = s.reputation >= 5000 ? C.green : s.reputation >= 2000 ? C.yellow : C.red;
  console.log();
  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log(`  ${C.d}Node         ${C.r}${C.b}${s.meshId.substring(0, 16)}...${C.r}`);
  console.log(`  ${C.d}Running      ${C.r}${s.running ? `${C.green}Yes` : `${C.red}No`}${C.r}`);
  console.log(`  ${C.d}Uptime       ${C.r}${upStr}`);
  console.log(`  ${C.d}Peers        ${C.r}${C.b}${s.peers}${C.r}`);
  console.log(`  ${C.d}Mesh Cores   ${C.r}${C.b}${s.resources.totalCores}${C.r}`);
  console.log(`  ${C.d}Mesh Memory  ${C.r}${C.b}${mem}${C.r}`);
  console.log(`  ${C.d}Credits      ${C.r}${C.b}${s.credits}${C.r} CCU`);
  console.log(`  ${C.d}Reputation   ${C.r}${repColor}${C.b}${s.reputation}${C.r}${C.d}/10000${C.r}`);
  // MCL Status (v1.2)
  const mcl = node.getMCLStatus();
  const mclColor = mcl.enabled ? C.green : C.red;
  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log(`  ${C.d}MCL          ${C.r}${mclColor}${C.b}${mcl.enabled ? 'Active' : 'Disabled'}${C.r}`);
  console.log(`  ${C.d}MERs         ${C.r}${C.b}${mcl.merCount}${C.r}${mcl.merCount > 0 ? `  ${C.d}(${mcl.taskTypes} types, ${mcl.origins} origins)${C.r}` : ''}`);
  if (mcl.pollinationStats.joinEvents > 0) {
    console.log(`  ${C.d}Pollination  ${C.r}${C.b}${mcl.pollinationStats.totalReceived}${C.r} received, ${C.b}${mcl.pollinationStats.totalOffered}${C.r} offered`);
  }
  // v2.0 Status (Layers 11-13)
  const v2b = node.getV2Bridge();
  if (v2b) doV2Status(v2b);
  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log();
}

// ══════════════════════════════════════════════
// MCL Commands (v1.2)
// ══════════════════════════════════════════════

function doMCL(node: CMPNode, subCmd: string, arg: string): void {
  switch (subCmd) {
    case 'status':
    case 's':
    case '':
      doMCLStatus(node);
      break;
    case 'mers':
    case 'm':
      doMCLMers(node, arg);
      break;
    case 'hint':
    case 'h':
      doMCLHint(node, arg);
      break;
    case 'export':
    case 'e':
      doMCLExport(node, arg);
      break;
    case 'purge':
      doMCLPurge(node);
      break;
    default:
      console.log(`  ${C.d}Unknown MCL command: ${subCmd}${C.r}`);
      console.log(`  ${C.d}Usage: mcl [status|mers|hint|export|purge]${C.r}`);
      break;
  }
}

function doMCLStatus(node: CMPNode): void {
  const mcl = node.getMCLStatus();
  const engine = node.getMCLEngine();
  const profile = engine.getMCLProfile();
  const stats = mcl.pollinationStats;

  console.log();
  console.log(`  ${C.magenta}\u2500\u2500\u2500 Mesh Cognition Layer (v1.2) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log(`  ${C.d}Status         ${C.r}${mcl.enabled ? `${C.green}${C.b}Active` : `${C.red}${C.b}Disabled`}${C.r}`);
  console.log(`  ${C.d}MERs stored    ${C.r}${C.b}${mcl.merCount}${C.r}`);
  console.log(`  ${C.d}Task types     ${C.r}${C.b}${mcl.taskTypes}${C.r}`);
  console.log(`  ${C.d}Origin meshes  ${C.r}${C.b}${mcl.origins}${C.r}`);
  console.log(`  ${C.d}Profile ver    ${C.r}${C.b}${profile.mclVersion}${C.r}`);
  console.log(`  ${C.d}Bloom filter   ${C.r}${C.b}${profile.merCatalogBloom.length * 8}${C.r} bits`);
  console.log(`  ${C.d}Oldest MER     ${C.r}${C.b}${profile.oldestMerDays}${C.r} days`);
  console.log(`  ${C.d}Cross-mesh     ${C.r}${C.b}${profile.crossMeshCount}${C.r} sources`);
  console.log(`  ${C.magenta}\u2500\u2500\u2500 Pollination \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log(`  ${C.d}Join events    ${C.r}${C.b}${stats.joinEvents}${C.r}`);
  console.log(`  ${C.d}MERs offered   ${C.r}${C.b}${stats.totalOffered}${C.r}`);
  console.log(`  ${C.d}MERs received  ${C.r}${C.b}${stats.totalReceived}${C.r}`);
  console.log(`  ${C.d}MERs rejected  ${C.r}${C.b}${stats.totalRejected}${C.r}`);
  console.log(`  ${C.magenta}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log();
}

function doMCLMers(node: CMPNode, filter: string): void {
  const engine = node.getMCLEngine();
  let mers = engine.getStore().getAll();

  // Filter by task type if specified
  if (filter) {
    const typeNum = parseInt(filter, 10);
    const typeByName: Record<string, number> = {
      'inference': 0, 'map_reduce': 1, 'pipeline': 2, 'scatter_gather': 3, 'custom': 4,
    };
    const taskType = isNaN(typeNum) ? typeByName[filter.toLowerCase()] : typeNum;
    if (taskType !== undefined) {
      mers = mers.filter(m => m.taskType === taskType);
    }
  }

  if (mers.length === 0) {
    console.log(`\n  ${C.d}No MERs stored${filter ? ` for filter "${filter}"` : ''}.${C.r}`);
    console.log(`  ${C.d}Run some tasks first to generate experience records.${C.r}\n`);
    return;
  }

  const strategyNames = ['DATA_PAR', 'MODEL_PAR', 'PIPELINE', 'MAP_RED', 'SCATTER'];
  const taskNames = ['INFERENCE', 'MAP_REDUCE', 'PIPELINE', 'SCATTER', 'CUSTOM'];

  console.log();
  console.log(`  ${C.magenta}\u2500\u2500\u2500 MERs (${mers.length} total) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log(`  ${C.d}ID       Type       Strategy   Conf  Gen  Devices  Time${C.r}`);
  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);

  // Sort by creation time (newest first)
  mers.sort((a, b) => b.createdAt - a.createdAt);

  // Show up to 20 MERs
  const display = mers.slice(0, 20);
  for (const mer of display) {
    const id = toHex(mer.merId).substring(0, 8);
    const type = (taskNames[mer.taskType] || `T${mer.taskType}`).padEnd(10);
    const strategy = (strategyNames[mer.strategyUsed] || `S${mer.strategyUsed}`).padEnd(10);
    const conf = `${mer.confidence}%`.padStart(4);
    const gen = `${mer.generation}`.padStart(3);
    const devices = `${mer.deviceCount}`.padStart(7);
    const time = `${mer.performance.totalTimeMs}ms`.padStart(7);
    const confColor = mer.confidence >= 80 ? C.green : mer.confidence >= 50 ? C.yellow : C.red;
    console.log(`  ${C.cyan}${id}${C.r} ${type} ${strategy} ${confColor}${conf}${C.r} ${gen} ${devices} ${time}`);
  }

  if (mers.length > 20) {
    console.log(`  ${C.d}... and ${mers.length - 20} more (use 'mcl export' to see all)${C.r}`);
  }

  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  // Summary stats
  const avgConf = Math.round(mers.reduce((s, m) => s + m.confidence, 0) / mers.length);
  const avgEff = Math.round(mers.reduce((s, m) => s + m.performance.executionEfficiency, 0) / mers.length);
  const maxGen = Math.max(...mers.map(m => m.generation));
  console.log(`  ${C.d}Avg confidence: ${C.r}${C.b}${avgConf}%${C.r}  ${C.d}Avg efficiency: ${C.r}${C.b}${avgEff}%${C.r}  ${C.d}Max generation: ${C.r}${C.b}${maxGen}${C.r}`);
  console.log();
}

function doMCLHint(node: CMPNode, taskTypeArg: string): void {
  const engine = node.getMCLEngine();
  const peers = node.getPeers().length;

  // Parse task type
  const typeByName: Record<string, number> = {
    'inference': 0, 'map_reduce': 1, 'pipeline': 2, 'scatter_gather': 3, 'custom': 4,
  };
  let taskType = 0; // default: INFERENCE
  if (taskTypeArg) {
    const parsed = parseInt(taskTypeArg, 10);
    taskType = isNaN(parsed) ? (typeByName[taskTypeArg.toLowerCase()] ?? 0) : parsed;
  }

  const taskNames = ['INFERENCE', 'MAP_REDUCE', 'PIPELINE', 'SCATTER_GATHER', 'CUSTOM'];
  const hint = engine.getHint(taskType as TaskType, Math.max(1, peers));

  console.log();
  if (!hint) {
    console.log(`  ${C.yellow}No hint available for ${taskNames[taskType] || `type ${taskType}`}${C.r}`);
    console.log(`  ${C.d}Need more verified task completions to generate hints.${C.r}`);
    const merCount = engine.getStore().getByTaskType(taskType as TaskType).length;
    console.log(`  ${C.d}MERs for this type: ${merCount} (need 1+ with confidence >= 70%)${C.r}`);
  } else {
    console.log(`  ${C.magenta}\u2500\u2500\u2500 Strategy Hint: ${taskNames[taskType] || `type ${taskType}`} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    const stratNames = ['DATA_PARALLEL', 'MODEL_PARALLEL', 'PIPELINE', 'MAP_REDUCE', 'SCATTER_GATHER'];
    console.log(`  ${C.d}Strategy       ${C.r}${C.b}${stratNames[hint.recommendedStrategy] || hint.recommendedStrategy}${C.r}`);
    console.log(`  ${C.d}Chunk count    ${C.r}${C.b}${hint.recommendedChunkCount}${C.r}`);
    console.log(`  ${C.d}Chunk size     ${C.r}${C.b}${hint.recommendedChunkSizeKb} KB${C.r}`);
    console.log(`  ${C.d}Confidence     ${C.r}${hint.confidence >= 80 ? C.green : C.yellow}${C.b}${hint.confidence}%${C.r}`);
    console.log(`  ${C.d}Generation     ${C.r}${C.b}${hint.merGeneration}${C.r}${hint.merGeneration > 0 ? ` ${C.d}(evolved)${C.r}` : ''}`);
    console.log(`  ${C.d}Source MERs    ${C.r}${C.b}${hint.sourceMerCount}${C.r}`);
    // Tier preferences
    const tierRoles = ['EXCLUDE', 'COMPUTE', 'PREFER'];
    const tierStr = Array.from(hint.tierPreferences).map((v, i) => `T${i + 1}:${tierRoles[v] || v}`).join(' ');
    console.log(`  ${C.d}Tier mapping   ${C.r}${tierStr}`);
    console.log(`  ${C.magenta}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  }
  console.log();
}

function doMCLExport(node: CMPNode, filepath: string): void {
  const engine = node.getMCLEngine();
  const mers = engine.getStore().getAll();

  if (mers.length === 0) {
    console.log(`\n  ${C.d}No MERs to export.${C.r}\n`);
    return;
  }

  const { merToWire } = require('../../core/src/mcl');
  const exportData = {
    version: '1.2',
    exportedAt: new Date().toISOString(),
    meshId: node.getStatus().meshId,
    merCount: mers.length,
    mers: mers.map((m: CMP_MER) => merToWire(m)),
  };

  const json = JSON.stringify(exportData, null, 2);

  if (filepath) {
    try {
      fs.writeFileSync(filepath, json, 'utf-8');
      console.log(`\n  ${C.green}\u2713 Exported ${mers.length} MERs to ${C.b}${filepath}${C.r}`);
      console.log(`  ${C.d}File size: ${(json.length / 1024).toFixed(1)} KB${C.r}\n`);
    } catch (err: any) {
      console.log(`\n  ${C.red}Export failed: ${err.message}${C.r}\n`);
    }
  } else {
    // Print to console
    console.log();
    console.log(json);
    console.log(`\n  ${C.d}${mers.length} MERs exported. Use 'mcl export <file.json>' to save to file.${C.r}\n`);
  }
}

function doMCLPurge(node: CMPNode): void {
  const engine = node.getMCLEngine();
  const before = engine.getStore().size;
  const purged = engine.getStore().purgeExpired();
  const after = engine.getStore().size;
  console.log(`\n  ${C.green}\u2713 Purged ${purged} expired MERs${C.r} (${before} → ${after})\n`);
}

// ══════════════════════════════════════════════
// RUN (any language)
// ══════════════════════════════════════════════

async function doRun(node: CMPNode, arg: string): Promise<void> {
  // Parse: <language> <-c "code" | filepath> [input]
  const parts = arg.trim().split(/\s+/);
  if (parts.length < 2) {
    console.log(`  ${C.red}Usage: run <language> <file|-c "code"> [input]${C.r}`);
    return;
  }

  const language = parts[0].toLowerCase();
  let code: string;
  let inputText: string;

  if (parts[1] === '-c') {
    // Inline code: run php -c "function process($data) { return strtoupper($data); }" "hello"
    // Find the code between quotes
    const afterC = arg.substring(arg.indexOf('-c') + 2).trim();
    const codeMatch = afterC.match(/^"([\s\S]*?)"\s*(.*)?$/) || afterC.match(/^'([\s\S]*?)'\s*(.*)?$/);
    if (!codeMatch) {
      console.log(`  ${C.red}Wrap code in quotes: run ${language} -c "code here" "input"${C.r}`);
      return;
    }
    code = codeMatch[1];
    // Input is everything after the closing quote
    const rest = (codeMatch[2] || '').trim();
    const inputMatch = rest.match(/^"(.*)"$/) || rest.match(/^'(.*)'$/);
    inputText = inputMatch ? inputMatch[1] : rest || 'hello';
  } else {
    // File path: run php task.php "input data"
    const filePath = parts[1];
    try {
      const fs = await import('fs');
      code = fs.readFileSync(filePath, 'utf-8');
    } catch {
      console.log(`  ${C.red}Cannot read file: ${filePath}${C.r}`);
      return;
    }
    // Rest is input
    const rest = parts.slice(2).join(' ');
    const inputMatch = rest.match(/^"(.*)"$/) || rest.match(/^'(.*)'$/);
    inputText = inputMatch ? inputMatch[1] : rest || 'hello';
  }

  console.log();
  console.log(`  ${C.d}Language     ${C.r}${C.b}${language}${C.r}`);
  console.log(`  ${C.d}Code         ${C.r}${code.length} chars`);
  console.log(`  ${C.d}Input        ${C.r}"${inputText}"`);
  console.log();

  const startTime = Date.now();
  try {
    const result = await node.run(code, new TextEncoder().encode(inputText), {
      language,
      deadline: 30000,
    });

    const elapsed = Date.now() - startTime;
    const output = new TextDecoder().decode(result.data);

    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    console.log(`  ${C.d}Output       ${C.r}${C.b}${output}${C.r}`);
    console.log(`  ${C.d}Time         ${C.r}${elapsed}ms`);
    console.log(`  ${C.d}Devices      ${C.r}${result.devicesUsed}`);
    console.log(`  ${C.d}Mesh         ${C.r}${result.localFallback ? `${C.yellow}No (local)` : `${C.green}Yes`}${C.r}`);
    if (result.localFallback && language !== 'wasm') {
      console.log(`  ${C.d}             ${language} runs locally — only WASM is sandboxed for mesh${C.r}`);
    }
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
    console.log(`  ${C.red}Error        ${err.message}${C.r}`);
    console.log(`  ${C.d}Time         ${C.r}${elapsed}ms`);
    console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  }
  console.log();
}

function doLanguages(): void {
  const { listAllLanguages } = require('../../runtime/src/multi-runtime');
  const langs = listAllLanguages();
  console.log();
  console.log(`  ${C.b}Supported Languages${C.r}`);
  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log(`  ${C.green}\u2713${C.r}  ${C.b}${'WASM'.padEnd(14)}${C.r} ${C.d}[WA]${C.r}  ${'built-in'.padEnd(12)} ${C.green}mesh${C.r}`);
  for (const l of langs) {
    const icon = l.installed ? `${C.green}\u2713` : `${C.red}\u2717`;
    const status = l.installed ? 'installed' : 'not found';
    console.log(`  ${icon}${C.r}  ${C.b}${l.name.padEnd(14)}${C.r} ${C.d}[${l.tag}]${C.r}  ${status.padEnd(12)} ${C.yellow}local${C.r}`);
  }
  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log(`  ${C.green}mesh${C.r}  ${C.d}= sandboxed, distributes across peer devices${C.r}`);
  console.log(`  ${C.yellow}local${C.r} ${C.d}= runs on your device only (subprocess, no sandbox)${C.r}`);
  console.log();
}

// ══════════════════════════════════════════════
// BENCH
// ══════════════════════════════════════════════

async function cmdBench(): Promise<void> {
  console.log(`\n  ${C.b}CMP Benchmark${C.r}\n`);
  Logger.setLevel(LogLevel.WARN);

  const { VirtualNetwork, VirtualTransport } = await import('../../transport/src/virtual-transport');
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];
  const t0 = Date.now();

  for (let i = 0; i < 5; i++) {
    const tr = new VirtualTransport(`b${i}`, network);
    nodes.push(new CMPNode({ _transport: tr, beaconIntervalMs: 100, bidWindowMs: 300, logLevel: LogLevel.WARN }));
  }
  for (const n of nodes) await n.start();
  await new Promise(r => setTimeout(r, 2000));

  const meshTime = Date.now() - t0;
  const p = nodes[0].getStatus().peers;
  log('\u2713', C.green, `Mesh: ${meshTime}ms`, `${p} peers`);

  // Encrypt a message across the virtual mesh
  const msg = new TextEncoder().encode('Hello from CMP benchmark!');
  const t1 = Date.now();
  const result = await nodes[0].compute(ENCRYPT_WASM, msg, { entryPoint: 'encrypt', deadline: 5000 });
  const compTime = Date.now() - t1;

  const hex = Buffer.from(result.data).toString('hex');
  log('\u2713', C.green, `Encrypt: ${compTime}ms`, `"Hello from CMP benchmark!" \u2192 ${hex.substring(0,20)}...`);

  for (const n of nodes) await n.stop();
  console.log(`\n  ${C.d}Total: ${Date.now() - t0}ms${C.r}\n`);
}

// ══════════════════════════════════════════════
// SIGNAL: WebRTC signaling relay server
// ══════════════════════════════════════════════

async function cmdSignal(): Promise<void> {
  const port = parseInt(args[1] || '9090', 10);
  try {
    const { createSignalingServer } = await import('../../transport/src/webrtc-signal-server');
    const { shutdown } = createSignalingServer({ port, secret: process.env.CMP_SIGNAL_SECRET });
    process.on('SIGINT', () => { console.log('\n  Shutting down...'); shutdown(); process.exit(0); });
    process.on('SIGTERM', () => { shutdown(); process.exit(0); });
  } catch (err: any) {
    console.error(`  ${C.red}Failed to start signal server: ${err.message}${C.r}`);
    console.error(`  ${C.d}Install: npm install ws${C.r}`);
    process.exit(1);
  }
}

// ══════════════════════════════════════════════
// WEBRTC: REPL subcommands
// ══════════════════════════════════════════════

async function doWebRTC(wrtc: any, cmd: string): Promise<void> {
  switch (cmd) {
    case 'status': {
      const id = wrtc.getInstanceId();
      const peers = wrtc.getConnectedPeers();
      const iceServers = wrtc.getActiveIceServers();
      console.log();
      console.log(`  ${C.b}WebRTC Transport${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Instance ID  ${C.r}${C.b}${id}${C.r}`);
      console.log(`  ${C.d}Running      ${C.r}${wrtc.isRunning() ? `${C.green}yes` : `${C.red}no`}${C.r}`);
      console.log(`  ${C.d}Peers        ${C.r}${C.b}${peers.length}${C.r} connected`);
      console.log(`  ${C.d}Bandwidth    ${C.r}${wrtc.estimatedBandwidthMbps} Mbps`);
      console.log(`  ${C.d}Max payload  ${C.r}${(wrtc.maxPayloadBytes / 1024 / 1024).toFixed(0)} MB`);
      console.log(`  ${C.d}ICE servers  ${C.r}${iceServers.length} configured`);
      for (const s of iceServers) {
        const urls = Array.isArray(s.urls) ? s.urls.join(', ') : s.urls;
        console.log(`  ${C.d}             ${C.r}${urls}${s.username ? ` (auth)` : ''}`);
      }
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'peers': {
      const peers = wrtc.getConnectedPeers();
      console.log();
      if (peers.length === 0) {
        console.log(`  ${C.d}No WebRTC peers connected${C.r}`);
      } else {
        console.log(`  ${C.b}WebRTC DataChannel Peers (${peers.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const p of peers) {
          console.log(`  ${C.green}●${C.r} ${C.b}${p}${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'stats': {
      try {
        const stats = await wrtc.collectStatsNow();
        console.log();
        if (stats.length === 0) {
          console.log(`  ${C.d}No stats available (no connected peers)${C.r}`);
        } else {
          console.log(`  ${C.b}WebRTC Connection Stats${C.r}`);
          console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
          for (const s of stats) {
            console.log(`  ${C.green}●${C.r} ${C.b}${s.peerId.substring(0, 16)}${C.r}`);
            console.log(`    ${C.d}RTT          ${C.r}${s.roundTripTimeMs != null ? `${s.roundTripTimeMs.toFixed(1)}ms` : 'n/a'}`);
            console.log(`    ${C.d}Sent         ${C.r}${(s.bytesSent / 1024).toFixed(1)} KB (${s.packetsSent} pkts)`);
            console.log(`    ${C.d}Received     ${C.r}${(s.bytesReceived / 1024).toFixed(1)} KB (${s.packetsReceived} pkts)`);
            console.log(`    ${C.d}Packets lost ${C.r}${s.packetsLost === 0 ? `${C.green}0` : `${C.red}${s.packetsLost}`}${C.r}`);
            console.log(`    ${C.d}Local type   ${C.r}${s.localCandidateType || 'n/a'}`);
            console.log(`    ${C.d}Remote type  ${C.r}${s.remoteCandidateType || 'n/a'}`);
            console.log(`    ${C.d}Send queue   ${C.r}${(s.sendQueueBytes / 1024).toFixed(1)} KB`);
            console.log(`    ${C.d}Reconnects   ${C.r}${s.reconnectAttempts}`);
            console.log(`    ${C.d}ICE restarts ${C.r}${s.iceRestartCount}`);
          }
          console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        }
        console.log();
      } catch (err: any) {
        console.log(`  ${C.red}Stats error: ${err.message}${C.r}`);
      }
      break;
    }

    default:
      console.log(`  ${C.d}Usage: webrtc [status|peers|stats]${C.r}`);
  }
}

// ══════════════════════════════════════════════
// DREAM: Precognition REPL subcommands
// ══════════════════════════════════════════════

function doDream(scheduler: any, cache: any, tracker: any, cmd: string): void {
  switch (cmd) {
    case 'status': {
      const ps = scheduler.getCurrentPredictions();
      const idle = scheduler.checkIdleState();
      const cacheStats = cache.getStats();
      const trackerStats = tracker.getStats();

      console.log();
      console.log(`  ${C.b}Precognition (Layer 9)${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Idle state     ${C.r}${idle ? `${C.green}idle (dreaming)` : `${C.yellow}active`}${C.r}`);
      console.log(`  ${C.d}Predictions    ${C.r}${C.b}${ps?.predictions.length ?? 0}${C.r} active`);
      console.log(`  ${C.d}Cache entries  ${C.r}${C.b}${cacheStats.entryCount}${C.r} (${(cacheStats.totalSizeBytes / 1024).toFixed(1)} KB)`);
      console.log(`  ${C.d}Cache hit rate ${C.r}${(cacheStats.hitRate * 100).toFixed(1)}%`);
      console.log(`  ${C.d}Aggressiveness ${C.r}${(trackerStats.aggressiveness * 100).toFixed(0)}%`);
      console.log(`  ${C.d}Total hits     ${C.r}${C.green}${trackerStats.hits}${C.r}  misses: ${C.red}${trackerStats.misses}${C.r}`);
      console.log(`  ${C.d}Net CCU        ${C.r}${trackerStats.netCcuBenefit >= 0 ? C.green : C.red}${trackerStats.netCcuBenefit}${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'predictions': {
      const ps = scheduler.getCurrentPredictions();
      console.log();
      if (!ps || ps.predictions.length === 0) {
        console.log(`  ${C.d}No active predictions. Need more MERs (run tasks first).${C.r}`);
      } else {
        console.log(`  ${C.b}Active Predictions (${ps.predictions.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const p of ps.predictions) {
          const taskTypes = ['INFERENCE', 'MAP_REDUCE', 'PIPELINE', 'SCATTER_GATHER', 'CUSTOM'];
          const typeStr = taskTypes[p.taskType] || `type:${p.taskType}`;
          const windowMs = p.predictedWindowEnd - p.predictedWindowStart;
          console.log(`  ${C.green}●${C.r} ${C.b}${typeStr}${C.r}  conf: ${(p.confidence * 100).toFixed(0)}%  pattern: ${p.patternType}`);
          console.log(`    ${C.d}Window: ${(windowMs / 1000).toFixed(0)}s  Sources: ${p.sourceMerIds.length} MERs${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'cache': {
      const entries = cache.getEntries();
      const stats = cache.getStats();
      console.log();
      if (entries.length === 0) {
        console.log(`  ${C.d}Phantom cache empty. Predictions haven't produced results yet.${C.r}`);
      } else {
        console.log(`  ${C.b}Phantom Cache (${entries.length} entries, ${(stats.totalSizeBytes / 1024).toFixed(1)} KB)${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const e of entries.slice(0, 10)) {
          const age = ((Date.now() - e.cachedAt) / 1000).toFixed(0);
          const ttlLeft = Math.max(0, (e.ttlMs - (Date.now() - e.cachedAt)) / 1000).toFixed(0);
          console.log(`  ${C.cyan}●${C.r} ${e.cacheKey.substring(0, 30)}...`);
          console.log(`    ${C.d}Conf: ${(e.confidence * 100).toFixed(0)}%  Hits: ${e.hitCount}  Age: ${age}s  TTL: ${ttlLeft}s  Size: ${e.resultData.length}B${C.r}`);
        }
        if (entries.length > 10) {
          console.log(`  ${C.d}... and ${entries.length - 10} more${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'stats': {
      const stats = tracker.getStats();
      const rates = stats.patternHitRates as Map<string, number>;
      console.log();
      console.log(`  ${C.b}Misprediction Stats${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Total          ${C.r}${stats.totalPredictions}`);
      console.log(`  ${C.d}Hits           ${C.r}${C.green}${stats.hits}${C.r}`);
      console.log(`  ${C.d}Misses         ${C.r}${C.red}${stats.misses}${C.r}`);
      console.log(`  ${C.d}Hit rate       ${C.r}${(stats.hitRate * 100).toFixed(1)}%`);
      console.log(`  ${C.d}CCU spent      ${C.r}${stats.speculativeCcuSpent}`);
      console.log(`  ${C.d}CCU saved      ${C.r}${stats.ccuSavedByHits}`);
      console.log(`  ${C.d}Net benefit    ${C.r}${stats.netCcuBenefit >= 0 ? C.green : C.red}${stats.netCcuBenefit} CCU${C.r}`);
      console.log(`  ${C.d}Aggressiveness ${C.r}${(stats.aggressiveness * 100).toFixed(0)}%`);
      console.log();
      console.log(`  ${C.b}Per-Pattern Hit Rates:${C.r}`);
      for (const [pattern, rate] of rates) {
        console.log(`    ${C.d}${pattern.padEnd(25)}${C.r}${(rate * 100).toFixed(0)}%`);
      }
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'generate': {
      console.log(`  ${C.cyan}Generating predictions now...${C.r}`);
      const ps = scheduler.generatePredictions();
      console.log(`  ${C.green}Generated ${ps.predictions.length} predictions${C.r}`);
      if (ps.predictions.length > 0) {
        doDream(scheduler, cache, tracker, 'predictions');
      } else {
        console.log(`  ${C.d}No patterns detected. Run more tasks to build MER history.${C.r}`);
      }
      break;
    }

    case 'flush': {
      cache.clear();
      tracker.reset();
      console.log(`  ${C.green}Phantom cache cleared, tracker reset.${C.r}`);
      break;
    }

    default:
      console.log(`  ${C.d}Usage: dream [status|predictions|cache|stats|generate|flush]${C.r}`);
  }
}

// ══════════════════════════════════════════════
// IMMUNE: Immune System REPL subcommands
// ══════════════════════════════════════════════

function doImmune(detector: any, generator: any, qm: any, cmd: string): void {
  switch (cmd) {
    case 'status': {
      const antibodies = detector.getAntibodies();
      const allEvents = detector.getAllEvents();
      const quarantines = qm.getAll();

      console.log();
      console.log(`  ${C.b}Mesh Immune System${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Antibodies     ${C.r}${C.b}${antibodies.length}${C.r} loaded`);
      console.log(`  ${C.d}Threat events  ${C.r}${C.b}${allEvents.length}${C.r} detected`);
      console.log(`  ${C.d}Quarantined    ${C.r}${C.b}${quarantines.length}${C.r} devices`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'antibodies': {
      const antibodies = detector.getAntibodies();
      console.log();
      if (antibodies.length === 0) {
        console.log(`  ${C.d}No antibodies loaded. Threats must be detected first.${C.r}`);
      } else {
        console.log(`  ${C.b}Antibodies (${antibodies.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const ab of antibodies) {
          const age = ((Date.now() - ab.createdAt) / 3600000).toFixed(1);
          const ttl = Math.max(0, (ab.expiresAt - Date.now()) / 3600000).toFixed(1);
          console.log(`  ${C.cyan}●${C.r} ${C.b}${ab.id.substring(0, 12)}${C.r}  ${ab.threatType}`);
          console.log(`    ${C.d}Severity: ${ab.severity}  Conf: ${(ab.confidence * 100).toFixed(0)}%  Activations: ${ab.activationCount}  FP: ${ab.falsePositiveCount}${C.r}`);
          console.log(`    ${C.d}Age: ${age}h  TTL: ${ttl}h  Origin: ${ab.originMeshFingerprint.substring(0, 12)}${C.r}`);
          console.log(`    ${C.d}Rules: ${ab.signature.rules.map((r: any) => `${r.metric} ${r.operator} ${r.value}`).join(', ')}${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'quarantine': {
      const quarantines = qm.getAll();
      console.log();
      if (quarantines.length === 0) {
        console.log(`  ${C.d}No quarantined devices.${C.r}`);
      } else {
        console.log(`  ${C.b}Quarantined Devices (${quarantines.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const q of quarantines) {
          const devHex = Array.from(q.deviceId).map((b: number) => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
          const remaining = Math.max(0, (q.expiresAt - Date.now()) / 60000).toFixed(0);
          const levelColor = q.level === 'expelled' ? C.red : q.level === 'restricted' ? C.yellow : C.d;
          console.log(`  ${levelColor}●${C.r} ${C.b}${devHex}${C.r}  ${levelColor}${q.level.toUpperCase()}${C.r}`);
          console.log(`    ${C.d}Triggered by: ${q.triggeredBy.substring(0, 12)}  Remaining: ${remaining}min  Appealable: ${q.appealable ? 'yes' : 'no'}${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'threats': {
      const events = detector.getAllEvents().slice(0, 20);
      console.log();
      if (events.length === 0) {
        console.log(`  ${C.d}No threats detected yet.${C.r}`);
      } else {
        console.log(`  ${C.b}Recent Threat Events (${events.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const e of events) {
          const suspectHex = Array.from(e.suspectId).map((b: number) => b.toString(16).padStart(2, '0')).join('').substring(0, 12);
          const age = ((Date.now() - e.detectedAt) / 1000).toFixed(0);
          const sevColor = e.severity === 'critical' ? C.red : e.severity === 'high' ? C.red : e.severity === 'medium' ? C.yellow : C.d;
          console.log(`  ${sevColor}●${C.r} ${C.b}${e.type}${C.r}  suspect: ${suspectHex}  ${age}s ago`);
          console.log(`    ${C.d}${e.evidence.description}  (${e.detectionMethod}, conf: ${(e.evidence.confidence * 100).toFixed(0)}%)${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'behavior': {
      const records = detector.getAllBehaviorRecords();
      console.log();
      if (records.length === 0) {
        console.log(`  ${C.d}No behavior records yet. Run tasks first.${C.r}`);
      } else {
        console.log(`  ${C.b}Device Behavior Records (${records.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const r of records) {
          const errorRate = r.totalTasksAssigned > 0 ? (r.resultMismatches / r.totalTasksAssigned * 100).toFixed(0) : '0';
          const timeoutRate = r.totalTasksAssigned > 0 ? (r.tasksTimedOut / r.totalTasksAssigned * 100).toFixed(0) : '0';
          console.log(`  ${C.cyan}●${C.r} ${C.b}${r.deviceId.substring(0, 16)}${C.r}`);
          console.log(`    ${C.d}Tasks: ${r.totalTasksAssigned}  OK: ${r.tasksCompleted}  Failed: ${r.tasksFailed}  Errors: ${errorRate}%  Timeouts: ${timeoutRate}%${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    default:
      console.log(`  ${C.d}Usage: immune [status|antibodies|quarantine|threats|behavior]${C.r}`);
  }
}

// ══════════════════════════════════════════════
// METABOLISM: Computation Metabolism REPL subcommands
// ══════════════════════════════════════════════

function doMetabolism(manager: any, breathing: any, negotiator: any, cmd: string): void {
  switch (cmd) {
    case 'status': {
      const profile = manager.getProfile();
      const stateColors: Record<string, string> = {
        anabolic: C.green,
        homeostatic: C.cyan,
        catabolic: C.yellow,
        dormant: C.red,
        charging: C.blue,
      };
      const stateColor = stateColors[profile.state] || C.d;

      console.log();
      console.log(`  ${C.b}Computation Metabolism${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}State          ${C.r}${stateColor}${profile.state.toUpperCase()}${C.r}`);
      console.log(`  ${C.d}Energy budget  ${C.r}${(profile.energyBudget * 100).toFixed(0)}%`);
      console.log(`  ${C.d}Energy delta   ${C.r}${profile.energyDelta >= 0 ? C.green + '+' : C.red}${(profile.energyDelta * 100).toFixed(1)}%/hr${C.r}`);
      console.log(`  ${C.d}Thermal eff.   ${C.r}${(profile.thermalEfficiency * 100).toFixed(0)}%`);
      console.log(`  ${C.d}Power source   ${C.r}${profile.powerSource}`);
      console.log(`  ${C.d}Battery        ${C.r}${profile.batteryPercent}%`);
      console.log(`  ${C.d}CCU budget     ${C.r}${profile.energyCcuBudget}/hr`);
      const ttc = profile.timeToStateChange;
      console.log(`  ${C.d}State change   ${C.r}${ttc === Infinity ? 'stable' : `~${(ttc / 60000).toFixed(0)}min`}`);
      console.log(`  ${C.d}Transitions    ${C.r}${profile.recentTransitions.length} in last 24h`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'mesh': {
      const summary = breathing.getSummary();
      const phaseColor = summary.meshPhase === 'expansion' ? C.green : summary.meshPhase === 'contraction' ? C.red : C.cyan;

      console.log();
      console.log(`  ${C.b}Mesh Metabolic Summary${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Phase          ${C.r}${phaseColor}${summary.meshPhase.toUpperCase()}${C.r}`);
      console.log(`  ${C.d}Total energy   ${C.r}${summary.totalEnergyBudget.toFixed(2)}`);
      console.log(`  ${C.d}Efficiency     ${C.r}${(summary.meshEfficiency * 100).toFixed(0)}%`);
      console.log();
      console.log(`  ${C.b}State Distribution:${C.r}`);
      console.log(`    ${C.green}ANABOLIC${C.r}     ${summary.stateDistribution.anabolic}`);
      console.log(`    ${C.cyan}HOMEOSTATIC${C.r}  ${summary.stateDistribution.homeostatic}`);
      console.log(`    ${C.yellow}CATABOLIC${C.r}    ${summary.stateDistribution.catabolic}`);
      console.log(`    ${C.red}DORMANT${C.r}      ${summary.stateDistribution.dormant}`);
      console.log(`    ${C.blue}CHARGING${C.r}     ${summary.stateDistribution.charging}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'forecast': {
      const summary = breathing.getSummary();
      console.log();
      console.log(`  ${C.b}4-Hour Capacity Forecast${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      for (let i = 0; i < summary.capacityForecast.length; i++) {
        const val = summary.capacityForecast[i];
        const bar = '█'.repeat(Math.round(val * 10));
        console.log(`  ${C.d}+${i + 1}h${C.r}  ${C.cyan}${bar}${C.r} ${val.toFixed(2)}`);
      }
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    default:
      console.log(`  ${C.d}Usage: metabolism [status|mesh|forecast]${C.r}`);
  }
}

// ══════════════════════════════════════════════
// FUTURES: Temporal Compute Futures REPL subcommands
// ══════════════════════════════════════════════

function doFutures(market: any, node: any, cmd: string, arg: string): void {
  const toHexShort = (bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12);

  switch (cmd) {
    case 'status': {
      const all = market.getAllListings();
      const listed = all.filter((f: any) => f.status === 'listed').length;
      const reserved = all.filter((f: any) => f.status === 'reserved').length;
      const active = all.filter((f: any) => f.status === 'active').length;
      const settled = all.filter((f: any) => f.status === 'settled').length;
      const defaulted = all.filter((f: any) => f.status === 'defaulted').length;

      console.log();
      console.log(`  ${C.b}Temporal Compute Futures${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Listed     ${C.r}${C.b}${listed}${C.r}`);
      console.log(`  ${C.d}Reserved   ${C.r}${C.b}${reserved}${C.r}`);
      console.log(`  ${C.d}Active     ${C.r}${C.b}${active}${C.r}`);
      console.log(`  ${C.d}Settled    ${C.r}${C.green}${settled}${C.r}`);
      console.log(`  ${C.d}Defaulted  ${C.r}${C.red}${defaulted}${C.r}`);
      console.log(`  ${C.d}Total      ${C.r}${all.length}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'list': {
      const all = market.getAllListings();
      const available = all.filter((f: any) => f.status === 'listed');
      console.log();
      if (available.length === 0) {
        console.log(`  ${C.d}No futures listed. Use: futures sell <cores> <memMb> <minutes> <price>${C.r}`);
      } else {
        console.log(`  ${C.b}Available Futures (${available.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const f of available) {
          const windowStart = new Date(f.windowStart).toLocaleTimeString();
          const windowEnd = new Date(f.windowEnd).toLocaleTimeString();
          console.log(`  ${C.cyan}●${C.r} ${C.b}${toHexShort(f.id)}${C.r}  T${f.tier}  ${f.resources.cores} cores  ${f.resources.memoryMb}MB  ${f.ccuPrice} CCU`);
          console.log(`    ${C.d}Window: ${windowStart} → ${windowEnd}  Conf: ${(f.deliveryConfidence * 100).toFixed(0)}%  Seller: ${toHexShort(f.sellerId)}${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'sell': {
      const parts = arg.split(/\s+/);
      if (parts.length < 4) {
        console.log(`  ${C.d}Usage: futures sell <cores> <memMb> <durationMin> <ccuPrice>${C.r}`);
        console.log(`  ${C.d}Example: futures sell 4 2048 60 10${C.r}`);
        break;
      }
      const cores = parseInt(parts[0]);
      const memMb = parseInt(parts[1]);
      const durMin = parseInt(parts[2]);
      const price = parseInt(parts[3]);

      if (isNaN(cores) || isNaN(memMb) || isNaN(durMin) || isNaN(price)) {
        console.log(`  ${C.red}Invalid numbers.${C.r}`);
        break;
      }

      const now = Date.now();
      const meshId = node.getMeshId ? node.getMeshId() : new Uint8Array(16);

      const future = market.listFuture(
        meshId,
        { cores, memoryMb: memMb, durationMinutes: durMin, estimatedCcu: cores * durMin, runtimes: [0] },
        now + 60000, // Starts in 1 minute
        now + 60000 + durMin * 60000,
        price,
      );

      if (future) {
        console.log(`  ${C.green}Future listed:${C.r} ${C.b}${toHexShort(future.id)}${C.r}`);
        console.log(`  ${C.d}${cores} cores, ${memMb}MB, ${durMin}min window, ${price} CCU${C.r}`);
      } else {
        console.log(`  ${C.red}Failed to list future. Check reputation (need 2000+) and listing cap.${C.r}`);
      }
      break;
    }

    case 'my': {
      const meshId = node.getMeshId ? node.getMeshId() : new Uint8Array(16);
      const mine = market.getMyFutures(meshId);
      console.log();
      if (mine.length === 0) {
        console.log(`  ${C.d}No futures involving this device.${C.r}`);
      } else {
        console.log(`  ${C.b}My Futures (${mine.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const f of mine) {
          const role = Array.from(f.sellerId).join('') === Array.from(meshId).join('') ? 'SELLER' : 'BUYER';
          const statusColor = f.status === 'settled' ? C.green : f.status === 'defaulted' ? C.red : C.yellow;
          console.log(`  ${C.cyan}●${C.r} ${C.b}${toHexShort(f.id)}${C.r}  ${statusColor}${f.status.toUpperCase()}${C.r}  [${role}]  ${f.ccuPrice} CCU`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    default:
      console.log(`  ${C.d}Usage: futures [status|list|sell|my]${C.r}`);
  }
}

// ══════════════════════════════════════════════
// ORGANS: Morphogenesis REPL subcommands
// ══════════════════════════════════════════════

function doOrgans(manager: any, router: any, tracker: any, cmd: string): void {
  const taskTypes = ['INFERENCE', 'MAP_REDUCE', 'PIPELINE', 'SCATTER_GATHER', 'CUSTOM'];
  const shortHex = (bytes: Uint8Array) => Array.from(bytes.slice(0, 6)).map(b => b.toString(16).padStart(2, '0')).join('');

  switch (cmd) {
    case 'status': {
      const organs = manager.getAllOrgans();
      const allAffinities = tracker.getAll();
      const specialists = tracker.getSpecialists();
      const routeStats = router.getStats();

      console.log();
      console.log(`  ${C.b}Mesh Morphogenesis${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Active organs  ${C.r}${C.b}${organs.length}${C.r}`);
      console.log(`  ${C.d}Tracked devs   ${C.r}${C.b}${allAffinities.length}${C.r}`);
      console.log(`  ${C.d}Specialists    ${C.r}${C.b}${specialists.length}${C.r}`);
      console.log(`  ${C.d}Organ routes   ${C.r}${C.green}${routeStats.organRoutes}${C.r}  mesh routes: ${routeStats.meshRoutes}  fallbacks: ${C.yellow}${routeStats.organFallbacks}${C.r}`);
      console.log(`  ${C.d}Organ ratio    ${C.r}${(routeStats.organRouteRatio * 100).toFixed(0)}%`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'list': {
      const organs = manager.getAllOrgans();
      console.log();
      if (organs.length === 0) {
        console.log(`  ${C.d}No active organs. Need 3+ specialist devices for the same task type.${C.r}`);
        console.log(`  ${C.d}Run many tasks of the same type to build specialization.${C.r}`);
      } else {
        console.log(`  ${C.b}Active Organs (${organs.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const org of organs) {
          const typeStr = taskTypes[org.specialization] || `type:${org.specialization}`;
          const healthColor = org.health > 0.7 ? C.green : org.health > 0.4 ? C.yellow : C.red;
          const age = ((Date.now() - org.formedAt) / 60000).toFixed(0);
          console.log(`  ${C.cyan}●${C.r} ${C.b}${shortHex(org.id)}${C.r}  ${typeStr}  ${healthColor}health: ${(org.health * 100).toFixed(0)}%${C.r}`);
          console.log(`    ${C.d}Members: ${org.members.size}  Tasks: ${org.tasksProcessed}  Avg: ${org.avgProcessingTimeMs.toFixed(0)}ms  Age: ${age}min${C.r}`);
          if (org.members.size <= 8) {
            console.log(`    ${C.d}Devices: ${[...org.members].map(m => m.substring(0, 8)).join(', ')}${C.r}`);
          }
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'affinity': {
      const all = tracker.getAll();
      console.log();
      if (all.length === 0) {
        console.log(`  ${C.d}No affinity data yet. Run tasks to build device profiles.${C.r}`);
      } else {
        console.log(`  ${C.b}Device Affinities (${all.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const aff of all.slice(0, 15)) {
          const primary = taskTypes[aff.primaryAffinity] || `type:${aff.primaryAffinity}`;
          const specColor = aff.specializationScore > 0.6 ? C.green : aff.specializationScore > 0.3 ? C.yellow : C.d;
          console.log(`  ${specColor}●${C.r} ${C.b}${aff.deviceId.substring(0, 12)}${C.r}  primary: ${primary}  spec: ${(aff.specializationScore * 100).toFixed(0)}%`);

          // Show top affinities
          const sorted = [...aff.affinities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
          const affinityStr = sorted.map(([t, s]) => `${taskTypes[t] || t}: ${(s * 100).toFixed(0)}%`).join('  ');
          if (affinityStr) {
            console.log(`    ${C.d}${affinityStr}${C.r}`);
          }
        }
        if (all.length > 15) {
          console.log(`  ${C.d}... and ${all.length - 15} more${C.r}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'routing': {
      const stats = router.getStats();
      console.log();
      console.log(`  ${C.b}Organ Routing Stats${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Organ routes   ${C.r}${C.green}${stats.organRoutes}${C.r}`);
      console.log(`  ${C.d}Mesh routes    ${C.r}${stats.meshRoutes}`);
      console.log(`  ${C.d}Fallbacks      ${C.r}${C.yellow}${stats.organFallbacks}${C.r}`);
      console.log(`  ${C.d}Organ ratio    ${C.r}${(stats.organRouteRatio * 100).toFixed(0)}%`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'events': {
      const events = manager.getEventLog();
      console.log();
      if (events.length === 0) {
        console.log(`  ${C.d}No organ events yet.${C.r}`);
      } else {
        console.log(`  ${C.b}Recent Organ Events (${events.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const e of events.slice(-15)) {
          const typeStr = taskTypes[e.taskType] || `type:${e.taskType}`;
          const age = ((Date.now() - e.timestamp) / 1000).toFixed(0);
          const evtColor = e.event === 'forming' || e.event === 'device_joined' ? C.green :
                           e.event === 'dissolving' || e.event === 'device_left' ? C.red : C.cyan;
          console.log(`  ${evtColor}●${C.r} ${C.b}${e.event}${C.r}  organ: ${e.organId.substring(0, 12)}  ${typeStr}  ${age}s ago${e.deviceId ? `  dev: ${e.deviceId.substring(0, 8)}` : ''}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'simulate': {
      console.log();
      console.log(`  ${C.cyan}Simulating organ formation...${C.r}`);
      console.log();

      // Simulate 5 devices specializing in MAP_REDUCE
      const mrDevices = ['sim-alpha', 'sim-beta', 'sim-gamma', 'sim-delta', 'sim-epsilon'];
      for (const dev of mrDevices) {
        for (let i = 0; i < 25; i++) {
          tracker.recordTaskCompletion(dev, 1, 0.85); // MAP_REDUCE = 1
        }
      }
      console.log(`  ${C.green}✓${C.r} Created 5 MAP_REDUCE specialists (sim-alpha..epsilon)`);

      // Simulate 3 devices specializing in INFERENCE
      const infDevices = ['sim-node-1', 'sim-node-2', 'sim-node-3'];
      for (const dev of infDevices) {
        for (let i = 0; i < 25; i++) {
          tracker.recordTaskCompletion(dev, 0, 0.85); // INFERENCE = 0
        }
      }
      console.log(`  ${C.green}✓${C.r} Created 3 INFERENCE specialists (sim-node-1..3)`);

      // Trigger organ formation
      const formed = manager.evaluateFormation();
      console.log(`  ${C.green}✓${C.r} ${C.b}${formed.length} organs formed${C.r}`);

      for (const org of formed) {
        const typeStr = taskTypes[org.specialization] || `type:${org.specialization}`;
        const id = Array.from(org.id.slice(0, 6)).map((b: number) => b.toString(16).padStart(2, '0')).join('');
        console.log(`    ${C.cyan}●${C.r} ${C.b}${id}${C.r}  ${typeStr}  members: ${org.members.size}  health: ${(org.health * 100).toFixed(0)}%`);
      }

      // Test routing
      const mrRoute = router.route(1); // MAP_REDUCE
      const infRoute = router.route(0); // INFERENCE
      const pipeRoute = router.route(2); // PIPELINE (no organ)

      console.log();
      console.log(`  ${C.b}Routing test:${C.r}`);
      console.log(`    MAP_REDUCE  → ${mrRoute.useOrgan ? `${C.green}ORGAN${C.r} (${mrRoute.targetDevices.length} targets)` : `${C.yellow}MESH-WIDE${C.r}`}`);
      console.log(`    INFERENCE   → ${infRoute.useOrgan ? `${C.green}ORGAN${C.r} (${infRoute.targetDevices.length} targets)` : `${C.yellow}MESH-WIDE${C.r}`}`);
      console.log(`    PIPELINE    → ${pipeRoute.useOrgan ? `${C.green}ORGAN${C.r}` : `${C.yellow}MESH-WIDE${C.r} (no organ)`}`);
      console.log();
      console.log(`  ${C.d}Now try: organs list, organs affinity, organs routing, organs events${C.r}`);
      console.log();
      break;
    }

    default:
      console.log(`  ${C.d}Usage: organs [status|list|affinity|routing|events|simulate]${C.r}`);
  }
}

// ══════════════════════════════════════════════
// LIFEFORMS: v1.4 REPL subcommands
// ══════════════════════════════════════════════

async function doLifeform(
  mgr: any, fusionEngine: any, intentRegistry: any, intentVerifier: any,
  violationHandler: any, mutator: any, genTracker: any,
  cmd: string, arg: string,
): Promise<void> {
  const toHex = (b: Uint8Array) => Array.from(b.slice(0, 8)).map(x => x.toString(16).padStart(2, '0')).join('');

  switch (cmd) {
    case 'status': {
      const stats = mgr.getStats();
      console.log();
      console.log(`  ${C.b}Lifeforms (v1.4)${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log(`  ${C.d}Hosted         ${C.r}${C.b}${stats.hosted}${C.r} / ${stats.capacity}`);
      console.log(`  ${C.d}Causes total   ${C.r}${C.b}${stats.totalCausesProcessed}${C.r}`);
      console.log(`  ${C.d}CCU balance    ${C.r}${C.green}${stats.totalCcuBalance.toFixed(2)}${C.r}`);
      console.log(`  ${C.d}DNS entries    ${C.r}${stats.dnsEntries}`);
      console.log(`  ${C.d}Synapses       ${C.r}${stats.synapses}`);
      if (fusionEngine) {
        const fs = fusionEngine.getStats();
        console.log(`  ${C.d}Fusions        ${C.r}active: ${C.b}${fs.activeFusions}${C.r}  total: ${fs.totalFusions}  fissions: ${fs.totalFissions}`);
      }
      if (intentRegistry) {
        console.log(`  ${C.d}Intents        ${C.r}${intentRegistry.size}`);
      }
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'spawn': {
      const parts = arg.split(/\s+/);
      const name = parts[0];
      if (!name) {
        console.log(`  ${C.d}Usage: lf spawn <name> [initialCcu]${C.r}`);
        break;
      }
      const ccu = parseFloat(parts[1]) || 100;

      const { LifeformConfig } = await import('../../core/src/types/lifeform');
      const config = {
        name,
        wasmModule: new Uint8Array([0, 0x61, 0x73, 0x6d]),
        initialState: { spawned_at: Date.now(), status: 'active' },
        initialCcu: ccu,
        minReplicas: 1,
        maxReplicas: 3,
        autoMigrate: true,
        mutationLibraryHash: null,
        maxCausesPerSecond: 100,
        maxStateSizeBytes: 1024 * 1024,
      };

      const hosted = mgr.spawn(config);
      if (!hosted) {
        console.log(`  ${C.red}✗${C.r} Failed to spawn "${name}" — name taken or at capacity`);
        break;
      }

      // Set a default echo handler
      mgr.setHandler(name, async (cause: any) => {
        const state = hosted.state;
        const count = (state.get('causes_received') ?? 0);
        state.set('causes_received', count + 1);
        state.set('last_payload', new TextDecoder().decode(cause.payload));
        return { stateMutations: 2, outgoingCauses: [] };
      });

      console.log(`  ${C.green}✓${C.r} Spawned ${C.b}${name}${C.r}  CCU: ${ccu}  ID: ${toHex(hosted.lifecycle.id)}`);
      console.log(`    ${C.d}Default echo handler installed. Send causes with: lf cause ${name} <message>${C.r}`);
      break;
    }

    case 'list': {
      const names = mgr.getNames();
      console.log();
      if (names.length === 0) {
        console.log(`  ${C.d}No Lifeforms hosted. Use: lf spawn <name>${C.r}`);
      } else {
        console.log(`  ${C.b}Hosted Lifeforms (${names.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const name of names) {
          const hosted = mgr.getByName(name);
          if (!hosted) continue;
          const lc = hosted.lifecycle;
          const stateColor = lc.state === 'alive' ? C.green : lc.state === 'fused' ? C.cyan : C.red;
          console.log(`  ${stateColor}●${C.r} ${C.b}${name}${C.r}  state: ${lc.state}  CCU: ${lc.ccuBalance.toFixed(2)}  causes: ${lc.causesProcessed}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'cause':
    case 'send': {
      const parts = arg.split(/\s+/);
      const targetName = parts[0];
      const payload = parts.slice(1).join(' ') || 'ping';
      if (!targetName) {
        console.log(`  ${C.d}Usage: lf cause <name> [payload]${C.r}`);
        break;
      }

      const { CauseType } = await import('../../core/src/types/causal');
      const rng = (n: number) => { const b = new Uint8Array(n); for (let i=0;i<n;i++) b[i]=Math.floor(Math.random()*256); return b; };
      const cause = {
        id: rng(16), type: CauseType.MESSAGE, chainId: rng(16),
        chainDepth: 0, maxChainDepth: 64, deadlineMs: 0,
        sourceId: rng(16), sourceType: 'device' as const,
        targetId: rng(16),
        payload: new TextEncoder().encode(payload),
        ccuAttached: 0, expectsResponse: false,
        correlationId: null, emittedAt: Date.now(),
      };

      const ok = await mgr.deliverCause(targetName, cause);
      if (ok) {
        const hosted = mgr.getByName(targetName);
        console.log(`  ${C.green}✓${C.r} Cause delivered to ${C.b}${targetName}${C.r}  payload: "${payload}"  causes: ${hosted?.lifecycle.causesProcessed ?? '?'}  CCU: ${hosted?.lifecycle.ccuBalance.toFixed(2) ?? '?'}`);
      } else {
        console.log(`  ${C.red}✗${C.r} Failed to deliver cause to "${targetName}"`);
      }
      break;
    }

    case 'state': {
      if (!arg) { console.log(`  ${C.d}Usage: lf state <name>${C.r}`); break; }
      const hosted = mgr.getByName(arg.trim());
      if (!hosted) { console.log(`  ${C.red}✗${C.r} Unknown Lifeform: ${arg}`); break; }

      const keys = hosted.state.keys();
      console.log();
      console.log(`  ${C.b}State: ${arg}${C.r}  (${keys.length} keys, ~${hosted.state.estimateSize()} bytes)`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      for (const key of keys.slice(0, 20)) {
        const val = hosted.state.get(key);
        const display = val instanceof Set ? `Set(${val.size})` : JSON.stringify(val);
        console.log(`  ${C.cyan}${key}${C.r} = ${display}`);
      }
      if (keys.length > 20) console.log(`  ${C.d}... and ${keys.length - 20} more keys${C.r}`);
      console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      console.log();
      break;
    }

    case 'kill': {
      if (!arg) { console.log(`  ${C.d}Usage: lf kill <name>${C.r}`); break; }
      const name = arg.trim();
      if (mgr.kill(name, 'CLI kill')) {
        console.log(`  ${C.green}✓${C.r} Killed ${C.b}${name}${C.r}`);
      } else {
        console.log(`  ${C.red}✗${C.r} Unknown Lifeform: ${name}`);
      }
      break;
    }

    case 'synapse': {
      const parts = arg.split(/\s+/);
      if (parts.length < 2) { console.log(`  ${C.d}Usage: lf synapse <from> <to>${C.r}`); break; }
      if (mgr.createSynapse(parts[0], parts[1])) {
        console.log(`  ${C.green}✓${C.r} Synapse: ${C.b}${parts[0]}${C.r} → ${C.b}${parts[1]}${C.r}`);
      } else {
        console.log(`  ${C.red}✗${C.r} Failed — check names exist`);
      }
      break;
    }

    case 'fuse': {
      const parts = arg.split(/\s+/);
      if (parts.length < 2) { console.log(`  ${C.d}Usage: lf fuse <nameA> <nameB> [compositeName]${C.r}`); break; }
      const [nameA, nameB] = parts;
      const compositeName = parts[2] || `${nameA}-${nameB}`;

      const hostedA = mgr.getByName(nameA);
      const hostedB = mgr.getByName(nameB);
      if (!hostedA || !hostedB) {
        console.log(`  ${C.red}✗${C.r} Both Lifeforms must exist`);
        break;
      }

      const { StateConflictStrategy, FissionTrigger } = await import('../../core/src/types/fusion');
      const proposal = fusionEngine.propose(hostedA.lifecycle.soul, hostedB.lifecycle.id, {
        compositeName,
        stateConflictStrategy: StateConflictStrategy.NAMESPACE_PREFIX,
        ccuContributionRatio: 0.5,
        primaryGenome: 'proposer',
        fissionTriggers: [FissionTrigger.MANUAL_ONLY],
        maxFusionDurationMs: 0,
      });

      fusionEngine.accept(proposal.id, hostedB.lifecycle.soul);
      const record = fusionEngine.execute(
        proposal.id, hostedA.state, hostedB.state,
        hostedA.lifecycle.ccuBalance, hostedB.lifecycle.ccuBalance,
        new Uint8Array(32), new Uint8Array(32),
      );

      if (record) {
        console.log(`  ${C.green}✓${C.r} ${C.b}FUSION${C.r}: ${nameA} + ${nameB} → ${C.b}${compositeName}${C.r}`);
        console.log(`    ${C.d}Pooled CCU: ${record.pooledCcu.toFixed(2)}  Escrow A: ${record.escrowA.toFixed(2)}  Escrow B: ${record.escrowB.toFixed(2)}${C.r}`);
        console.log(`    ${C.d}Merged state keys: ${record.mergedState?.keys().length ?? 0}  Execution order: ${record.compositeGenome?.executionOrder}${C.r}`);
        console.log(`    ${C.d}Composite ID: ${toHex(record.compositeSoul.compositeId)}${C.r}`);
      } else {
        console.log(`  ${C.red}✗${C.r} Fusion failed`);
      }
      break;
    }

    case 'fission': {
      if (!arg) { console.log(`  ${C.d}Usage: lf fission <compositeIdPrefix>${C.r}`); break; }
      const prefix = arg.trim();
      const active = fusionEngine.getActiveFusions();
      const match = active.find((r: any) => toHex(r.compositeSoul.compositeId).startsWith(prefix));
      if (!match) {
        console.log(`  ${C.red}✗${C.r} No active fusion matching "${prefix}"`);
        if (active.length > 0) {
          console.log(`  ${C.d}Active fusions:${C.r}`);
          for (const f of active) {
            const comps = f.compositeSoul.components;
            console.log(`    ${toHex(f.compositeSoul.compositeId)}  ${comps[0].name} + ${comps[1].name}`);
          }
        }
        break;
      }

      const result = fusionEngine.fission(match.compositeSoul.compositeId, match.mergedState, match.pooledCcu, 'manual');
      if (result) {
        console.log(`  ${C.green}✓${C.r} ${C.b}FISSION${C.r}: composite split back into components`);
        console.log(`    ${C.d}Component A: ${result.componentA.stateKeys.length} keys, ${result.componentA.ccuBalance.toFixed(2)} CCU${C.r}`);
        console.log(`    ${C.d}Component B: ${result.componentB.stateKeys.length} keys, ${result.componentB.ccuBalance.toFixed(2)} CCU${C.r}`);
      }
      break;
    }

    case 'intent': {
      const parts = arg.split(/\s+/);
      if (parts.length < 4) {
        console.log(`  ${C.d}Usage: lf intent <name> <stateKey> <operator> <value>${C.r}`);
        console.log(`  ${C.d}Example: lf intent sensor-1 temperature lt 35${C.r}`);
        console.log(`  ${C.d}Operators: lt gt eq lte gte between${C.r}`);
        break;
      }
      const [name, stateKey, operator, ...valParts] = parts;
      const hosted = mgr.getByName(name);
      if (!hosted) { console.log(`  ${C.red}✗${C.r} Unknown Lifeform: ${name}`); break; }

      const { PredicateType, ViolationAction: VA } = await import('../../core/src/types/intent');
      const rng = (n: number) => { const b = new Uint8Array(n); for (let i=0;i<n;i++) b[i]=Math.floor(Math.random()*256); return b; };

      let value: any = parseFloat(valParts[0]);
      if (isNaN(value)) value = valParts.join(' ');

      const intent = {
        id: rng(16), lifeformId: hosted.lifecycle.id,
        description: `${stateKey} ${operator} ${value}`,
        predicate: { type: PredicateType.VALUE_CHECK, stateKey, operator: operator as any, value },
        sampleIntervalMs: 60000, samplesPerInterval: 3,
        violationAction: VA.NOTIFY, ccuStaked: 10,
        beneficiaryId: rng(16), activeSince: Date.now(), expiresAt: 0,
        commitment: rng(64), violationThreshold: 3, consecutiveViolations: 0,
      };

      intentRegistry.declare(intent);

      // Verify immediately
      const result = intentVerifier.evaluateIntent(intent, hosted.state);
      const statusStr = result.satisfied ? `${C.green}SATISFIED${C.r}` : `${C.red}VIOLATED${C.r}`;
      console.log(`  ${C.green}✓${C.r} Intent declared: ${C.b}${stateKey} ${operator} ${value}${C.r}  Status: ${statusStr}`);
      console.log(`    ${C.d}Staked: 10 CCU  Threshold: 3 violations  Action: NOTIFY${C.r}`);
      break;
    }

    case 'intents': {
      if (!arg) { console.log(`  ${C.d}Usage: lf intents <name>${C.r}`); break; }
      const hosted = mgr.getByName(arg.trim());
      if (!hosted) { console.log(`  ${C.red}✗${C.r} Unknown Lifeform: ${arg}`); break; }

      const intents = intentRegistry.getForLifeform(hosted.lifecycle.id);
      console.log();
      if (intents.length === 0) {
        console.log(`  ${C.d}No intents for "${arg}". Use: lf intent ${arg} <key> <op> <val>${C.r}`);
      } else {
        console.log(`  ${C.b}Intents for ${arg} (${intents.length})${C.r}`);
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
        for (const intent of intents) {
          const result = intentVerifier.evaluateIntent(intent, hosted.state);
          const statusColor = result.satisfied ? C.green : C.red;
          console.log(`  ${statusColor}●${C.r} ${C.b}${intent.description}${C.r}  staked: ${intent.ccuStaked} CCU  violations: ${intent.consecutiveViolations}/${intent.violationThreshold}`);
        }
        console.log(`  ${C.d}────────────────────────────────────────${C.r}`);
      }
      console.log();
      break;
    }

    case 'simulate': {
      console.log();
      console.log(`  ${C.cyan}Running Lifeform simulation...${C.r}`);
      console.log();

      // 1. Spawn two sensor Lifeforms
      const configA = {
        name: 'sim-sensor-a', wasmModule: new Uint8Array([0,0x61,0x73,0x6d]),
        initialState: { temperature: 22, location: 'Floor 1' },
        initialCcu: 100, minReplicas: 1, maxReplicas: 3, autoMigrate: true,
        mutationLibraryHash: null, maxCausesPerSecond: 100, maxStateSizeBytes: 1024*1024,
      };
      const configB = {
        name: 'sim-sensor-b', wasmModule: new Uint8Array([0,0x61,0x73,0x6d]),
        initialState: { temperature: 28, location: 'Floor 2' },
        initialCcu: 80, minReplicas: 1, maxReplicas: 3, autoMigrate: true,
        mutationLibraryHash: null, maxCausesPerSecond: 100, maxStateSizeBytes: 1024*1024,
      };

      const hA = mgr.spawn(configA);
      const hB = mgr.spawn(configB);
      if (!hA || !hB) { console.log(`  ${C.red}✗${C.r} Spawn failed — names may be taken. Run: lf kill sim-sensor-a && lf kill sim-sensor-b`); break; }

      // Set handlers
      mgr.setHandler('sim-sensor-a', async (c: any) => {
        hA.state.set('causes_received', (hA.state.get('causes_received') ?? 0) + 1);
        return { stateMutations: 1, outgoingCauses: [] };
      });
      mgr.setHandler('sim-sensor-b', async (c: any) => {
        hB.state.set('causes_received', (hB.state.get('causes_received') ?? 0) + 1);
        return { stateMutations: 1, outgoingCauses: [] };
      });

      console.log(`  ${C.green}✓${C.r} Spawned ${C.b}sim-sensor-a${C.r} (Floor 1, 22°C, 100 CCU)`);
      console.log(`  ${C.green}✓${C.r} Spawned ${C.b}sim-sensor-b${C.r} (Floor 2, 28°C, 80 CCU)`);

      // 2. Create synapse
      mgr.createSynapse('sim-sensor-a', 'sim-sensor-b');
      console.log(`  ${C.green}✓${C.r} Synapse: sim-sensor-a → sim-sensor-b`);

      // 3. Send some causes
      const { CauseType } = await import('../../core/src/types/causal');
      const rng = (n: number) => { const b = new Uint8Array(n); for (let i=0;i<n;i++) b[i]=Math.floor(Math.random()*256); return b; };
      for (let i = 0; i < 5; i++) {
        await mgr.deliverCause('sim-sensor-a', {
          id: rng(16), type: CauseType.MESSAGE, chainId: rng(16),
          chainDepth: 0, maxChainDepth: 64, deadlineMs: 0,
          sourceId: rng(16), sourceType: 'device', targetId: rng(16),
          payload: new TextEncoder().encode(`reading-${i}`),
          ccuAttached: 0, expectsResponse: false, correlationId: null, emittedAt: Date.now(),
        });
      }
      console.log(`  ${C.green}✓${C.r} Sent 5 causes to sim-sensor-a (CCU: ${hA.lifecycle.ccuBalance.toFixed(2)})`);

      // 4. Declare intent
      const { PredicateType, ViolationAction: VA } = await import('../../core/src/types/intent');
      const intent = {
        id: rng(16), lifeformId: hA.lifecycle.id,
        description: 'temperature < 30',
        predicate: { type: PredicateType.VALUE_CHECK, stateKey: 'temperature', operator: 'lt' as const, value: 30 },
        sampleIntervalMs: 60000, samplesPerInterval: 3,
        violationAction: VA.NOTIFY, ccuStaked: 10,
        beneficiaryId: rng(16), activeSince: Date.now(), expiresAt: 0,
        commitment: rng(64), violationThreshold: 3, consecutiveViolations: 0,
      };
      intentRegistry.declare(intent);
      const evalResult = intentVerifier.evaluateIntent(intent, hA.state);
      console.log(`  ${C.green}✓${C.r} Intent: temperature < 30  → ${evalResult.satisfied ? `${C.green}SATISFIED${C.r}` : `${C.red}VIOLATED${C.r}`}`);

      // 5. Fuse
      const { StateConflictStrategy, FissionTrigger } = await import('../../core/src/types/fusion');
      const proposal = fusionEngine.propose(hA.lifecycle.soul, hB.lifecycle.id, {
        compositeName: 'sim-composite',
        stateConflictStrategy: StateConflictStrategy.NAMESPACE_PREFIX,
        ccuContributionRatio: 0.5, primaryGenome: 'proposer',
        fissionTriggers: [FissionTrigger.MANUAL_ONLY], maxFusionDurationMs: 0,
      });
      fusionEngine.accept(proposal.id, hB.lifecycle.soul);
      const fusionRecord = fusionEngine.execute(
        proposal.id, hA.state, hB.state,
        hA.lifecycle.ccuBalance, hB.lifecycle.ccuBalance,
        new Uint8Array(32), new Uint8Array(32),
      );
      console.log(`  ${C.green}✓${C.r} ${C.b}FUSION${C.r}: sim-sensor-a + sim-sensor-b → ${C.b}sim-composite${C.r}`);
      console.log(`    ${C.d}Pooled: ${fusionRecord.pooledCcu.toFixed(2)} CCU  State keys: ${fusionRecord.mergedState.keys().length}${C.r}`);

      // 6. Fission
      const fissionResult = fusionEngine.fission(fusionRecord.compositeSoul.compositeId, fusionRecord.mergedState, fusionRecord.pooledCcu);
      console.log(`  ${C.green}✓${C.r} ${C.b}FISSION${C.r}: composite split back`);
      console.log(`    ${C.d}A: ${fissionResult.componentA.ccuBalance.toFixed(2)} CCU, ${fissionResult.componentA.stateKeys.length} keys${C.r}`);
      console.log(`    ${C.d}B: ${fissionResult.componentB.ccuBalance.toFixed(2)} CCU, ${fissionResult.componentB.stateKeys.length} keys${C.r}`);

      console.log();
      console.log(`  ${C.b}Simulation complete.${C.r} Try: lf list, lf state sim-sensor-a, lf intents sim-sensor-a`);
      console.log();
      break;
    }

    default:
      console.log(`  ${C.d}Usage: lf [status|spawn|list|cause|state|kill|synapse|fuse|fission|intent|intents|simulate]${C.r}`);
  }
}

// ══════════════════════════════════════════════
// HELP / VERSION / MAIN
// ══════════════════════════════════════════════

function cmdHelp(): void {
  console.log(`
  ${C.b}CMP${C.r} \u2014 Compute Mesh Protocol v${VERSION}
  ${C.d}Agent Viscro${C.r}

  ${C.b}Usage:${C.r}
    ${C.cyan}npx tsx src/cli.ts start${C.r}              Start node (LAN transport)
    ${C.cyan}npx tsx src/cli.ts start --ble${C.r}        Start node (Bluetooth transport)
    ${C.cyan}npx tsx src/cli.ts start --webrtc${C.r}     Start node (LAN + WebRTC serverless)
    ${C.cyan}npx tsx src/cli.ts start --webrtc --signal ws://host:9090${C.r}
    ${C.d}                                      ${C.r}Start with WebRTC via signal server
    ${C.cyan}npx tsx src/cli.ts start --verbose${C.r}    Start with debug logging
    ${C.cyan}npx tsx src/cli.ts signal [port]${C.r}      Start signaling relay server
    ${C.cyan}npx tsx src/cli.ts bench${C.r}              Run benchmark
    ${C.cyan}npx tsx src/cli.ts version${C.r}            Show version

  ${C.b}After starting, type:${C.r}
    ${C.cyan}encrypt${C.r} Hello World            Encrypt text via mesh
    ${C.cyan}decrypt${C.r} 0a272e2e2d...          Decrypt hex via mesh
    ${C.cyan}peers${C.r}                           Show peers
    ${C.cyan}status${C.r}                          Show mesh info
    ${C.cyan}webrtc${C.r}                          WebRTC status (when --webrtc enabled)

  ${C.b}BLE Setup:${C.r}
    ${C.d}npm install @stoprocent/noble @stoprocent/bleno${C.r}
    ${C.d}Windows: Requires Bluetooth 4.0+ adapter${C.r}
    ${C.d}Linux: sudo setcap cap_net_raw+eip $(which node)${C.r}

  ${C.b}WebRTC Setup:${C.r}
    ${C.d}npm install @roamhq/wrtc ws${C.r}
    ${C.d}Works on Windows, macOS, Linux${C.r}
`);
}

async function main(): Promise<void> {
  try {
    switch (command) {
      case 'start': await cmdStart(); break;
      case 'signal': await cmdSignal(); break;
      case 'bench': await cmdBench(); break;
      case 'version': case '-v': console.log(`  CMP v${VERSION} \u2014 Agent Viscro`); break;
      case 'help': case '-h': default: cmdHelp(); break;
    }
  } catch (err: any) {
    console.error(`\n  ${C.red}Error: ${err.message}${C.r}\n`);
    process.exit(1);
  }
}

main();