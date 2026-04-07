"use strict";
/**
 * CMP v4.0 — Stage Router
 *
 * Assigns pipeline stages to the best available mesh devices.
 * Uses round-robin by default, with optional device scoring
 * integration for smarter placement.
 *
 * @module pipes/stage-router
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StageRouter = void 0;
const logger_1 = require("../utils/logger");
const log = new logger_1.Logger('StageRouter');
// ─── Stage Router ───
class StageRouter {
    localDeviceId;
    constructor(localDeviceId) {
        this.localDeviceId = localDeviceId;
    }
    /**
     * Assign stages to devices.
     * Strategy: round-robin across available devices.
     * First and last stages prefer local device (input/output).
     */
    assignStages(stages, availableDevices) {
        if (stages.length === 0)
            return [];
        // Ensure local device is in the list
        const devices = availableDevices.length > 0
            ? availableDevices
            : [this.localDeviceId];
        const assignments = [];
        for (let i = 0; i < stages.length; i++) {
            let deviceId;
            if (i === 0 || i === stages.length - 1) {
                // First and last stages on local device (handles I/O)
                deviceId = this.localDeviceId;
            }
            else if (devices.length === 1) {
                // Only one device — everything runs locally
                deviceId = devices[0];
            }
            else {
                // Round-robin for middle stages, starting from device index 1
                // (skip local device to maximize distribution)
                const remoteDevices = devices.filter(d => d !== this.localDeviceId);
                if (remoteDevices.length > 0) {
                    deviceId = remoteDevices[(i - 1) % remoteDevices.length];
                }
                else {
                    deviceId = devices[i % devices.length];
                }
            }
            assignments.push({
                stageIndex: i,
                stageName: stages[i].name,
                deviceId,
            });
        }
        log.info(`Routed ${stages.length} stages across ${new Set(assignments.map(a => a.deviceId)).size} devices`);
        return assignments;
    }
    /**
     * Reassign a single stage to a different device (for rebalancing).
     */
    reassignStage(stageIndex, currentDeviceId, availableDevices) {
        // Pick a device that is NOT the current one
        const alternatives = availableDevices.filter(d => d !== currentDeviceId);
        if (alternatives.length === 0)
            return null;
        // Pick the first alternative (in a real system, use DeviceScorer)
        return alternatives[0];
    }
}
exports.StageRouter = StageRouter;
//# sourceMappingURL=stage-router.js.map