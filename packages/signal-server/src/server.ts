/**
 * CMP Signal Server
 *
 * Lightweight WebSocket relay for WebRTC peer signaling.
 * Devices connect, join a room, exchange SDP offers/answers
 * and ICE candidates. No computation — pure relay.
 *
 * Protocol:
 *   Client → Server:
 *     { type: "join", room: "mesh-123", peerId: "abc" }
 *     { type: "signal", to: "xyz", from: "abc", data: <SDP/ICE> }
 *     { type: "leave" }
 *
 *   Server → Client:
 *     { type: "peers", peers: ["xyz", "def"] }         — current room members
 *     { type: "peer_joined", peerId: "xyz" }            — new peer arrived
 *     { type: "peer_left", peerId: "xyz" }              — peer departed
 *     { type: "signal", from: "xyz", data: <SDP/ICE> }  — forwarded signal
 *
 * Usage:
 *   npx tsx packages/signal-server/src/server.ts
 *   npx tsx packages/signal-server/src/server.ts --port 9090
 *
 * Deploy:
 *   Works on Railway, Fly.io, Render, any Node.js host.
 *   Single file, zero config, stateless.
 *
 * @module signal-server
 * @author Agent Viscro
 */

import { WebSocketServer, WebSocket } from 'ws';

// ─── Types ───

interface Client {
  ws: WebSocket;
  peerId: string;
  room: string | null;
  joinedAt: number;
}

interface Room {
  clients: Map<string, Client>;
  createdAt: number;
}

// ─── Signal Server ───

export class SignalServer {
  private wss: WebSocketServer | null = null;
  private rooms = new Map<string, Room>();
  private clients = new Map<WebSocket, Client>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Config
  private port: number;
  private maxRoomSize: number;
  private roomTTLMs: number;

  // Stats
  private stats = {
    totalConnections: 0,
    totalSignals: 0,
    totalRooms: 0,
    activeConnections: 0,
  };

  constructor(config: {
    port?: number;
    maxRoomSize?: number;
    roomTTLMs?: number;
  } = {}) {
    this.port = config.port ?? 9090;
    this.maxRoomSize = config.maxRoomSize ?? 20;
    this.roomTTLMs = config.roomTTLMs ?? 3600000; // 1 hour
  }

  /**
   * Start the signal server.
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => {
        console.log(`[Signal] Listening on ws://localhost:${this.port}`);
        resolve();
      });

      this.wss.on('connection', (ws) => this.handleConnection(ws));

      // Cleanup stale rooms every 5 minutes
      this.cleanupTimer = setInterval(() => this.cleanupRooms(), 300000);
    });
  }

  /**
   * Stop the signal server.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }

      // Close all client connections
      for (const client of this.clients.values()) {
        try { client.ws.close(); } catch {}
      }
      this.clients.clear();
      this.rooms.clear();

      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ══════════════════════════════════════
  // Connection Handling
  // ══════════════════════════════════════

  private handleConnection(ws: WebSocket): void {
    this.stats.totalConnections++;
    this.stats.activeConnections++;

    const client: Client = {
      ws,
      peerId: '',
      room: null,
      joinedAt: Date.now(),
    };
    this.clients.set(ws, client);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(client, msg);
      } catch {
        this.send(ws, { type: 'error', message: 'Invalid JSON' });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(client);
      this.clients.delete(ws);
      this.stats.activeConnections--;
    });

    ws.on('error', () => {
      this.handleDisconnect(client);
      this.clients.delete(ws);
      this.stats.activeConnections--;
    });
  }

  private handleMessage(client: Client, msg: any): void {
    switch (msg.type) {
      case 'join':
        this.handleJoin(client, msg.room, msg.peerId);
        break;
      case 'signal':
        this.handleSignal(client, msg.to, msg.data);
        break;
      case 'leave':
        this.handleLeave(client);
        break;
      case 'ping':
        this.send(client.ws, { type: 'pong' });
        break;
      default:
        this.send(client.ws, { type: 'error', message: `Unknown type: ${msg.type}` });
    }
  }

  // ══════════════════════════════════════
  // Room Management
  // ══════════════════════════════════════

  private handleJoin(client: Client, roomId: string, peerId: string): void {
    if (!roomId || !peerId) {
      this.send(client.ws, { type: 'error', message: 'Room and peerId required' });
      return;
    }

    // Leave current room if any
    if (client.room) this.handleLeave(client);

    client.peerId = peerId;
    client.room = roomId;

    // Get or create room
    let room = this.rooms.get(roomId);
    if (!room) {
      room = { clients: new Map(), createdAt: Date.now() };
      this.rooms.set(roomId, room);
      this.stats.totalRooms++;
    }

    // Check room size
    if (room.clients.size >= this.maxRoomSize) {
      this.send(client.ws, { type: 'error', message: 'Room full' });
      return;
    }

    // Notify existing peers
    for (const [, existing] of room.clients) {
      this.send(existing.ws, { type: 'peer_joined', peerId });
    }

    // Add to room
    room.clients.set(peerId, client);

    // Send current peer list
    const peers = Array.from(room.clients.keys()).filter(id => id !== peerId);
    this.send(client.ws, { type: 'peers', peers, room: roomId });

    console.log(`[Signal] ${peerId} joined room "${roomId}" (${room.clients.size} members)`);
  }

  private handleLeave(client: Client): void {
    if (!client.room) return;

    const room = this.rooms.get(client.room);
    if (room) {
      room.clients.delete(client.peerId);

      // Notify remaining peers
      for (const [, remaining] of room.clients) {
        this.send(remaining.ws, { type: 'peer_left', peerId: client.peerId });
      }

      // Remove empty rooms
      if (room.clients.size === 0) {
        this.rooms.delete(client.room);
      }

      console.log(`[Signal] ${client.peerId} left room "${client.room}"`);
    }

    client.room = null;
  }

  // ══════════════════════════════════════
  // Signal Relay
  // ══════════════════════════════════════

  private handleSignal(client: Client, toPeerId: string, data: any): void {
    if (!client.room) {
      this.send(client.ws, { type: 'error', message: 'Not in a room' });
      return;
    }

    const room = this.rooms.get(client.room);
    if (!room) return;

    const target = room.clients.get(toPeerId);
    if (!target) {
      this.send(client.ws, { type: 'error', message: `Peer ${toPeerId} not found` });
      return;
    }

    // Forward signal
    this.send(target.ws, {
      type: 'signal',
      from: client.peerId,
      data,
    });

    this.stats.totalSignals++;
  }

  // ══════════════════════════════════════
  // Utilities
  // ══════════════════════════════════════

  private send(ws: WebSocket, msg: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private handleDisconnect(client: Client): void {
    this.handleLeave(client);
  }

  private cleanupRooms(): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (room.clients.size === 0 || now - room.createdAt > this.roomTTLMs) {
        // Close remaining connections
        for (const [, client] of room.clients) {
          this.send(client.ws, { type: 'room_expired' });
        }
        this.rooms.delete(id);
      }
    }
  }

  getStats(): typeof this.stats & { activeRooms: number } {
    return { ...this.stats, activeRooms: this.rooms.size };
  }
}

// ─── CLI Entry ───

if (require.main === module || process.argv[1]?.includes('server')) {
  const port = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? '9090');
  const server = new SignalServer({ port });
  server.start();

  process.on('SIGINT', async () => {
    console.log('\n[Signal] Shutting down...');
    await server.stop();
    process.exit(0);
  });
}
