/**
 * CMP Execution Engine
 * Layer 5: Orchestrates the full chunk execution lifecycle:
 * load code → decrypt input → sandbox execute → encrypt output → return result.
 *
 * @module runtime/execution-engine
 * @author Agent Viscro
 */

import {
  CMPChunk,
  CMPResult,
  ChunkStatus,
  SessionKey,
  MeshId,
  encrypt,
  decrypt,
  hash256,
  toHex,
  shortId,
  Logger,
} from '../../core/src';
import { WASMSandbox, SandboxConfig, DEFAULT_SANDBOX_CONFIG } from './wasm-sandbox';
import { ResourceMonitor, ViolationReason } from './resource-monitor';
import { CodeCache } from './code-cache';

const log = new Logger('Execution');

export interface ExecutionConfig {
  sandbox: Partial<SandboxConfig>;
  /** Maximum concurrent chunk executions */
  maxConcurrent: number;
}

const DEFAULT_EXEC_CONFIG: ExecutionConfig = {
  sandbox: DEFAULT_SANDBOX_CONFIG,
  maxConcurrent: 3,
};

export class ExecutionEngine {
  private config: ExecutionConfig;
  private codeCache: CodeCache;
  private meshId: MeshId;
  private activeExecutions = 0;

  constructor(meshId: MeshId, codeCache: CodeCache, config?: Partial<ExecutionConfig>) {
    this.meshId = meshId;
    this.codeCache = codeCache;
    this.config = {
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, ...config?.sandbox },
      maxConcurrent: config?.maxConcurrent ?? DEFAULT_EXEC_CONFIG.maxConcurrent,
    };
  }

  /**
   * Execute a chunk inside a sandboxed WASM environment.
   *
   * @param chunk - The chunk to execute
   * @param sessionKey - Session key for decrypt/encrypt (from handshake)
   * @param wasmModule - The WASM module bytes (if not in cache)
   * @returns CMPResult with encrypted output
   */
  async executeChunk(
    chunk: CMPChunk,
    sessionKey: SessionKey,
    wasmModule?: Uint8Array
  ): Promise<CMPResult> {
    const startTime = Date.now();
    let status: ChunkStatus = ChunkStatus.SUCCESS;
    let outputPayload = new Uint8Array(0);
    let cpuMs = 0;
    let memoryPeakMb = 0;
    let gpuMs = 0;

    log.info(`Executing chunk ${shortId(chunk.chunkId)} (task ${shortId(chunk.taskId)})`, {
      sequence: chunk.sequence,
      totalChunks: chunk.totalChunks,
      payloadSize: chunk.payload.length,
    });

    // Check capacity
    if (this.activeExecutions >= this.config.maxConcurrent) {
      return this.buildResult(chunk, ChunkStatus.RESOURCE_EXCEEDED, new Uint8Array(0), 0, 0, 0);
    }

    this.activeExecutions++;
    const sandbox = new WASMSandbox(this.config.sandbox);
    const monitor = new ResourceMonitor({
      maxMemoryMb: this.config.sandbox.maxMemoryMb || 256,
      maxCpuMs: chunk.timeoutMs,
    });

    let violated = false;

    try {
      // 1. Resolve WASM module
      let moduleBytes = wasmModule;
      if (!moduleBytes) {
        moduleBytes = this.codeCache.get(chunk.codeRef.moduleHash) || undefined;
      }
      if (!moduleBytes) {
        throw new Error('WASM module not available in cache');
      }

      // 2. Verify module hash
      if (!this.codeCache.verify(chunk.codeRef.moduleHash, moduleBytes)) {
        throw new Error('WASM module hash mismatch — possible tampering');
      }

      // 3. Decrypt input payload
      let inputData: Uint8Array;
      if (chunk.payload.length > 0) {
        try {
          inputData = decrypt(chunk.payload, sessionKey);
        } catch {
          // Payload might not be encrypted (e.g., in testing)
          inputData = chunk.payload;
        }
      } else {
        inputData = new Uint8Array(0);
      }

      // 4. Load module into sandbox
      await sandbox.loadModule(moduleBytes);

      // 5. Start resource monitoring
      monitor.start((reason: ViolationReason, details: string) => {
        violated = true;
        log.warn(`Resource violation: ${reason} — ${details}`);
        sandbox.destroy();
      });

      // 6. Execute
      const rawOutput = await sandbox.execute(chunk.codeRef.entryPoint, inputData);

      if (violated) {
        status = ChunkStatus.RESOURCE_EXCEEDED;
      } else {
        // 7. Check output size
        if (rawOutput.length > chunk.expectedOutput.maxSizeKb * 1024) {
          log.warn(`Output too large: ${rawOutput.length} > ${chunk.expectedOutput.maxSizeKb * 1024}`);
          status = ChunkStatus.RESOURCE_EXCEEDED;
        } else {
          // 8. Encrypt output for requester
          outputPayload = new Uint8Array(encrypt(rawOutput, sessionKey));
        }
      }

      // 9. Record metrics
      const metrics = sandbox.getMetrics();
      cpuMs = metrics.cpuTimeMs;
      memoryPeakMb = metrics.memoryPeakMb;

    } catch (err: any) {
      const msg = err.message || 'Unknown error';
      if (msg.includes('timeout') || msg.includes('CPU time')) {
        status = ChunkStatus.TIMEOUT;
      } else if (msg.includes('RESOURCE') || msg.includes('memory')) {
        status = ChunkStatus.RESOURCE_EXCEEDED;
      } else {
        status = ChunkStatus.FAILED;
      }
      log.warn(`Chunk execution failed: ${msg}`);
      cpuMs = Date.now() - startTime;
    } finally {
      monitor.stop();
      sandbox.destroy();
      this.activeExecutions--;
    }

    const execTime = Date.now() - startTime;
    log.info(`Chunk ${shortId(chunk.chunkId)} complete: ${ChunkStatus[status]} (${execTime}ms)`);

    return this.buildResult(chunk, status, outputPayload, cpuMs, memoryPeakMb, gpuMs);
  }

  /**
   * Execute raw WASM module with input data (no encryption, for testing).
   */
  async executeRaw(
    wasmModule: Uint8Array,
    entryPoint: string,
    input: Uint8Array,
    timeoutMs: number = 5000
  ): Promise<{ output: Uint8Array; status: ChunkStatus; metrics: any }> {
    const sandbox = new WASMSandbox({
      ...this.config.sandbox,
      maxCpuMs: timeoutMs,
    });

    try {
      await sandbox.loadModule(wasmModule);
      const output = await sandbox.execute(entryPoint, input);
      const metrics = sandbox.getMetrics();
      return { output, status: ChunkStatus.SUCCESS, metrics };
    } catch (err: any) {
      const status = err.message?.includes('timeout') ? ChunkStatus.TIMEOUT : ChunkStatus.FAILED;
      return { output: new Uint8Array(0), status, metrics: sandbox.getMetrics() };
    } finally {
      sandbox.destroy();
    }
  }

  /**
   * Get current active execution count.
   */
  getActiveCount(): number {
    return this.activeExecutions;
  }

  private buildResult(
    chunk: CMPChunk,
    status: ChunkStatus,
    payload: Uint8Array,
    cpuMs: number,
    memoryPeakMb: number,
    gpuMs: number
  ): CMPResult {
    return {
      chunkId: chunk.chunkId,
      taskId: chunk.taskId,
      executorId: this.meshId,
      status,
      payload,
      executionTimeMs: cpuMs,
      resourceUsed: { cpuMs, memoryPeakMb, gpuMs },
      proof: hash256(payload), // Simple proof: hash of output
      signature: new Uint8Array(64), // Signed externally
    };
  }
}
