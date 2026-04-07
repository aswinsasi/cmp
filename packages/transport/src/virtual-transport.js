"use strict";
/**
 * CMP Virtual Transport
 * In-memory transport for testing and mesh simulation.
 * All VirtualTransport instances sharing the same VirtualNetwork
 * can discover and communicate with each other.
 *
 * @module transport/virtual-transport
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VirtualTransport = exports.VirtualNetwork = void 0;
/**
 * Shared virtual network that connects VirtualTransport instances.
 */
class VirtualNetwork {
    nodes = new Map();
    /** Simulated latency in ms (0 = instant) */
    latencyMs = 0;
    /** Packet loss rate (0.0 - 1.0) */
    packetLossRate = 0;
    register(id, transport) {
        this.nodes.set(id, transport);
    }
    unregister(id) {
        this.nodes.delete(id);
    }
    getNodes() {
        return [...this.nodes.keys()];
    }
    /**
     * Deliver a message from one node to another.
     */
    async deliver(fromId, toId, data) {
        if (Math.random() < this.packetLossRate)
            return; // Simulate packet loss
        const target = this.nodes.get(toId);
        if (!target)
            return;
        const event = {
            type: 'message',
            peerAddress: fromId,
            data,
            transport: 'virtual',
            timestamp: Date.now(),
        };
        if (this.latencyMs > 0) {
            await new Promise((r) => setTimeout(r, this.latencyMs));
        }
        target.receiveEvent(event);
    }
    /**
     * Broadcast a message from one node to all others.
     */
    async broadcastFrom(fromId, data) {
        const promises = [];
        for (const [id] of this.nodes) {
            if (id !== fromId) {
                promises.push(this.deliver(fromId, id, data));
            }
        }
        await Promise.allSettled(promises);
    }
    /**
     * Broadcast a beacon from one node (triggers peer_discovered on others).
     */
    async beaconFrom(fromId, data) {
        if (Math.random() < this.packetLossRate)
            return;
        for (const [id, transport] of this.nodes) {
            if (id !== fromId) {
                const event = {
                    type: 'peer_discovered',
                    peerAddress: fromId,
                    data,
                    transport: 'virtual',
                    timestamp: Date.now(),
                };
                if (this.latencyMs > 0) {
                    setTimeout(() => transport.receiveEvent(event), this.latencyMs);
                }
                else {
                    transport.receiveEvent(event);
                }
            }
        }
    }
}
exports.VirtualNetwork = VirtualNetwork;
/**
 * Virtual transport instance - one per simulated node.
 */
class VirtualTransport {
    nodeId;
    network;
    name = 'virtual';
    maxPayloadBytes = 1048576; // 1MB
    estimatedBandwidthMbps = 10000; // Unlimited (in-memory)
    running = false;
    handlers = new Map();
    beaconTimer = null;
    beaconData = null;
    constructor(nodeId, network) {
        this.nodeId = nodeId;
        this.network = network;
        network.register(nodeId, this);
    }
    // ── Lifecycle ──
    async start() {
        this.running = true;
    }
    async stop() {
        this.running = false;
        await this.stopBeaconing();
        this.network.unregister(this.nodeId);
        this.handlers.clear();
    }
    isRunning() {
        return this.running;
    }
    // ── Discovery ──
    async startBeaconing(beaconData, intervalMs) {
        this.beaconData = beaconData;
        await this.network.beaconFrom(this.nodeId, beaconData);
        this.beaconTimer = setInterval(() => {
            if (this.beaconData) {
                this.network.beaconFrom(this.nodeId, this.beaconData);
            }
        }, intervalMs);
    }
    async stopBeaconing() {
        if (this.beaconTimer) {
            clearInterval(this.beaconTimer);
            this.beaconTimer = null;
        }
        this.beaconData = null;
    }
    async startScanning() {
        // Virtual scanning is always active
    }
    async stopScanning() {
        // No-op
    }
    // ── Data Transfer ──
    async sendTo(peerAddress, data) {
        if (!this.running)
            throw new Error('Transport not running');
        await this.network.deliver(this.nodeId, peerAddress, data);
    }
    async broadcast(data) {
        if (!this.running)
            throw new Error('Transport not running');
        await this.network.broadcastFrom(this.nodeId, data);
    }
    // ── Events ──
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event).add(handler);
    }
    off(event, handler) {
        const set = this.handlers.get(event);
        if (set) {
            set.delete(handler);
        }
    }
    /**
     * Called by VirtualNetwork to deliver events.
     * @internal
     */
    receiveEvent(event) {
        if (!this.running)
            return;
        const set = this.handlers.get(event.type);
        if (set) {
            for (const handler of set) {
                try {
                    handler(event);
                }
                catch (err) {
                    console.error(`[VirtualTransport:${this.nodeId}] Handler error:`, err);
                }
            }
        }
        const allSet = this.handlers.get('all');
        if (allSet) {
            for (const handler of allSet) {
                try {
                    handler(event);
                }
                catch { }
            }
        }
    }
}
exports.VirtualTransport = VirtualTransport;
//# sourceMappingURL=virtual-transport.js.map