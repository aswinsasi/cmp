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

import { Logger } from '../utils/logger';
import type { StageDefinition } from './pipeline-types';

const log = new Logger('StageRouter');

// ─── Stage Assignment ───

export interface StageAssignment {
  stageIndex: number;
  stageName: string;
  deviceId: string;
}

// ─── Stage Router ───

export class StageRouter {
  private localDeviceId: string;

  constructor(localDeviceId: string) {
    this.localDeviceId = localDeviceId;
  }

  /**
   * Assign stages to devices.
   * Strategy: round-robin across available devices.
   * First and last stages prefer local device (input/output).
   */
  assignStages(
    stages: StageDefinition[],
    availableDevices: string[],
  ): StageAssignment[] {
    if (stages.length === 0) return [];

    // Ensure local device is in the list
    const devices = availableDevices.length > 0
      ? availableDevices
      : [this.localDeviceId];

    const assignments: StageAssignment[] = [];

    for (let i = 0; i < stages.length; i++) {
      let deviceId: string;

      if (i === 0 || i === stages.length - 1) {
        // First and last stages on local device (handles I/O)
        deviceId = this.localDeviceId;
      } else if (devices.length === 1) {
        // Only one device — everything runs locally
        deviceId = devices[0];
      } else {
        // Round-robin for middle stages, starting from device index 1
        // (skip local device to maximize distribution)
        const remoteDevices = devices.filter(d => d !== this.localDeviceId);
        if (remoteDevices.length > 0) {
          deviceId = remoteDevices[(i - 1) % remoteDevices.length];
        } else {
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
  reassignStage(
    stageIndex: number,
    currentDeviceId: string,
    availableDevices: string[],
  ): string | null {
    // Pick a device that is NOT the current one
    const alternatives = availableDevices.filter(d => d !== currentDeviceId);
    if (alternatives.length === 0) return null;

    // Pick the first alternative (in a real system, use DeviceScorer)
    return alternatives[0];
  }
}
