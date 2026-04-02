/**
 * CMP — Compute Mesh Protocol
 *
 * Distribute computation across nearby devices.
 * No cloud. No server. No internet required.
 *
 * Quick Start:
 *
 *   import { CMP } from 'cmp-mesh';
 *
 *   const mesh = new CMP();
 *   await mesh.start();
 *
 *   console.log(`Found ${mesh.peers} nearby devices`);
 *
 *   // Distribute a heavy task across the mesh
 *   const result = await mesh.distribute(myData, myFunction);
 *
 *   await mesh.stop();
 *
 * That's it. CMP handles discovery, negotiation, encryption,
 * sandboxed execution, and result assembly automatically.
 *
 * @module cmp-mesh
 * @author Agent Viscro
 */

import { CMPNode } from './packages/core/src/cmp-node';
import { V2Bridge } from './packages/core/src/v2-bridge';

// ─── Simple API ───

export class CMP {
  private node: CMPNode;
  private v2: V2Bridge | null = null;
  private onPeerCallbacks: ((count: number) => void)[] = [];

  constructor(options?: {
    /** Accept tasks from other devices? (default: true) */
    acceptTasks?: boolean;
    /** Log level: 'silent' | 'info' | 'debug' (default: 'silent') */
    logLevel?: 'silent' | 'info' | 'debug';
  }) {
    const logMap = { silent: 0, info: 2, debug: 3 };

    this.node = new CMPNode({
      transports: ['lan'],
      acceptingTasks: options?.acceptTasks ?? true,
      logLevel: (logMap[options?.logLevel || 'silent'] ?? 0) as any,
    });
  }

  /** Start the mesh node. Discovers nearby devices automatically. */
  async start(): Promise<void> {
    await this.node.start();
    this.v2 = this.node.getV2Bridge() || null;
  }

  /** Stop the mesh node. */
  async stop(): Promise<void> {
    await this.node.stop();
  }

  /** Number of nearby devices found */
  get peers(): number {
    return this.node.getStatus().peers;
  }

  /** This device's mesh ID */
  get id(): string {
    return this.node.meshIdHex().substring(0, 16);
  }

  /** Is the mesh running? */
  get running(): boolean {
    return this.node.isRunning();
  }

  /** Current mesh behavior (from Layer 11 Consciousness) */
  get behavior(): string {
    return this.v2?.getStatus().behavior || 'normal';
  }

  /**
   * Distribute a function across the mesh.
   *
   * If peers are available, the computation runs on multiple devices.
   * If no peers, it runs locally (still works, just not distributed).
   *
   * @param data - Input bytes to process
   * @param wasmModule - Compiled WASM module
   * @param options - Deadline, entry point
   * @returns Processed result
   *
   * @example
   *   // Process an image
   *   const result = await mesh.distribute(imageBytes, grayscaleWasm);
   *
   * @example
   *   // Crunch numbers
   *   const result = await mesh.distribute(csvBytes, analyzerWasm, { deadline: 10000 });
   */
  async distribute(
    data: Uint8Array,
    wasmModule: Uint8Array,
    options?: {
      /** Max time to wait (ms). Default: 5000 */
      deadline?: number;
      /** WASM function name to call. Default: 'process' */
      entryPoint?: string;
    },
  ): Promise<{
    /** Processed output */
    data: Uint8Array;
    /** Was this distributed or local? */
    distributed: boolean;
    /** How many devices participated */
    devices: number;
    /** Total time (ms) */
    timeMs: number;
  }> {
    const result = await this.node.compute(wasmModule, data, {
      entryPoint: options?.entryPoint || 'process',
      deadline: options?.deadline || 5000,
    });

    return {
      data: result.data,
      distributed: !result.localFallback,
      devices: result.devicesUsed,
      timeMs: result.totalTimeMs,
    };
  }

  /**
   * Run JavaScript/Python/Ruby code across the mesh.
   * (Runs locally — only WASM distributes to other devices)
   *
   * @example
   *   const result = await mesh.run('js', 'function process(d) { return d.toUpperCase(); }', 'hello');
   */
  async run(
    language: string,
    code: string,
    input?: string,
  ): Promise<{ output: string; timeMs: number }> {
    const encoder = new TextEncoder();
    const inputBytes = encoder.encode(input || '');
    const codeBytes = encoder.encode(code);

    const result = await this.node.run(language, codeBytes, inputBytes);

    return {
      output: new TextDecoder().decode(result.data),
      timeMs: result.totalTimeMs,
    };
  }

  /**
   * Get full mesh status.
   */
  status(): {
    id: string;
    running: boolean;
    peers: number;
    credits: number;
    behavior: string;
    pheromones: number;
    uptime: number;
  } {
    const s = this.node.getStatus();
    const v2s = this.v2?.getStatus();
    return {
      id: this.id,
      running: s.running,
      peers: s.peers,
      credits: s.credits,
      behavior: v2s?.behavior || 'normal',
      pheromones: v2s?.pheromoneCount || 0,
      uptime: s.uptime,
    };
  }

  /**
   * Wait until at least N peers are found.
   * Useful for ensuring the mesh is ready before computing.
   *
   * @example
   *   await mesh.waitForPeers(1);  // Wait until at least 1 device is nearby
   *   const result = await mesh.distribute(data, wasm);
   */
  waitForPeers(minPeers: number = 1, timeoutMs: number = 30000): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const count = this.peers;
        if (count >= minPeers) return resolve(count);
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout: found ${count} peers, needed ${minPeers}`));
        setTimeout(check, 500);
      };
      check();
    });
  }

  /**
   * Connect to a specific IP address (for devices on different subnets).
   */
  connectTo(ip: string): void {
    this.node.connectTo(ip);
  }
}

// ─── Export everything ───

export { CMPNode } from './packages/core/src/cmp-node';
export { V2Bridge } from './packages/core/src/v2-bridge';
export default CMP;
