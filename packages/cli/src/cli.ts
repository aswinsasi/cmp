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
import { LogLevel, Logger, toHex, shortId } from '../../core/src';

const VERSION = '1.0.0';
const C = {
  r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function log(icon: string, color: string, msg: string, detail?: string): void {
  const t = new Date().toISOString().substring(11, 19);
  console.log(`  ${C.d}${t}${C.r} ${color}${icon}${C.r} ${msg}${detail ? `  ${C.d}${detail}${C.r}` : ''}`);
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
  Logger.setLevel(verbose ? LogLevel.DEBUG : LogLevel.INFO);

  const node = new CMPNode({
    transports: ['lan'],
    maxResourceShare: share / 100,
    acceptingTasks: true,
    logLevel: verbose ? LogLevel.DEBUG : LogLevel.INFO,
  });

  await node.start();

  log('\u25cf', C.green, `Node started: ${C.b}${node.shortMeshId()}${C.r}`, node.meshIdHex());
  log('\u25c9', C.blue, `Listening on LAN`, `resource share: ${share}%`);
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
  bus.on('peer:lost', (d) => log('\u2717', C.red, `Peer lost: ${C.b}${shortId(d.meshId)}${C.r}`, d.reason));

  // ── Help ──
  console.log(`
  ${C.b}Commands:${C.r}
    ${C.cyan}encrypt${C.r} <message>   Encrypt text using mesh WASM cipher
    ${C.cyan}decrypt${C.r} <hex>       Decrypt hex ciphertext back to text
    ${C.cyan}peers${C.r}              Show connected peers
    ${C.cyan}status${C.r}             Show mesh status
    ${C.cyan}help${C.r}               Show commands
    ${C.cyan}quit${C.r}               Shutdown
`);

  // ── REPL ──
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `  ${C.cyan}cmp>${C.r} ` });
  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || '';
    const arg = trimmed.substring(cmd.length).trim();

    switch (cmd) {
      case 'encrypt':
      case 'e':
        if (!arg) { console.log(`  ${C.d}Usage: encrypt <your message here>${C.r}`); break; }
        await doEncrypt(node, arg);
        break;

      case 'decrypt':
      case 'd':
        if (!arg) { console.log(`  ${C.d}Usage: decrypt <hex ciphertext>${C.r}`); break; }
        await doDecrypt(node, arg);
        break;

      case 'peers':
      case 'p':
        doPeers(node);
        break;

      case 'status':
      case 's':
        doStatus(node);
        break;

      case 'help':
      case 'h':
        console.log(`
  ${C.b}Commands:${C.r}
    ${C.cyan}encrypt${C.r} <message>   Encrypt text using mesh WASM cipher
    ${C.cyan}decrypt${C.r} <hex>       Decrypt hex ciphertext back to text
    ${C.cyan}peers${C.r}              Show connected peers
    ${C.cyan}status${C.r}             Show mesh status
    ${C.cyan}quit${C.r}               Shutdown
`);
        break;

      case 'quit':
      case 'q':
      case 'exit':
        console.log(`\n  ${C.yellow}Shutting down...${C.r}`);
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

  rl.on('close', async () => { await node.stop(); process.exit(0); });
}

// ══════════════════════════════════════════════
// ENCRYPT: Real WASM mesh encryption
// ══════════════════════════════════════════════

async function doEncrypt(node: CMPNode, message: string): Promise<void> {
  const inputBytes = new TextEncoder().encode(message);
  const peers = node.getStatus().peers;

  console.log();
  log('\u26a1', C.cyan, `${C.b}ENCRYPT via MESH${C.r}`);
  log('\u2192', C.d, `Plaintext: "${C.b}${message}${C.r}"`);
  log('\u2192', C.d, `${inputBytes.length} bytes \u2192 WASM XOR cipher`, `peers: ${peers}`);
  console.log();

  const startTime = Date.now();

  try {
    const result = await node.compute(ENCRYPT_WASM, inputBytes, {
      entryPoint: 'encrypt',
      deadline: 10000,
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
  console.log();
  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
  console.log(`  ${C.d}Node         ${C.r}${C.b}${s.meshId.substring(0, 16)}...${C.r}`);
  console.log(`  ${C.d}Running      ${C.r}${s.running ? `${C.green}Yes` : `${C.red}No`}${C.r}`);
  console.log(`  ${C.d}Uptime       ${C.r}${upStr}`);
  console.log(`  ${C.d}Peers        ${C.r}${C.b}${s.peers}${C.r}`);
  console.log(`  ${C.d}Mesh Cores   ${C.r}${C.b}${s.resources.totalCores}${C.r}`);
  console.log(`  ${C.d}Mesh Memory  ${C.r}${C.b}${mem}${C.r}`);
  console.log(`  ${C.d}Credits      ${C.r}${s.credits} CCU`);
  console.log(`  ${C.d}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.r}`);
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
// HELP / VERSION / MAIN
// ══════════════════════════════════════════════

function cmdHelp(): void {
  console.log(`
  ${C.b}CMP${C.r} \u2014 Compute Mesh Protocol v${VERSION}
  ${C.d}Agent Viscro${C.r}

  ${C.b}Usage:${C.r}
    ${C.cyan}npx tsx src/cli.ts start${C.r}          Start interactive node
    ${C.cyan}npx tsx src/cli.ts bench${C.r}          Run benchmark
    ${C.cyan}npx tsx src/cli.ts version${C.r}        Show version

  ${C.b}After starting, type:${C.r}
    ${C.cyan}encrypt${C.r} Hello World            Encrypt text via mesh
    ${C.cyan}decrypt${C.r} 0a272e2e2d...          Decrypt hex via mesh
    ${C.cyan}peers${C.r}                           Show peers
    ${C.cyan}status${C.r}                          Show mesh info
`);
}

async function main(): Promise<void> {
  try {
    switch (command) {
      case 'start': await cmdStart(); break;
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
