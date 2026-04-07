"use strict";
/**
 * CMP Execution Engine
 * Layer 5: Orchestrates the full chunk execution lifecycle:
 * load code → decrypt input → sandbox execute → encrypt output → return result.
 *
 * @module runtime/execution-engine
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionEngine = void 0;
const src_1 = require("../../core/src");
const wasm_sandbox_1 = require("./wasm-sandbox");
const resource_monitor_1 = require("./resource-monitor");
const log = new src_1.Logger('Execution');
const DEFAULT_EXEC_CONFIG = {
    sandbox: wasm_sandbox_1.DEFAULT_SANDBOX_CONFIG,
    maxConcurrent: 3,
};
class ExecutionEngine {
    config;
    codeCache;
    meshId;
    activeExecutions = 0;
    constructor(meshId, codeCache, config) {
        this.meshId = meshId;
        this.codeCache = codeCache;
        this.config = {
            sandbox: { ...wasm_sandbox_1.DEFAULT_SANDBOX_CONFIG, ...config?.sandbox },
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
    async executeChunk(chunk, sessionKey, wasmModule) {
        const startTime = Date.now();
        let status = src_1.ChunkStatus.SUCCESS;
        let outputPayload = new Uint8Array(0);
        let cpuMs = 0;
        let memoryPeakMb = 0;
        let gpuMs = 0;
        log.info(`Executing chunk ${(0, src_1.shortId)(chunk.chunkId)} (task ${(0, src_1.shortId)(chunk.taskId)})`, {
            sequence: chunk.sequence,
            totalChunks: chunk.totalChunks,
            payloadSize: chunk.payload.length,
        });
        // Check capacity
        if (this.activeExecutions >= this.config.maxConcurrent) {
            return this.buildResult(chunk, src_1.ChunkStatus.RESOURCE_EXCEEDED, new Uint8Array(0), 0, 0, 0);
        }
        this.activeExecutions++;
        const sandbox = new wasm_sandbox_1.WASMSandbox(this.config.sandbox);
        const monitor = new resource_monitor_1.ResourceMonitor({
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
            let inputData;
            if (chunk.payload.length > 0) {
                try {
                    inputData = (0, src_1.decrypt)(chunk.payload, sessionKey);
                }
                catch {
                    // Payload might not be encrypted (e.g., in testing)
                    inputData = chunk.payload;
                }
            }
            else {
                inputData = new Uint8Array(0);
            }
            // 4. Load module into sandbox
            await sandbox.loadModule(moduleBytes);
            // 5. Start resource monitoring
            monitor.start((reason, details) => {
                violated = true;
                log.warn(`Resource violation: ${reason} — ${details}`);
                sandbox.destroy();
            });
            // 6. Execute
            const rawOutput = await sandbox.execute(chunk.codeRef.entryPoint, inputData);
            if (violated) {
                status = src_1.ChunkStatus.RESOURCE_EXCEEDED;
            }
            else {
                // 7. Check output size
                if (rawOutput.length > chunk.expectedOutput.maxSizeKb * 1024) {
                    log.warn(`Output too large: ${rawOutput.length} > ${chunk.expectedOutput.maxSizeKb * 1024}`);
                    status = src_1.ChunkStatus.RESOURCE_EXCEEDED;
                }
                else {
                    // 8. Encrypt output for requester
                    outputPayload = new Uint8Array((0, src_1.encrypt)(rawOutput, sessionKey));
                }
            }
            // 9. Record metrics
            const metrics = sandbox.getMetrics();
            cpuMs = metrics.cpuTimeMs;
            memoryPeakMb = metrics.memoryPeakMb;
        }
        catch (err) {
            const msg = err.message || 'Unknown error';
            if (msg.includes('timeout') || msg.includes('CPU time')) {
                status = src_1.ChunkStatus.TIMEOUT;
            }
            else if (msg.includes('RESOURCE') || msg.includes('memory')) {
                status = src_1.ChunkStatus.RESOURCE_EXCEEDED;
            }
            else {
                status = src_1.ChunkStatus.FAILED;
            }
            log.warn(`Chunk execution failed: ${msg}`);
            cpuMs = Date.now() - startTime;
        }
        finally {
            monitor.stop();
            sandbox.destroy();
            this.activeExecutions--;
        }
        const execTime = Date.now() - startTime;
        log.info(`Chunk ${(0, src_1.shortId)(chunk.chunkId)} complete: ${src_1.ChunkStatus[status]} (${execTime}ms)`);
        return this.buildResult(chunk, status, outputPayload, cpuMs, memoryPeakMb, gpuMs);
    }
    /**
     * Execute raw WASM module with input data (no encryption, for testing).
     */
    async executeRaw(wasmModule, entryPoint, input, timeoutMs = 5000) {
        const sandbox = new wasm_sandbox_1.WASMSandbox({
            ...this.config.sandbox,
            maxCpuMs: timeoutMs,
        });
        try {
            await sandbox.loadModule(wasmModule);
            const output = await sandbox.execute(entryPoint, input);
            const metrics = sandbox.getMetrics();
            return { output, status: src_1.ChunkStatus.SUCCESS, metrics };
        }
        catch (err) {
            const status = err.message?.includes('timeout') ? src_1.ChunkStatus.TIMEOUT : src_1.ChunkStatus.FAILED;
            return { output: new Uint8Array(0), status, metrics: sandbox.getMetrics() };
        }
        finally {
            sandbox.destroy();
        }
    }
    /**
     * Get current active execution count.
     */
    getActiveCount() {
        return this.activeExecutions;
    }
    buildResult(chunk, status, payload, cpuMs, memoryPeakMb, gpuMs) {
        return {
            chunkId: chunk.chunkId,
            taskId: chunk.taskId,
            executorId: this.meshId,
            status,
            payload,
            executionTimeMs: cpuMs,
            resourceUsed: { cpuMs, memoryPeakMb, gpuMs },
            proof: (0, src_1.hash256)(payload), // Simple proof: hash of output
            signature: new Uint8Array(64), // Signed externally
        };
    }
}
exports.ExecutionEngine = ExecutionEngine;
//# sourceMappingURL=execution-engine.js.map