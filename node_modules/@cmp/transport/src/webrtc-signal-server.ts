/**
 * CMP WebRTC Signaling Relay Server — Production
 * Lightweight WebSocket server that relays SDP offers/answers
 * and ICE candidates between CMP peers.
 *
 * Security:
 *   - Optional HMAC-SHA256 token auth via ?token= query parameter
 *   - Per-IP rate limiting (configurable messages/second)
 *   - Max connections per IP
 *   - Max message size enforcement
 *
 * Usage:
 *   npx ts-node webrtc-signal-server.ts [port]
 *   CMP_SIGNAL_SECRET=mysecret npx ts-node webrtc-signal-server.ts 9090
 *
 * Or import and embed:
 *   import { createSignalingServer } from './webrtc-signal-server';
 *   const { server, wss } = createSignalingServer({ port: 9090, secret: 'mysecret' });
 *
 * @module transport/webrtc-signal-server
 * @author Agent Viscro
 */

import http from 'http';
import crypto from 'crypto';

// ws is loaded lazily in createSignalingServer() — not at module level.
// This allows importing generateSignalToken() without ws being installed.
let WebSocketServer: any = null;

export interface SignalServerOptions {
  port?: number;
  host?: string;
  server?: http.Server;

  /** HMAC-SHA256 secret for token auth. If set, clients must provide ?token= */
  secret?: string;

  /** Max messages per second per IP (default: 50) */
  rateLimit?: number;

  /** Max simultaneous connections per IP (default: 10) */
  maxConnectionsPerIp?: number;

  /** Max message size in bytes (default: 65536) */
  maxMessageSize?: number;

  /** Token expiry window in seconds (default: 300 = 5 minutes) */
  tokenExpirySeconds?: number;
}

interface ConnectedPeer {
  id: string;
  ws: any;
  ip: string;
  connectedAt: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createSignalingServer(options: SignalServerOptions = {}) {
  // Lazy-load ws — only needed when actually creating a server
  if (!WebSocketServer) {
    try {
      const ws = require('ws');
      WebSocketServer = ws.WebSocketServer || ws.Server;
    } catch {
      throw new Error('Missing dependency: npm install ws');
    }
  }

  const port = options.port ?? 9090;
  const host = options.host ?? '0.0.0.0';
  const secret = options.secret ?? process.env.CMP_SIGNAL_SECRET ?? '';
  const rateLimit = options.rateLimit ?? 50;
  const maxConnectionsPerIp = options.maxConnectionsPerIp ?? 10;
  const maxMessageSize = options.maxMessageSize ?? 65536;
  const tokenExpirySeconds = options.tokenExpirySeconds ?? 300;

  // State
  const peers = new Map<string, ConnectedPeer>();
  const ipConnectionCounts = new Map<string, number>();
  const rateLimitMap = new Map<string, RateLimitEntry>();

  // Metrics
  let totalMessagesRelayed = 0;
  let totalConnectionsAccepted = 0;
  let totalConnectionsRejected = 0;

  // ── Auth ──

  function verifyToken(token: string, peerId: string): boolean {
    if (!secret) return true; // No auth configured

    // Token format: "timestamp:hmac"
    const parts = token.split(':');
    if (parts.length !== 2) return false;

    const [timestampStr, providedHmac] = parts;
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) return false;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tokenExpirySeconds) return false;

    // Verify HMAC: HMAC-SHA256(secret, "peerId:timestamp")
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(`${peerId}:${timestampStr}`)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(providedHmac, 'hex'),
      Buffer.from(expectedHmac, 'hex')
    );
  }

  // ── Rate Limiting ──

  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    let entry = rateLimitMap.get(ip);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + 1000 };
      rateLimitMap.set(ip, entry);
    }

    entry.count++;
    return entry.count <= rateLimit;
  }

  // ── Periodic cleanup ──

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
      if (now >= entry.resetAt + 5000) rateLimitMap.delete(ip);
    }
  }, 10000);

  // ── HTTP Server ──

  const httpServer = options.server ?? http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        peers: peers.size,
        uptime: process.uptime(),
        authEnabled: !!secret,
        metrics: {
          totalMessagesRelayed,
          totalConnectionsAccepted,
          totalConnectionsRejected,
        },
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CMP WebRTC Signaling Server');
  });

  // ── WebSocket Server ──

  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: maxMessageSize,
  });

  wss.on('connection', (ws: any, req: any) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';

    // ── Connection limit per IP ──
    const currentCount = ipConnectionCounts.get(ip) ?? 0;
    if (currentCount >= maxConnectionsPerIp) {
      totalConnectionsRejected++;
      ws.close(4001, 'Too many connections from this IP');
      return;
    }

    // ── Extract peer ID and token ──
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const peerId = url.searchParams.get('id');
    const token = url.searchParams.get('token') ?? '';

    if (!peerId || peerId.length < 4 || peerId.length > 64) {
      totalConnectionsRejected++;
      ws.close(4000, 'Missing or invalid ?id= parameter');
      return;
    }

    // ── Token auth ──
    if (secret && !verifyToken(token, peerId)) {
      totalConnectionsRejected++;
      ws.close(4003, 'Invalid or expired token');
      return;
    }

    // ── Register ──
    ipConnectionCounts.set(ip, currentCount + 1);
    const peer: ConnectedPeer = { id: peerId, ws, ip, connectedAt: Date.now() };
    peers.set(peerId, peer);
    totalConnectionsAccepted++;

    console.log(`[+] Peer connected: ${peerId.substring(0, 12)}… from ${ip} (${peers.size} total)`);

    ws.on('message', (raw: any) => {
      // ── Rate limit ──
      if (!checkRateLimit(ip)) {
        // Silently drop — don't waste bandwidth on error responses to floods
        return;
      }

      try {
        const msgStr = typeof raw === 'string' ? raw : raw.toString();
        if (msgStr.length > maxMessageSize) return;

        const msg = JSON.parse(msgStr);
        if (!msg.type || !msg.from) return;

        // Stamp sender ID for safety (prevent spoofing)
        msg.from = peerId;

        totalMessagesRelayed++;

        if (msg.to) {
          // Targeted message → forward to specific peer
          const target = peers.get(msg.to);
          if (target && target.ws.readyState === 1) {
            target.ws.send(JSON.stringify(msg));
          }
        } else {
          // Broadcast (beacons) → forward to all other peers
          const serialized = JSON.stringify(msg);
          for (const [id, p] of peers) {
            if (id !== peerId && p.ws.readyState === 1) {
              p.ws.send(serialized);
            }
          }
        }
      } catch {
        // Malformed message — ignore
      }
    });

    ws.on('close', () => {
      peers.delete(peerId);
      const count = ipConnectionCounts.get(ip) ?? 1;
      if (count <= 1) {
        ipConnectionCounts.delete(ip);
      } else {
        ipConnectionCounts.set(ip, count - 1);
      }
      console.log(`[-] Peer disconnected: ${peerId.substring(0, 12)}… (${peers.size} total)`);
    });

    ws.on('error', () => {
      peers.delete(peerId);
      const count = ipConnectionCounts.get(ip) ?? 1;
      if (count <= 1) {
        ipConnectionCounts.delete(ip);
      } else {
        ipConnectionCounts.set(ip, count - 1);
      }
    });
  });

  // Start listening
  if (!options.server) {
    httpServer.listen(port, host, () => {
      console.log(`\n  ╔══════════════════════════════════════════════╗`);
      console.log(`  ║  CMP WebRTC Signaling Server                 ║`);
      console.log(`  ║  ws://${host}:${port}                         ║`);
      console.log(`  ║  Auth: ${secret ? 'HMAC-SHA256 enabled' : 'disabled (open)'}             ║`);
      console.log(`  ║  Rate limit: ${rateLimit} msg/s per IP              ║`);
      console.log(`  ║  Health: http://${host}:${port}/health        ║`);
      console.log(`  ╚══════════════════════════════════════════════╝\n`);
    });
  }

  // ── Shutdown helper ──

  function shutdown(): void {
    clearInterval(cleanupInterval);
    for (const [, peer] of peers) {
      try { peer.ws.close(1001, 'Server shutting down'); } catch {}
    }
    peers.clear();
    wss.close();
    if (!options.server) httpServer.close();
  }

  return { server: httpServer, wss, peers, shutdown };
}

/**
 * Generate a client auth token for connecting to a secured signal server.
 * Use this on the client side before connecting.
 *
 * @param secret - The shared secret (same as server's CMP_SIGNAL_SECRET)
 * @param peerId - The peer's instance ID hex string
 * @returns Token string to pass as ?token= query parameter
 */
export function generateSignalToken(secret: string, peerId: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(`${peerId}:${timestamp}`)
    .digest('hex');
  return `${timestamp}:${hmac}`;
}

// ── CLI entry point ──
if (require.main === module) {
  const port = parseInt(process.argv[2] || '9090', 10);
  const { shutdown } = createSignalingServer({ port });

  process.on('SIGINT', () => { console.log('\nShutting down...'); shutdown(); process.exit(0); });
  process.on('SIGTERM', () => { shutdown(); process.exit(0); });
}
