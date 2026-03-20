/**
 * CMP Transport Interface
 * Abstract contract that all transport implementations must fulfill.
 * Provides discovery (beaconing/scanning) and data transfer capabilities.
 *
 * @module transport/interface
 * @author Agent Viscro
 */

export interface TransportEvent {
  type: 'peer_discovered' | 'peer_lost' | 'message' | 'error';
  peerId?: Uint8Array;
  peerAddress?: string;
  data?: Uint8Array;
  transport: string;
  rssi?: number;
  timestamp: number;
}

export type TransportEventHandler = (event: TransportEvent) => void;

export interface ITransport {
  /** Human-readable transport name */
  readonly name: string;

  /** Maximum payload size in a single send (bytes) */
  readonly maxPayloadBytes: number;

  /** Estimated bandwidth in Mbps */
  readonly estimatedBandwidthMbps: number;

  // ── Lifecycle ──

  /** Initialize and start the transport */
  start(): Promise<void>;

  /** Shut down the transport */
  stop(): Promise<void>;

  /** Check if transport is running */
  isRunning(): boolean;

  // ── Discovery ──

  /** Start broadcasting beacon data at the configured interval */
  startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void>;

  /** Stop broadcasting beacons */
  stopBeaconing(): Promise<void>;

  /** Start scanning for other CMP beacons */
  startScanning(): Promise<void>;

  /** Stop scanning */
  stopScanning(): Promise<void>;

  // ── Data Transfer ──

  /** Send data to a specific peer by address */
  sendTo(peerAddress: string, data: Uint8Array): Promise<void>;

  /** Broadcast data to all known peers */
  broadcast(data: Uint8Array): Promise<void>;

  // ── Events ──

  /** Subscribe to transport events */
  on(event: string, handler: TransportEventHandler): void;

  /** Unsubscribe from transport events */
  off(event: string, handler: TransportEventHandler): void;
}
