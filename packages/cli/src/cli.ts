#!/usr/bin/env npx tsx
/**
 * CMP CLI
 * Command-line interface for running a CMP node.
 *
 * Commands:
 *   cmp start [options]       Start a CMP node and join/form a mesh
 *   cmp status                Show mesh status
 *   cmp peers                 List connected peers
 *   cmp compute <wasm> <input> [options]  Submit a task
 *   cmp bench                 Run a benchmark
 *   cmp version               Show version
 *
 * @author Agent Viscro
 */

import fs from 'fs';
import path from 'path';
import { CMPNode } from '../../core/src/cmp-node';
import type { ComputeOptions, MeshStatus, PeerInfo } from '../../core/src/cmp-node';
import { LogLevel, Logger } from '../../core/src';

const VERSION = '1.0.0';
const BANNER = `
  ╔═══════════════════════════════════════╗
  ║   CMP — Compute Mesh Protocol v${VERSION}  ║
  ║   Agent Viscro                        ║
  ╚═══════════════════════════════════════╝
`;

// ── Argument Parsing ──

const args = process.argv.slice(2);
const command = args[0] || 'help';

function getFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function getOption(name: string, defaultValue: string = ''): string {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultValue;
  return args[idx + 1];
}

function getNumberOption(name: string, defaultValue: number): number {
  const val = getOption(name);
  return val ? parseInt(val, 10) : defaultValue;
}

// ── Formatting ──

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function header(text: string): void {
  console.log(`\n${C.bold}${C.cyan}${text}${C.reset}`);
}

function row(label: string, value: string | number, color = C.reset): void {
  console.log(`  ${C.dim}${label.padEnd(22)}${C.reset}${color}${value}${C.reset}`);
}

function table(headers: string[], rows: string[][], colWidths: number[]): void {
  // Header
  let headerLine = '  ';
  headers.forEach((h, i) => {
    headerLine += `${C.bold}${h.padEnd(colWidths[i])}${C.reset}`;
  });
  console.log(headerLine);
  console.log(`  ${C.dim}${'─'.repeat(colWidths.reduce((a, b) => a + b, 0))}${C.reset}`);

  // Rows
  for (const r of rows) {
    let line = '  ';
    r.forEach((cell, i) => {
      line += cell.padEnd(colWidths[i]);
    });
    console.log(line);
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatMb(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// ── Global Node Instance ──

let node: CMPNode | null = null;

// ── Commands ──

async function cmdStart(): Promise<void> {
  console.log(BANNER);

  const share = getNumberOption('share', 50);
  const noAccept = getFlag('no-accept');
  const verbose = getFlag('verbose');

  if (verbose) Logger.setLevel(LogLevel.DEBUG);

  node = new CMPNode({
    transports: ['lan'],
    maxResourceShare: share / 100,
    acceptingTasks: !noAccept,
    logLevel: verbose ? LogLevel.DEBUG : LogLevel.INFO,
  });

  await node.start();

  header('Node Started');
  row('Mesh ID', node.meshIdHex(), C.green);
  row('Short ID', node.shortMeshId(), C.green);
  row('Transport', 'LAN (UDP multicast + TCP)');
  row('Resource Share', `${share}%`);
  row('Accepting Tasks', noAccept ? 'No' : 'Yes', noAccept ? C.yellow : C.green);
  console.log(`\n  ${C.dim}Scanning for peers...${C.reset}`);
  console.log(`  ${C.dim}Press Ctrl+C to stop.${C.reset}\n`);

  // Status ticker every 5 seconds
  const ticker = setInterval(() => {
    if (!node?.isRunning()) return;
    const status = node.getStatus();
    const peers = status.peers;
    const cores = status.resources.totalCores;
    const mem = formatMb(status.resources.totalMemoryMb);
    process.stdout.write(
      `\r  ${C.dim}[${formatUptime(status.uptime)}]${C.reset} ` +
      `Peers: ${C.bold}${peers}${C.reset} | ` +
      `Mesh Cores: ${C.bold}${cores}${C.reset} | ` +
      `Mesh Memory: ${C.bold}${mem}${C.reset}   `
    );
  }, 5000);

  // Handle shutdown
  const shutdown = async () => {
    clearInterval(ticker);
    console.log(`\n\n  ${C.yellow}Shutting down...${C.reset}`);
    await node?.stop();
    console.log(`  ${C.green}Node stopped.${C.reset}\n`);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await new Promise(() => {}); // Block forever
}

async function cmdStatus(): Promise<void> {
  if (!node) {
    console.log(`  ${C.red}No node running. Use 'cmp start' first.${C.reset}`);
    return;
  }

  const status = node.getStatus();

  header('Mesh Status');
  row('Mesh ID', status.meshId, C.green);
  row('Running', status.running ? 'Yes' : 'No', status.running ? C.green : C.red);
  row('Uptime', formatUptime(status.uptime));
  row('Active Peers', `${status.peers}`, status.peers > 0 ? C.green : C.yellow);
  row('Total Cores', `${status.resources.totalCores}`);
  row('Total Memory', formatMb(status.resources.totalMemoryMb));
  row('GPU Devices', `${status.resources.gpuDevices}`);
  row('Avg Reputation', `${status.resources.avgReputationScore}/10000`);
  row('Credits', `${status.credits} CCU`);
  console.log();
}

async function cmdPeers(): Promise<void> {
  if (!node) {
    console.log(`  ${C.red}No node running. Use 'cmp start' first.${C.reset}`);
    return;
  }

  const peers = node.getPeers();

  header(`Connected Peers (${peers.length})`);

  if (peers.length === 0) {
    console.log(`  ${C.dim}No peers discovered yet.${C.reset}\n`);
    return;
  }

  table(
    ['ID', 'State', 'Tier', 'Cores', 'Memory', 'Latency', 'Reputation', 'Transport'],
    peers.map((p) => [
      p.shortId,
      p.state,
      p.tier ? `T${p.tier}` : '?',
      `${p.cores ?? '?'}`,
      p.memoryMb ? formatMb(p.memoryMb) : '?',
      `${p.latencyMs}ms`,
      `${p.reputationScore}`,
      p.transports.join(', '),
    ]),
    [12, 12, 8, 8, 12, 10, 12, 16]
  );
  console.log();
}

async function cmdCompute(): Promise<void> {
  const wasmPath = args[1];
  const inputPath = args[2];

  if (!wasmPath || !inputPath) {
    console.log(`  ${C.red}Usage: cmp compute <wasm-file> <input-file> [options]${C.reset}`);
    console.log(`  ${C.dim}Options: --deadline <ms> --priority <low|normal|high|critical> --output <file>${C.reset}`);
    return;
  }

  // Read files
  if (!fs.existsSync(wasmPath)) {
    console.log(`  ${C.red}WASM file not found: ${wasmPath}${C.reset}`);
    return;
  }
  if (!fs.existsSync(inputPath)) {
    console.log(`  ${C.red}Input file not found: ${inputPath}${C.reset}`);
    return;
  }

  const wasmModule = new Uint8Array(fs.readFileSync(wasmPath));
  const inputData = new Uint8Array(fs.readFileSync(inputPath));
  const outputPath = getOption('output', '');
  const deadline = getNumberOption('deadline', 5000);
  const entryPoint = getOption('entry', 'process');

  const priorityStr = getOption('priority', 'normal').toLowerCase();
  const priority = priorityStr === 'low' ? Priority.LOW
    : priorityStr === 'high' ? Priority.HIGH
    : priorityStr === 'critical' ? Priority.CRITICAL
    : Priority.NORMAL;

  // Create node if not running
  if (!node) {
    node = new CMPNode({ transports: ['lan'] });
    await node.start();
    // Wait for peer discovery
    console.log(`  ${C.dim}Discovering peers...${C.reset}`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  header('Submitting Task');
  row('WASM Module', path.basename(wasmPath));
  row('Input', `${inputData.length} bytes`);
  row('Deadline', `${deadline}ms`);
  row('Priority', priorityStr);
  row('Entry Point', entryPoint);
  console.log();

  const startTime = Date.now();
  const result = await node.compute(wasmModule, inputData, {
    deadline,
    priority,
    entryPoint,
  });

  header('Result');
  row('Status', result.verified ? 'SUCCESS' : 'FAILED', result.verified ? C.green : C.red);
  row('Output', `${result.data.length} bytes`);
  row('Total Time', `${result.totalTimeMs}ms`);
  row('Chunks', `${result.chunksExecuted}`);
  row('Devices', `${result.devicesUsed}`);
  row('Local Fallback', result.localFallback ? 'Yes' : 'No', result.localFallback ? C.yellow : C.green);

  if (outputPath) {
    fs.writeFileSync(outputPath, result.data);
    row('Saved To', outputPath, C.green);
  }

  console.log();
}

async function cmdBench(): Promise<void> {
  console.log(BANNER);
  header('CMP Benchmark');
  console.log(`  ${C.dim}Running mesh formation and compute benchmark...${C.reset}\n`);

  // Benchmark: Create 5 virtual nodes, form mesh, exchange capabilities
  const { VirtualNetwork, VirtualTransport } = await import('../../transport/src/virtual-transport');
  const network = new VirtualNetwork();
  const nodes: CMPNode[] = [];

  const meshStart = Date.now();

  for (let i = 0; i < 5; i++) {
    const transport = new VirtualTransport(`bench-${i}`, network);
    const n = new CMPNode({
      _transport: transport,
      beaconIntervalMs: 100,
      bidWindowMs: 300,
      logLevel: LogLevel.WARN,
    });
    nodes.push(n);
  }

  // Start all nodes
  for (const n of nodes) {
    await n.start();
  }

  // Wait for mesh formation
  await new Promise((r) => setTimeout(r, 2000));

  const meshTime = Date.now() - meshStart;
  const peers = nodes[0].getStatus().peers;

  row('Mesh Formation', `${meshTime}ms (5 nodes)`, C.green);
  row('Peers Discovered', `${peers}/4`);
  row('Resources', `${nodes[0].getStatus().resources.totalCores} cores, ${formatMb(nodes[0].getStatus().resources.totalMemoryMb)}`);

  // Benchmark: Negotiation round-trip
  const negoStart = Date.now();
  const { NegotiationEngine } = await import('../../core/src/layers/negotiation-engine');

  // Submit a task from node 0
  const result = await nodes[0].compute(
    // Minimal WASM (add function)
    new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
      0x03, 0x02, 0x01, 0x00,
      0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
      0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
    ]),
    new Uint8Array(1024), // 1KB input
    { entryPoint: 'add', deadline: 5000 }
  );

  const computeTime = Date.now() - negoStart;

  row('Compute Time', `${computeTime}ms`, C.green);
  row('Chunks Executed', `${result.chunksExecuted}`);
  row('Devices Used', `${result.devicesUsed}`);
  row('Local Fallback', result.localFallback ? 'Yes' : 'No');

  // Cleanup
  for (const n of nodes) {
    await n.stop();
  }

  header('Summary');
  row('Mesh Formation', `${meshTime}ms`);
  row('End-to-End Compute', `${computeTime}ms`);
  row('Total', `${Date.now() - meshStart}ms`);
  console.log();
}

function cmdVersion(): void {
  console.log(`  CMP v${VERSION} — Compute Mesh Protocol`);
  console.log(`  Author: Agent Viscro`);
  console.log(`  License: MIT`);
}

function cmdHelp(): void {
  console.log(BANNER);
  console.log(`  ${C.bold}Commands:${C.reset}`);
  console.log(`    ${C.cyan}start${C.reset}                         Start a CMP node`);
  console.log(`      --share <pct>                 Max resource share % (default: 50)`);
  console.log(`      --no-accept                   Don't accept tasks from others`);
  console.log(`      --verbose                     Debug logging`);
  console.log();
  console.log(`    ${C.cyan}compute${C.reset} <wasm> <input>         Submit a task to the mesh`);
  console.log(`      --deadline <ms>               Max time (default: 5000)`);
  console.log(`      --priority <level>            low|normal|high|critical`);
  console.log(`      --entry <name>                WASM entry point (default: process)`);
  console.log(`      --output <file>               Save output to file`);
  console.log();
  console.log(`    ${C.cyan}bench${C.reset}                          Run mesh benchmark`);
  console.log(`    ${C.cyan}version${C.reset}                        Show version`);
  console.log(`    ${C.cyan}help${C.reset}                           Show this help`);
  console.log();
}

// ── Main ──

async function main(): Promise<void> {
  try {
    switch (command) {
      case 'start':
        await cmdStart();
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'peers':
        await cmdPeers();
        break;
      case 'compute':
        await cmdCompute();
        break;
      case 'bench':
        await cmdBench();
        break;
      case 'version':
      case '-v':
      case '--version':
        cmdVersion();
        break;
      case 'help':
      case '-h':
      case '--help':
      default:
        cmdHelp();
        break;
    }
  } catch (err: any) {
    console.error(`\n  ${C.red}Error: ${err.message}${C.reset}\n`);
    process.exit(1);
  }
}

main();
