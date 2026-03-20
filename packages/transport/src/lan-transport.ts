/**
 * CMP LAN Transport
 * Uses UDP multicast for beacon discovery and TCP for reliable data transfer.
 * This is the primary transport for devices on the same Wi-Fi/LAN network.
 *
 * Discovery: UDP multicast on 239.77.67.80:43580
 * Data: TCP server/client on port 43581
 *
 * @module transport/lan-transport
 * @author Agent Viscro
 */

import dgram from 'dgram';
import net from 'net';
import { ITransport, TransportEvent, TransportEventHandler } from './interface';

/** CMP multicast group: 239.77.67.80 (CMP in ASCII-ish) */
const CMP_MULTICAST_ADDR = '239.77.67.80';
const CMP_UDP_PORT = 43580;
const CMP_TCP_PORT = 43581;

/** Maximum TCP message size (1MB) */
const MAX_TCP_MESSAGE = 1048576;

/** Frame header size: 4 bytes for length */
const FRAME_HEADER_SIZE = 4;

export class LANTransport implements ITransport {
  readonly name = 'lan';
  readonly maxPayloadBytes = MAX_TCP_MESSAGE;
  readonly estimatedBandwidthMbps = 1000;

  private running = false;
  private udpSocket: dgram.Socket | null = null;
  private tcpServer: net.Server | null = null;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private beaconData: Uint8Array | null = null;

  /** Map of peer address -> TCP socket */
  private peerConnections = new Map<string, net.Socket>();

  /** Map of peer address -> pending receive buffer */
  private receiveBuffers = new Map<string, Buffer>();

  /** Event handlers */
  private handlers = new Map<string, Set<TransportEventHandler>>();

  /** Our local addresses for self-filtering */
  private localAddresses = new Set<string>();

  // ── Lifecycle ──

  async start(): Promise<void> {
    if (this.running) return;

    this.detectLocalAddresses();
    await this.startUDP();
    await this.startTCP();
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopBeaconing();

    // Close all peer connections
    for (const [addr, socket] of this.peerConnections) {
      socket.destroy();
    }
    this.peerConnections.clear();
    this.receiveBuffers.clear();

    // Close UDP
    if (this.udpSocket) {
      try {
        this.udpSocket.dropMembership(CMP_MULTICAST_ADDR);
      } catch {}
      this.udpSocket.close();
      this.udpSocket = null;
    }

    // Close TCP
    if (this.tcpServer) {
      this.tcpServer.close();
      this.tcpServer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Discovery ──

  async startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void> {
    this.beaconData = beaconData;

    // Send immediately
    this.sendBeacon();

    // Then on interval
    this.beaconTimer = setInterval(() => {
      this.sendBeacon();
    }, intervalMs);
  }

  async stopBeaconing(): Promise<void> {
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    this.beaconData = null;
  }

  async startScanning(): Promise<void> {
    // Scanning is always active once UDP is started
    // UDP message handler already processes incoming beacons
  }

  async stopScanning(): Promise<void> {
    // Scanning stops when UDP is stopped
  }

  // ── Data Transfer ──

  async sendTo(peerAddress: string, data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');
    if (data.length > MAX_TCP_MESSAGE) {
      throw new Error(`Payload too large: ${data.length} > ${MAX_TCP_MESSAGE}`);
    }

    let socket = this.peerConnections.get(peerAddress);

    // Connect if not already connected
    if (!socket || socket.destroyed) {
      socket = await this.connectToPeer(peerAddress);
      this.peerConnections.set(peerAddress, socket);
    }

    // Frame: [4-byte big-endian length][payload]
    const frame = Buffer.alloc(FRAME_HEADER_SIZE + data.length);
    frame.writeUInt32BE(data.length, 0);
    frame.set(data, FRAME_HEADER_SIZE);

    return new Promise((resolve, reject) => {
      socket!.write(frame, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async broadcast(data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');

    // Send via TCP to all connected peers
    const promises: Promise<void>[] = [];
    for (const [addr] of this.peerConnections) {
      promises.push(
        this.sendTo(addr, data).catch((err) => {
          // Remove dead connections silently
          this.peerConnections.delete(addr);
        })
      );
    }
    await Promise.allSettled(promises);
  }

  // ── Events ──

  on(event: string, handler: TransportEventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: TransportEventHandler): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(event);
    }
  }

  // ── Internals ──

  private emit(event: TransportEvent): void {
    const set = this.handlers.get(event.type);
    if (set) {
      for (const handler of set) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[LANTransport] Handler error:`, err);
        }
      }
    }

    // Also emit to 'all' listeners
    const allSet = this.handlers.get('all');
    if (allSet) {
      for (const handler of allSet) {
        try {
          handler(event);
        } catch {}
      }
    }
  }

  private detectLocalAddresses(): void {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces) as any[]) {
      if (!iface) continue;
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          this.localAddresses.add(info.address);
        }
      }
    }
  }

  private async startUDP(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.udpSocket.on('error', (err) => {
        this.emit({
          type: 'error',
          data: new TextEncoder().encode(err.message),
          transport: this.name,
          timestamp: Date.now(),
        });
      });

      this.udpSocket.on('message', (msg, rinfo) => {
        // Ignore our own beacons
        if (this.localAddresses.has(rinfo.address)) return;

        this.emit({
          type: 'peer_discovered',
          peerAddress: rinfo.address,
          data: new Uint8Array(msg),
          transport: this.name,
          timestamp: Date.now(),
        });
      });

      this.udpSocket.bind(CMP_UDP_PORT, () => {
        try {
          this.udpSocket!.addMembership(CMP_MULTICAST_ADDR);
          this.udpSocket!.setMulticastTTL(4);
          this.udpSocket!.setMulticastLoopback(false);
          resolve();
        } catch (err) {
          // Multicast may not be available
          resolve();
        }
      });
    });
  }

  private async startTCP(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.tcpServer = net.createServer((socket) => {
        this.handleIncomingTCP(socket);
      });

      this.tcpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Port in use, try next
          this.tcpServer!.listen(CMP_TCP_PORT + 1, resolve);
        } else {
          reject(err);
        }
      });

      this.tcpServer.listen(CMP_TCP_PORT, () => {
        resolve();
      });
    });
  }

  private handleIncomingTCP(socket: net.Socket): void {
    const addr = socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
    this.peerConnections.set(addr, socket);
    this.receiveBuffers.set(addr, Buffer.alloc(0));

    socket.on('data', (chunk) => {
      this.handleTCPData(addr, chunk);
    });

    socket.on('close', () => {
      this.peerConnections.delete(addr);
      this.receiveBuffers.delete(addr);
      this.emit({
        type: 'peer_lost',
        peerAddress: addr,
        transport: this.name,
        timestamp: Date.now(),
      });
    });

    socket.on('error', () => {
      this.peerConnections.delete(addr);
      this.receiveBuffers.delete(addr);
    });
  }

  /**
   * TCP framing: messages are prefixed with 4-byte big-endian length.
   * This handles partial reads and message boundaries.
   */
  private handleTCPData(addr: string, chunk: Buffer): void {
    let buffer = this.receiveBuffers.get(addr);
    if (!buffer) {
      buffer = Buffer.alloc(0);
    }

    buffer = Buffer.concat([buffer, chunk]);

    // Process complete messages
    while (buffer.length >= FRAME_HEADER_SIZE) {
      const msgLength = buffer.readUInt32BE(0);

      if (msgLength > MAX_TCP_MESSAGE) {
        // Malformed message, reset buffer
        buffer = Buffer.alloc(0);
        break;
      }

      const totalLength = FRAME_HEADER_SIZE + msgLength;
      if (buffer.length < totalLength) {
        // Incomplete message, wait for more data
        break;
      }

      // Extract complete message
      const payload = buffer.slice(FRAME_HEADER_SIZE, totalLength);
      buffer = buffer.slice(totalLength);

      this.emit({
        type: 'message',
        peerAddress: addr,
        data: new Uint8Array(payload),
        transport: this.name,
        timestamp: Date.now(),
      });
    }

    this.receiveBuffers.set(addr, buffer);
  }

  private async connectToPeer(address: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(
        { host: address, port: CMP_TCP_PORT, timeout: 5000 },
        () => {
          this.handleIncomingTCP(socket);
          resolve(socket);
        }
      );

      socket.on('error', (err) => {
        reject(new Error(`Failed to connect to ${address}: ${err.message}`));
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${address}`));
      });
    });
  }

  private sendBeacon(): void {
    if (!this.udpSocket || !this.beaconData) return;

    try {
      this.udpSocket.send(
        Buffer.from(this.beaconData),
        0,
        this.beaconData.length,
        CMP_UDP_PORT,
        CMP_MULTICAST_ADDR
      );
    } catch {
      // Silently ignore send failures
    }
  }

  /**
   * Get the number of connected peers.
   */
  get connectedPeerCount(): number {
    return this.peerConnections.size;
  }

  /**
   * Get all connected peer addresses.
   */
  getConnectedPeers(): string[] {
    return [...this.peerConnections.keys()];
  }
}
