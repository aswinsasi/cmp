/**
 * CMP WebRTC Signaling Interface
 * Pluggable abstraction for WebRTC offer/answer/ICE exchange.
 *
 * CMP is transport-agnostic — the signaling layer only needs to relay
 * small JSON messages between peers who know each other's peerId.
 * Implementations can use WebSocket, HTTP polling, Firebase, MQTT,
 * or even another CMP transport (LAN beacon piggyback).
 *
 * @module transport/webrtc/signaling
 * @author Agent Viscro
 */

// ── Signal Types ──

export type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'beacon' | 'peer-leave';

export interface Signal {
  type: SignalType;
  from: string;       // sender peerId
  to?: string;        // target peerId (undefined = broadcast)
  meshId?: string;    // CMP mesh ID for room scoping
  payload: unknown;   // SDP, ICECandidate, beacon bytes, etc.
  timestamp: number;
}

export type SignalHandler = (signal: Signal) => void;

// ── Signaling Interface ──

export interface ISignaling {
  /** Connect to the signaling service and join a mesh room */
  connect(peerId: string, meshId: string): Promise<void>;

  /** Disconnect from signaling */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Send a signal to a specific peer */
  send(signal: Signal): Promise<void>;

  /** Broadcast a signal to all peers in the mesh room */
  broadcast(signal: Signal): Promise<void>;

  /** Subscribe to incoming signals */
  onSignal(handler: SignalHandler): void;

  /** Unsubscribe from signals */
  offSignal(handler: SignalHandler): void;
}

// ── WebSocket Signaling (Default Implementation) ──

/**
 * Default WebSocket-based signaling client.
 * Connects to a lightweight relay server that routes signals between
 * CMP peers in the same mesh room.
 *
 * Protocol (JSON over WS):
 *   → { action: "join", peerId, meshId }
 *   → { action: "signal", signal: Signal }
 *   ← { action: "signal", signal: Signal }
 *   ← { action: "peers", peerIds: string[] }
 *   ← { action: "peer-joined", peerId }
 *   ← { action: "peer-left", peerId }
 */
export class WebSocketSignaling implements ISignaling {
  private ws: WebSocket | null = null;
  private peerId = '';
  private meshId = '';
  private handlers = new Set<SignalHandler>();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;

  /** Known peers in the room (for broadcast routing) */
  private roomPeers = new Set<string>();

  constructor(
    /** WebSocket server URL, e.g. "wss://signal.example.com" */
    private serverUrl: string,
    private options: {
      /** Auto-reconnect on disconnect (default: true) */
      autoReconnect?: boolean;
    } = {}
  ) {
    this.options.autoReconnect ??= true;
  }

  async connect(peerId: string, meshId: string): Promise<void> {
    this.peerId = peerId;
    this.meshId = meshId;

    return new Promise((resolve, reject) => {
      try {
        // Support both browser WebSocket and Node.js ws
        const WS = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
        this.ws = new WS(this.serverUrl);
      } catch (err) {
        reject(new Error(
          `WebSocket not available. Install "ws" package for Node.js: npm install ws. Error: ${err}`
        ));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Signaling connection timeout (10s)'));
        this.ws?.close();
      }, 10000);

      this.ws!.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        this.reconnectAttempts = 0;

        // Join the mesh room
        this.wsSend({
          action: 'join',
          peerId: this.peerId,
          meshId: this.meshId,
        });

        resolve();
      };

      this.ws!.onmessage = (event: MessageEvent | { data: string }) => {
        const raw = typeof event === 'object' && 'data' in event ? event.data : event;
        try {
          const msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
          this.handleMessage(msg);
        } catch {}
      };

      this.ws!.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;

        if (wasConnected && this.options.autoReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws!.onerror = (err: Event | Error) => {
        if (!this.connected) {
          clearTimeout(timeout);
          reject(new Error(`Signaling connection failed: ${this.serverUrl}`));
        }
      };
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
    this.roomPeers.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send(signal: Signal): Promise<void> {
    if (!this.connected || !this.ws) {
      throw new Error('Signaling not connected');
    }
    this.wsSend({ action: 'signal', signal });
  }

  async broadcast(signal: Signal): Promise<void> {
    // Send with no `to` field — server relays to all room members
    const broadcastSignal: Signal = { ...signal, to: undefined };
    await this.send(broadcastSignal);
  }

  onSignal(handler: SignalHandler): void {
    this.handlers.add(handler);
  }

  offSignal(handler: SignalHandler): void {
    this.handlers.delete(handler);
  }

  /** Get currently known peers in the room */
  getRoomPeers(): string[] {
    return [...this.roomPeers];
  }

  // ── Internals ──

  private handleMessage(msg: any): void {
    switch (msg.action) {
      case 'signal':
        if (msg.signal) {
          const signal = msg.signal as Signal;
          // Ignore our own signals
          if (signal.from === this.peerId) return;
          for (const handler of this.handlers) {
            try { handler(signal); } catch {}
          }
        }
        break;

      case 'peers':
        // Initial peer list on join
        if (Array.isArray(msg.peerIds)) {
          this.roomPeers.clear();
          for (const id of msg.peerIds) {
            if (id !== this.peerId) this.roomPeers.add(id);
          }
        }
        break;

      case 'peer-joined':
        if (msg.peerId && msg.peerId !== this.peerId) {
          this.roomPeers.add(msg.peerId);
        }
        break;

      case 'peer-left':
        if (msg.peerId) {
          this.roomPeers.delete(msg.peerId);
          // Emit peer-leave signal
          for (const handler of this.handlers) {
            try {
              handler({
                type: 'peer-leave',
                from: msg.peerId,
                meshId: this.meshId,
                payload: null,
                timestamp: Date.now(),
              });
            } catch {}
          }
        }
        break;
    }
  }

  private wsSend(data: object): void {
    try {
      this.ws?.send(JSON.stringify(data));
    } catch {}
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.peerId, this.meshId);
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }
}
