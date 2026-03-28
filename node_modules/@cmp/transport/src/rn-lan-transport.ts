/**
 * CMP React Native LAN Transport
 * Drop-in replacement for LANTransport that uses React Native networking:
 *   - react-native-tcp-socket for TCP (reliable data transfer)
 *   - react-native-udp for UDP (beacon discovery)
 *
 * Same wire format as LANTransport:
 *   Beacons: [instanceId: 8B][tcpPort: 2B BE][beacon payload]
 *   Protocol: [0xFE][instanceId: 8B][tcpPort: 2B BE][payload]
 *   TCP frames: [length: 4B BE][payload]
 *
 * Install:
 *   npm install react-native-tcp-socket react-native-udp
 *   cd ios && pod install  (iOS only)
 *
 * @module transport/rn-lan-transport
 * @author Agent Viscro
 */

import TcpSocket from 'react-native-tcp-socket';
import dgram from 'react-native-udp';
import { ITransport, TransportEvent, TransportEventHandler } from './interface';

const CMP_MULTICAST_ADDR = '239.77.67.80';
const CMP_UDP_PORT = 43580;
const MAX_TCP_MESSAGE = 1048576; // 1MB
const FRAME_HEADER_SIZE = 4;
const UDP_HEADER_SIZE = 10; // 8 instanceId + 2 tcpPort
const UDP_MSG_PREFIX = 0xFE;

export class RNLanTransport implements ITransport {
  readonly name = 'rn-lan';
  readonly maxPayloadBytes = MAX_TCP_MESSAGE;
  readonly estimatedBandwidthMbps = 100; // Conservative for Wi-Fi

  private running = false;
  private udpSocket: any = null;
  private tcpServer: any = null;
  private tcpPort = 0;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private beaconData: Uint8Array | null = null;

  /** Random 8-byte ID to filter our own beacons */
  private instanceId: Uint8Array;

  /** peer address "ip:port" → TCP socket */
  private peerConnections = new Map<string, any>();
  /** peer address → receive buffer chunks */
  private receiveBuffers = new Map<string, Uint8Array[]>();
  /** peer address → total buffered bytes */
  private receiveBufferLengths = new Map<string, number>();
  /** peer IP → their advertised TCP port */
  private peerTcpPorts = new Map<string, number>();
  /** Event handlers */
  private handlers = new Map<string, Set<TransportEventHandler>>();

  constructor() {
    this.instanceId = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      this.instanceId[i] = Math.floor(Math.random() * 256);
    }
    if (this.instanceId[0] === UDP_MSG_PREFIX) this.instanceId[0] = 0x00;
  }

  // ═══════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════

  async start(): Promise<void> {
    if (this.running) return;
    await this.startTCP();
    await this.startUDP();
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.stopBeaconing();

    // Close all TCP peer connections
    for (const [addr, socket] of this.peerConnections) {
      try { socket.destroy(); } catch {}
    }
    this.peerConnections.clear();
    this.receiveBuffers.clear();
    this.receiveBufferLengths.clear();

    // Close TCP server
    if (this.tcpServer) {
      try { this.tcpServer.close(); } catch {}
      this.tcpServer = null;
    }

    // Close UDP socket
    if (this.udpSocket) {
      try { this.udpSocket.close(); } catch {}
      this.udpSocket = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  // ═══════════════════════════════════════
  // Discovery (Beaconing)
  // ═══════════════════════════════════════

  async startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void> {
    this.beaconData = beaconData;
    this.sendBeacon();
    this.beaconTimer = setInterval(() => this.sendBeacon(), intervalMs);
  }

  async stopBeaconing(): Promise<void> {
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    this.beaconData = null;
  }

  async startScanning(): Promise<void> { /* always active */ }
  async stopScanning(): Promise<void> { /* no-op */ }

  // ═══════════════════════════════════════
  // Data Transfer
  // ═══════════════════════════════════════

  async sendTo(peerAddress: string, data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');
    if (data.length > MAX_TCP_MESSAGE) throw new Error(`Payload too large: ${data.length}`);

    const [host] = peerAddress.split(':');

    // TCP-first (reliable), UDP fallback for small messages
    let tcpSent = false;
    try {
      let socket = this.peerConnections.get(peerAddress);
      if (socket && socket.destroyed) {
        this.peerConnections.delete(peerAddress);
        socket = undefined;
      }
      if (!socket) {
        socket = await this.connectToPeer(peerAddress);
      }

      // Frame: [length: 4B BE][payload]
      const frame = new Uint8Array(FRAME_HEADER_SIZE + data.length);
      const view = new DataView(frame.buffer);
      view.setUint32(0, data.length, false);
      frame.set(data, FRAME_HEADER_SIZE);

      await new Promise<void>((resolve, reject) => {
        socket.write(frame, 'binary', (err: any) => {
          if (err) reject(err); else resolve();
        });
      });
      tcpSent = true;
    } catch {
      // TCP failed
    }

    // UDP fallback for small messages
    if (!tcpSent && data.length < 60000 && this.udpSocket && host) {
      const headerSize = 1 + 8 + 2;
      const packet = new Uint8Array(headerSize + data.length);
      packet[0] = UDP_MSG_PREFIX;
      packet.set(this.instanceId, 1);
      const pView = new DataView(packet.buffer);
      pView.setUint16(9, this.tcpPort, false);
      packet.set(data, headerSize);

      this.udpSend(packet, CMP_UDP_PORT, host);
    }
  }

  async broadcast(data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');

    // TCP to all connected peers
    const promises: Promise<void>[] = [];
    for (const [addr] of this.peerConnections) {
      promises.push(this.sendTo(addr, data).catch(() => {
        this.peerConnections.delete(addr);
      }));
    }
    await Promise.allSettled(promises);

    // UDP broadcast for unreached peers
    if (this.udpSocket && data.length < 60000) {
      const headerSize = 1 + 8 + 2;
      const packet = new Uint8Array(headerSize + data.length);
      packet[0] = UDP_MSG_PREFIX;
      packet.set(this.instanceId, 1);
      const pView = new DataView(packet.buffer);
      pView.setUint16(9, this.tcpPort, false);
      packet.set(data, headerSize);

      this.udpSend(packet, CMP_UDP_PORT, '255.255.255.255');
    }
  }

  /**
   * Send beacon directly to an IP (for hotspot connections).
   */
  sendBeaconTo(ip: string): void {
    if (!this.udpSocket || !this.beaconData) return;
    const packet = new Uint8Array(UDP_HEADER_SIZE + this.beaconData.length);
    packet.set(this.instanceId, 0);
    const view = new DataView(packet.buffer);
    view.setUint16(8, this.tcpPort, false);
    packet.set(this.beaconData, UDP_HEADER_SIZE);
    this.udpSend(packet, CMP_UDP_PORT, ip);
  }

  // ═══════════════════════════════════════
  // Events
  // ═══════════════════════════════════════

  on(event: string, handler: TransportEventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: TransportEventHandler): void {
    const set = this.handlers.get(event);
    if (set) { set.delete(handler); if (set.size === 0) this.handlers.delete(event); }
  }

  private emit(event: TransportEvent): void {
    for (const key of [event.type, 'all']) {
      const set = this.handlers.get(key);
      if (set) { for (const h of set) { try { h(event); } catch {} } }
    }
  }

  // ═══════════════════════════════════════
  // TCP (react-native-tcp-socket)
  // ═══════════════════════════════════════

  private async startTCP(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.tcpServer = TcpSocket.createServer((socket: any) => {
        this.handleIncomingTCP(socket);
      });

      this.tcpServer.on('error', (err: any) => reject(err));

      // Listen on port 0 = OS assigns free port
      this.tcpServer.listen({ port: 0, host: '0.0.0.0' }, () => {
        const addr = this.tcpServer.address();
        this.tcpPort = addr.port;
        resolve();
      });
    });
  }

  private async connectToPeer(peerAddress: string): Promise<any> {
    const [host, portStr] = peerAddress.split(':');
    const port = parseInt(portStr, 10);
    if (!host || !port) throw new Error(`Invalid peer address: ${peerAddress}`);

    return new Promise((resolve, reject) => {
      const socket = TcpSocket.createConnection(
        { host, port, timeout: 5000 },
        () => {
          this.peerConnections.set(peerAddress, socket);
          this.receiveBuffers.set(peerAddress, []);
          this.receiveBufferLengths.set(peerAddress, 0);

          socket.on('data', (chunk: any) => {
            this.handleTCPData(peerAddress, this.toUint8Array(chunk));
          });
          socket.on('close', () => this.cleanupPeer(peerAddress));
          socket.on('error', () => this.cleanupPeer(peerAddress));

          resolve(socket);
        }
      );
      socket.on('error', (err: any) => reject(err));
    });
  }

  private handleIncomingTCP(socket: any): void {
    const remoteIp = socket.remoteAddress?.replace('::ffff:', '') || 'unknown';
    const knownPort = this.peerTcpPorts.get(remoteIp);
    const addr = knownPort ? `${remoteIp}:${knownPort}` : `${remoteIp}:${socket.remotePort}`;

    this.peerConnections.set(addr, socket);
    this.receiveBuffers.set(addr, []);
    this.receiveBufferLengths.set(addr, 0);

    socket.on('data', (chunk: any) => {
      this.handleTCPData(addr, this.toUint8Array(chunk));
    });
    socket.on('close', () => this.cleanupPeer(addr));
    socket.on('error', () => this.cleanupPeer(addr));
  }

  private handleTCPData(addr: string, chunk: Uint8Array): void {
    // Accumulate buffer chunks
    let chunks = this.receiveBuffers.get(addr) || [];
    let totalLen = (this.receiveBufferLengths.get(addr) || 0) + chunk.length;
    chunks.push(chunk);
    this.receiveBuffers.set(addr, chunks);
    this.receiveBufferLengths.set(addr, totalLen);

    // Try to extract complete frames
    while (totalLen >= FRAME_HEADER_SIZE) {
      // Merge chunks into a single buffer to read the header
      const merged = this.mergeChunks(chunks, totalLen);
      const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);
      const msgLen = view.getUint32(0, false);

      if (totalLen < FRAME_HEADER_SIZE + msgLen) break; // Incomplete frame

      // Extract the message
      const payload = merged.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + msgLen);

      // Keep remainder
      const remainder = merged.slice(FRAME_HEADER_SIZE + msgLen);
      chunks = remainder.length > 0 ? [remainder] : [];
      totalLen = remainder.length;
      this.receiveBuffers.set(addr, chunks);
      this.receiveBufferLengths.set(addr, totalLen);

      // Emit
      this.emit({
        type: 'message',
        peerAddress: addr,
        data: payload,
        transport: this.name,
        timestamp: Date.now(),
      });
    }
  }

  private cleanupPeer(addr: string): void {
    const socket = this.peerConnections.get(addr);
    if (socket) {
      try { socket.destroy(); } catch {}
    }
    this.peerConnections.delete(addr);
    this.receiveBuffers.delete(addr);
    this.receiveBufferLengths.delete(addr);
  }

  // ═══════════════════════════════════════
  // UDP (react-native-udp)
  // ═══════════════════════════════════════

  private async startUDP(): Promise<void> {
    return new Promise((resolve) => {
      this.udpSocket = dgram.createSocket({ type: 'udp4' });

      this.udpSocket.on('error', (err: any) => {
        this.emit({
          type: 'error',
          data: new TextEncoder().encode(err.message),
          transport: this.name,
          timestamp: Date.now(),
        });
      });

      this.udpSocket.on('message', (msg: any, rinfo: any) => {
        this.handleUDP(this.toUint8Array(msg), rinfo);
      });

      this.udpSocket.bind(CMP_UDP_PORT, () => {
        try {
          this.udpSocket.setBroadcast(true);
          // react-native-udp supports addMembership on some platforms
          try { this.udpSocket.addMembership(CMP_MULTICAST_ADDR); } catch {}
        } catch {}
        resolve();
      });
    });
  }

  private handleUDP(msg: Uint8Array, rinfo: { address: string; port: number }): void {
    if (msg.length < 2) return;

    // Protocol message (0xFE prefix)
    if (msg[0] === UDP_MSG_PREFIX) {
      if (msg.length < 11) return;

      // Self-filter by instanceId
      let isOwn = true;
      for (let i = 0; i < 8; i++) {
        if (msg[1 + i] !== this.instanceId[i]) { isOwn = false; break; }
      }
      if (isOwn) return;

      const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
      const senderTcpPort = view.getUint16(9, false);
      const payload = msg.slice(11);
      const peerAddress = `${rinfo.address}:${senderTcpPort}`;

      this.peerTcpPorts.set(rinfo.address + ':' + senderTcpPort, senderTcpPort);

      this.emit({
        type: 'message',
        peerAddress,
        data: payload,
        transport: this.name,
        timestamp: Date.now(),
      });
      return;
    }

    // Beacon
    if (msg.length < UDP_HEADER_SIZE) return;

    // Self-filter
    let isOwn = true;
    for (let i = 0; i < 8; i++) {
      if (msg[i] !== this.instanceId[i]) { isOwn = false; break; }
    }
    if (isOwn) return;

    const view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
    const senderTcpPort = view.getUint16(8, false);
    const beaconPayload = msg.slice(UDP_HEADER_SIZE);
    const peerAddress = `${rinfo.address}:${senderTcpPort}`;

    this.peerTcpPorts.set(rinfo.address, senderTcpPort);

    this.emit({
      type: 'peer_discovered',
      peerAddress,
      data: beaconPayload,
      transport: this.name,
      timestamp: Date.now(),
    });
  }

  private sendBeacon(): void {
    if (!this.udpSocket || !this.beaconData) return;

    const packet = new Uint8Array(UDP_HEADER_SIZE + this.beaconData.length);
    packet.set(this.instanceId, 0);
    const view = new DataView(packet.buffer);
    view.setUint16(8, this.tcpPort, false);
    packet.set(this.beaconData, UDP_HEADER_SIZE);

    // Multicast
    this.udpSend(packet, CMP_UDP_PORT, CMP_MULTICAST_ADDR);
    // Broadcast fallback
    this.udpSend(packet, CMP_UDP_PORT, '255.255.255.255');
  }

  // ═══════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════

  /** Send UDP packet safely */
  private udpSend(data: Uint8Array, port: number, address: string): void {
    if (!this.udpSocket) return;
    try {
      // react-native-udp expects Buffer or base64 string
      this.udpSocket.send(
        data, 0, data.length, port, address,
        () => {} // no-op callback
      );
    } catch {}
  }

  /** Convert any buffer-like object to Uint8Array */
  private toUint8Array(data: any): Uint8Array {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    // react-native-tcp-socket and react-native-udp may return Buffer
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    // String data (base64 encoded from RN)
    if (typeof data === 'string') {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      return bytes;
    }
    return new Uint8Array(0);
  }

  /** Merge accumulated buffer chunks into one Uint8Array */
  private mergeChunks(chunks: Uint8Array[], totalLen: number): Uint8Array {
    if (chunks.length === 1) return chunks[0];
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }
}
