"use strict";
/**
 * CMP v4.0 — Job Type Definitions
 *
 * Types for the persistent job queue system.
 * Jobs wrap mesh compute tasks with lifecycle management,
 * priority ordering, retry logic, and persistence.
 *
 * @module scheduler/job-types
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobMessageType = exports.DEFAULT_JOB_QUEUE_CONFIG = exports.ACTIVE_STATES = exports.TERMINAL_STATES = exports.JobState = void 0;
// ─── Job State Machine ───
/**
 * Job lifecycle:
 *   SUBMITTED → QUEUED → ASSIGNED → RUNNING → COMPLETED
 *                                            → FAILED → RETRY → RUNNING
 *                                            → CANCELLED
 */
var JobState;
(function (JobState) {
    JobState["SUBMITTED"] = "submitted";
    JobState["QUEUED"] = "queued";
    JobState["ASSIGNED"] = "assigned";
    JobState["RUNNING"] = "running";
    JobState["COMPLETED"] = "completed";
    JobState["FAILED"] = "failed";
    JobState["RETRY"] = "retry";
    JobState["CANCELLED"] = "cancelled";
})(JobState || (exports.JobState = JobState = {}));
/** Terminal states — job is done and won't change again */
exports.TERMINAL_STATES = new Set([
    JobState.COMPLETED,
    JobState.FAILED,
    JobState.CANCELLED,
]);
/** Active states — job is in progress */
exports.ACTIVE_STATES = new Set([
    JobState.QUEUED,
    JobState.ASSIGNED,
    JobState.RUNNING,
    JobState.RETRY,
]);
exports.DEFAULT_JOB_QUEUE_CONFIG = {
    maxHistorySize: 1000,
    defaultMaxRetries: 3,
    defaultDeadlineMs: 30000,
    pollIntervalMs: 1000,
    maxConcurrent: 4,
};
// ─── Wire Protocol ───
/** New v4.0 message types for job announcements */
var JobMessageType;
(function (JobMessageType) {
    JobMessageType[JobMessageType["JOB_ANNOUNCE"] = 209] = "JOB_ANNOUNCE";
    JobMessageType[JobMessageType["JOB_CLAIM"] = 210] = "JOB_CLAIM";
    JobMessageType[JobMessageType["JOB_RESULT"] = 211] = "JOB_RESULT";
})(JobMessageType || (exports.JobMessageType = JobMessageType = {}));
//# sourceMappingURL=job-types.js.map