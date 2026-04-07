"use strict";
/**
 * CMP v4.0 — Code Shipper
 *
 * Sends functions to remote devices for execution against local data.
 * This is the core of Computation Gravity: instead of moving 2GB of
 * data to the code, move 50 bytes of code to the data.
 *
 * Wire Protocol:
 *   CODE_SHIP (0xFD): A → B
 *     "Here's a function — run it against your local data for key X"
 *   CODE_RESULT (0xFE): B → A
 *     "Here's the result of running your function on my data"
 *
 * @module gravity/code-shipper
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeShipper = exports.CODE_RESULT_MSG = exports.CODE_SHIP_MSG = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('CodeShip');
// ─── Wire Protocol ───
exports.CODE_SHIP_MSG = 0xFD;
exports.CODE_RESULT_MSG = 0xFE;
// ─── Hex Helpers ───
function toHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}
// ─── Code Shipper ───
class CodeShipper {
    localDeviceId;
    sendFn = null;
    pending = new Map();
    nextReqId = 1;
    /** Handler for incoming CODE_SHIP requests (executor side) */
    executeHandler = null;
    // Stats
    stats = {
        codeShipped: 0,
        codeShippedBytes: 0,
        resultsReceived: 0,
        dataSavedBytes: 0, // Data NOT transferred thanks to gravity
        avgExecutionTimeMs: 0,
        totalExecutionTimeMs: 0,
    };
    constructor(localDeviceId) {
        this.localDeviceId = localDeviceId;
    }
    /**
     * Set transport for sending messages.
     */
    setTransport(sendFn) {
        this.sendFn = sendFn;
    }
    /**
     * Set the handler for executing shipped code locally.
     * Called when this device receives a CODE_SHIP from a remote requester.
     */
    setExecuteHandler(handler) {
        this.executeHandler = handler;
    }
    // ══════════════════════════════════════
    // Ship Code (requester side)
    // ══════════════════════════════════════
    /**
     * Ship a function to a remote device for execution.
     * Returns a promise that resolves with the result.
     */
    async shipCode(targetDeviceId, dataKey, wasmModule, entryPoint, params = new Uint8Array(0), deadlineMs = 30000) {
        if (!this.sendFn) {
            throw new Error('No transport set — call setTransport() first');
        }
        const requestId = `ship-${this.nextReqId++}`;
        const request = {
            requestId,
            dataKey,
            wasmModule,
            entryPoint,
            params,
            requesterId: this.localDeviceId,
            deadlineMs,
            timestamp: Date.now(),
        };
        return new Promise((resolve, reject) => {
            // Set timeout
            const timeout = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`CODE_SHIP timeout: ${requestId} to ${targetDeviceId} (${deadlineMs}ms)`));
            }, deadlineMs);
            // Track pending request
            this.pending.set(requestId, {
                request,
                targetDeviceId,
                sentAt: Date.now(),
                resolve,
                reject,
                timeout,
            });
            // Send CODE_SHIP
            const wire = {
                reqId: requestId,
                dataKey,
                wasmHex: toHex(wasmModule),
                entry: entryPoint,
                paramsHex: toHex(params),
                from: this.localDeviceId,
                deadline: deadlineMs,
                ts: Date.now(),
            };
            this.sendFn(targetDeviceId, exports.CODE_SHIP_MSG, wire);
            this.stats.codeShipped++;
            this.stats.codeShippedBytes += wasmModule.length + params.length;
            log.info(`CODE_SHIP sent: ${requestId} → ${targetDeviceId} ` +
                `(${wasmModule.length}B code, key="${dataKey}")`);
        });
    }
    // ══════════════════════════════════════
    // Handle Incoming Messages
    // ══════════════════════════════════════
    /**
     * Handle an incoming CODE_SHIP request (executor side).
     */
    async handleCodeShip(wire) {
        if (!this.executeHandler) {
            log.warn(`Received CODE_SHIP but no execute handler set — ignoring ${wire.reqId}`);
            return;
        }
        const request = {
            requestId: wire.reqId,
            dataKey: wire.dataKey,
            wasmModule: fromHex(wire.wasmHex),
            entryPoint: wire.entry,
            params: fromHex(wire.paramsHex),
            requesterId: wire.from,
            deadlineMs: wire.deadline,
            timestamp: wire.ts,
        };
        log.info(`CODE_SHIP received: ${wire.reqId} from ${wire.from} (key="${wire.dataKey}")`);
        try {
            const result = await this.executeHandler(request);
            // Send CODE_RESULT back
            if (this.sendFn) {
                const resultWire = {
                    reqId: result.requestId,
                    executor: this.localDeviceId,
                    ok: result.success,
                    dataHex: result.data ? toHex(result.data) : null,
                    execMs: result.executionTimeMs,
                    readBytes: result.dataReadBytes,
                    error: result.error,
                };
                this.sendFn(wire.from, exports.CODE_RESULT_MSG, resultWire);
            }
        }
        catch (err) {
            // Send error result
            if (this.sendFn) {
                const errorWire = {
                    reqId: wire.reqId,
                    executor: this.localDeviceId,
                    ok: false,
                    dataHex: null,
                    execMs: 0,
                    readBytes: 0,
                    error: err.message,
                };
                this.sendFn(wire.from, exports.CODE_RESULT_MSG, errorWire);
            }
        }
    }
    /**
     * Handle an incoming CODE_RESULT (requester side).
     */
    handleCodeResult(wire) {
        const pending = this.pending.get(wire.reqId);
        if (!pending) {
            log.warn(`CODE_RESULT for unknown request: ${wire.reqId}`);
            return;
        }
        clearTimeout(pending.timeout);
        this.pending.delete(wire.reqId);
        const result = {
            requestId: wire.reqId,
            executorId: wire.executor,
            success: wire.ok,
            data: wire.dataHex ? fromHex(wire.dataHex) : null,
            executionTimeMs: wire.execMs,
            dataReadBytes: wire.readBytes,
            error: wire.error,
        };
        this.stats.resultsReceived++;
        this.stats.totalExecutionTimeMs += result.executionTimeMs;
        this.stats.dataSavedBytes += result.dataReadBytes;
        log.info(`CODE_RESULT received: ${wire.reqId} from ${wire.executor} ` +
            `(${wire.ok ? 'ok' : 'fail'}, ${wire.execMs}ms, ${wire.readBytes}B read)`);
        pending.resolve(result);
    }
    // ══════════════════════════════════════
    // Stats
    // ══════════════════════════════════════
    getStats() {
        return {
            ...this.stats,
            pendingRequests: this.pending.size,
            avgExecutionTimeMs: this.stats.resultsReceived > 0
                ? Math.round(this.stats.totalExecutionTimeMs / this.stats.resultsReceived)
                : 0,
        };
    }
    /**
     * Cancel all pending requests.
     */
    cancelAll() {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('All code ship requests cancelled'));
        }
        this.pending.clear();
    }
}
exports.CodeShipper = CodeShipper;
//# sourceMappingURL=code-shipper.js.map