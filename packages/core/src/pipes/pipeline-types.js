"use strict";
/**
 * CMP v4.0 — Pipeline Types
 *
 * Type definitions for CMP Pipes — Unix-style streaming pipelines
 * across mesh devices. Each stage runs on a different device
 * simultaneously, streaming data through the pipeline.
 *
 * Example:
 *   pipe: capture_frames | detect_objects | count_people | alert
 *   4 stages, 4 devices, all running simultaneously.
 *
 * @module pipes/pipeline-types
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PIPELINE_CONFIG = exports.PipelineState = exports.PipeMessageType = void 0;
// ─── Wire Protocol Message Types ───
var PipeMessageType;
(function (PipeMessageType) {
    PipeMessageType[PipeMessageType["PIPE_DEFINE"] = 224] = "PIPE_DEFINE";
    PipeMessageType[PipeMessageType["PIPE_START"] = 225] = "PIPE_START";
    PipeMessageType[PipeMessageType["PIPE_DATA"] = 226] = "PIPE_DATA";
    PipeMessageType[PipeMessageType["PIPE_BACKPRESSURE"] = 227] = "PIPE_BACKPRESSURE";
    PipeMessageType[PipeMessageType["PIPE_METRICS"] = 228] = "PIPE_METRICS";
    PipeMessageType[PipeMessageType["PIPE_REBALANCE"] = 229] = "PIPE_REBALANCE";
    PipeMessageType[PipeMessageType["PIPE_STOP"] = 230] = "PIPE_STOP";
})(PipeMessageType || (exports.PipeMessageType = PipeMessageType = {}));
// ─── Pipeline State ───
var PipelineState;
(function (PipelineState) {
    PipelineState["DEFINED"] = "defined";
    PipelineState["STARTING"] = "starting";
    PipelineState["RUNNING"] = "running";
    PipelineState["PAUSED"] = "paused";
    PipelineState["STOPPING"] = "stopping";
    PipelineState["STOPPED"] = "stopped";
    PipelineState["FAILED"] = "failed";
})(PipelineState || (exports.PipelineState = PipelineState = {}));
exports.DEFAULT_PIPELINE_CONFIG = {
    defaultBufferCapacity: 100,
    backpressureThreshold: 0.8,
    rebalanceTimeoutMs: 30000,
    metricsIntervalMs: 5000,
    maxPipelines: 10,
};
//# sourceMappingURL=pipeline-types.js.map