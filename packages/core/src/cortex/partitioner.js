"use strict";
/**
 * CMP v3.0 — Model Partitioner
 * Splits a neural network into layer partitions distributed across mesh devices.
 *
 * Strategy:
 *   1. Sort devices by available memory (descending)
 *   2. Greedily assign consecutive layers to devices
 *   3. Each device gets layers proportional to its memory capacity
 *   4. Ensures each partition is a contiguous block of layers
 *
 * @module cortex/partitioner
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.partitionModel = partitionModel;
exports.rebalancePartitions = rebalancePartitions;
function randomHex(bytes) {
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++)
        arr[i] = Math.floor(Math.random() * 256);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ─── Partitioner ───
/**
 * Partition a model across available devices.
 * Returns partition assignments (device → layer range).
 *
 * @param manifest - Model metadata
 * @param devices - Available devices with their capacities
 * @param maxPartitionsPerDevice - Limit partitions per device
 */
function partitionModel(manifest, devices, maxPartitionsPerDevice = 4) {
    if (devices.length === 0)
        throw new Error('No devices available for partitioning');
    if (manifest.totalLayers === 0)
        throw new Error('Model has no layers');
    // Sort by available memory descending
    const sorted = [...devices].sort((a, b) => b.availableMemoryBytes - a.availableMemoryBytes);
    // Calculate total available memory
    const totalAvailable = sorted.reduce((sum, d) => sum + d.availableMemoryBytes, 0);
    if (totalAvailable < manifest.totalSizeBytes) {
        throw new Error(`Insufficient mesh memory: need ${manifest.totalSizeBytes} bytes, ` +
            `available ${totalAvailable} bytes across ${sorted.length} devices`);
    }
    // Determine how many layers each device should handle
    // Proportional to their memory share, weighted by compute speed
    const totalWeight = sorted.reduce((sum, d) => {
        return sum + Math.min(d.availableMemoryBytes, manifest.totalSizeBytes) * d.computeSpeed;
    }, 0);
    const assignments = [];
    let layerCursor = 0;
    for (let i = 0; i < sorted.length && layerCursor < manifest.totalLayers; i++) {
        const device = sorted[i];
        const weight = Math.min(device.availableMemoryBytes, manifest.totalSizeBytes) * device.computeSpeed;
        const fraction = weight / totalWeight;
        // Calculate layers for this device
        let layerCount;
        if (i === sorted.length - 1 || layerCursor + Math.round(fraction * manifest.totalLayers) >= manifest.totalLayers) {
            // Last device gets remaining layers
            layerCount = manifest.totalLayers - layerCursor;
        }
        else {
            layerCount = Math.max(1, Math.round(fraction * manifest.totalLayers));
        }
        if (layerCount <= 0)
            continue;
        const startLayer = layerCursor;
        const endLayer = layerCursor + layerCount - 1;
        // Calculate partition size
        let sizeBytes = 0;
        for (let l = startLayer; l <= endLayer; l++) {
            sizeBytes += manifest.layerSizes[l] || 0;
        }
        assignments.push({
            partitionId: randomHex(8),
            layerRange: [startLayer, endLayer],
            device: device.deviceId,
            sizeBytes,
        });
        layerCursor += layerCount;
    }
    // Verify all layers assigned
    if (layerCursor < manifest.totalLayers) {
        // Assign remaining to the first device
        const remaining = manifest.totalLayers - layerCursor;
        const lastAssignment = assignments[assignments.length - 1];
        lastAssignment.layerRange[1] = manifest.totalLayers - 1;
        for (let l = layerCursor; l < manifest.totalLayers; l++) {
            lastAssignment.sizeBytes += manifest.layerSizes[l] || 0;
        }
    }
    return assignments;
}
/**
 * Rebalance partitions when devices join or leave.
 * Returns new assignments that minimize data movement.
 *
 * @param manifest - Model metadata
 * @param currentAssignments - Current partition assignments
 * @param newDevices - Updated device list
 */
function rebalancePartitions(manifest, currentAssignments, newDevices) {
    // Simple strategy: re-partition from scratch, then compute diff
    const newAssignments = partitionModel(manifest, newDevices);
    const migrations = [];
    // Build current device → layers mapping
    const currentMap = new Map();
    for (const a of currentAssignments) {
        for (let l = a.layerRange[0]; l <= a.layerRange[1]; l++) {
            if (!currentMap.has(a.device))
                currentMap.set(a.device, new Set());
            currentMap.get(a.device).add(l);
        }
    }
    // Detect what moved
    for (const newA of newAssignments) {
        for (let l = newA.layerRange[0]; l <= newA.layerRange[1]; l++) {
            // Find who currently has this layer
            let currentDevice = null;
            for (const [dev, layers] of currentMap) {
                if (layers.has(l)) {
                    currentDevice = dev;
                    break;
                }
            }
            if (currentDevice && currentDevice !== newA.device) {
                migrations.push({
                    from: currentDevice,
                    to: newA.device,
                    layerRange: [l, l],
                });
            }
        }
    }
    // Compact migrations (merge consecutive layer ranges)
    const compacted = compactMigrations(migrations);
    return { assignments: newAssignments, migrations: compacted };
}
function compactMigrations(migrations) {
    if (migrations.length === 0)
        return [];
    const sorted = [...migrations].sort((a, b) => {
        if (a.from !== b.from)
            return a.from.localeCompare(b.from);
        if (a.to !== b.to)
            return a.to.localeCompare(b.to);
        return a.layerRange[0] - b.layerRange[0];
    });
    const result = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const last = result[result.length - 1];
        const curr = sorted[i];
        if (last.from === curr.from && last.to === curr.to && last.layerRange[1] + 1 === curr.layerRange[0]) {
            last.layerRange[1] = curr.layerRange[1];
        }
        else {
            result.push(curr);
        }
    }
    return result;
}
//# sourceMappingURL=partitioner.js.map