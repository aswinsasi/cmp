/**
 * CMP BLE Transport
 * Bluetooth Low Energy transport for laptop-to-laptop mesh.
 * Uses @stoprocent/noble (central/scan) and @stoprocent/bleno (peripheral/advertise).
 *
 * Architecture:
 *   - Discovery: BLE advertisements carry CMP beacon (38 bytes in manufacturer data)
 *   - Data transfer: GATT characteristics for protocol messages
 *   - Large messages: Fragmented into BLE_CHUNK_SIZE packets with sequence headers
 *
 * Install:
 *   npm install @stoprocent/noble @stoprocent/bleno
 *
 * Windows: Requires Bluetooth 4.0+ adapter (most laptops have this)
 * Linux: May need: sudo setcap cap_net_raw+eip $(which node)
 *
 * Wire format (same as LAN transport):
 *   Beacons: [instanceId: 8B][tcpPort: 2B BE][beacon payload]
 *   Protocol messages: via GATT write/notify
 *
 * @module transport/ble-transport
 * @author Agent Viscro
 */

// NOTE: These are dynamically required to avoid breaking builds
// where BLE deps aren't installed. Import with require() at runtime.
let noble: any = null;
let bleno: any = null;

try { noble = require('@stoprocent/noble'); } catch {
  try { noble = require('@abandonware/noble'); } catch {}
}
try { bleno = require('@stoprocent/bleno'); } catch {
  try { bleno = require('@abandonware/bleno'); } catch {}
}

import { ITransport, TransportEvent, TransportEventHandler } from './interface';

// ── Constants ──
const CMP_SERVICE_UUID = '434d5000000000000000000000000001'; // "CMP\0..."
const CMP_WRITE_CHAR_UUID = '434d5000000000000000000000000002'; // Write messages to this node
const CMP_NOTIFY_CHAR_UUID = '434d5000000000000000000000000003'; // Receive messages from this node

/** CMP manufacturer ID (custom, not registered with Bluetooth SIG) */
const CMP_MANUFACTURER_ID = 0x4D43; // "CM" in little-endian

/** Max BLE MTU for data chunks (conservative, most support 512) */
const BLE_CHUNK_SIZE = 480;

/** Fragment header: [totalLen: 4B][offset: 4B][payload] */
const FRAG_HEADER_SIZE = 8;

/** Max reassembly buffer age before discard (ms) */
const REASSEMBLY_TIMEOUT = 10000;

export class BLETransport implements ITransport {
  readonly name = 'ble';
  readonly maxPayloadBytes = 1048576; // 1MB (fragmented)
  readonly estimatedBandwidthMbps = 2; // BLE 4.2 practical throughput

  private running = false;
  private beaconData: Uint8Array | null = null;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private handlers = new Map<string, Set<TransportEventHandler>>();

  /** Random 8-byte instance ID for self-filtering */
  private instanceId: Uint8Array;

  /** Discovered peers: bleAddress → { address, instanceId, lastSeen } */
  private discoveredPeers = new Map<string, {
    bleAddress: string;
    instanceIdHex: string;
    peripheral?: any;
    writeChar?: any;
    connected: boolean;
    lastSeen: number;
  }>();

  /** Incoming message reassembly buffers: senderAddress → { chunks, totalLen, received } */
  private reassemblyBuffers = new Map<string, {
    totalLen: number;
    chunks: Map<number, Uint8Array>;
    receivedBytes: number;
    startTime: number;
  }>();

  /** GATT notify subscribers (connected centrals) */
  private notifySubscribers = new Set<any>();

  /** Bleno write characteristic reference */
  private writeCharacteristic: any = null;
  private notifyCharacteristic: any = null;

  constructor() {
    this.instanceId = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      this.instanceId[i] = Math.floor(Math.random() * 256);
    }
  }

  // ═══════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════

  async start(): Promise<void> {
    if (this.running) return;

    if (!noble || !bleno) {
      throw new Error(
        'BLE transport requires @stoprocent/noble and @stoprocent/bleno. ' +
        'Install: npm install @stoprocent/noble @stoprocent/bleno'
      );
    }

    // Wait for Bluetooth to be ready
    await this.waitForBluetooth();

    // Start GATT server (peripheral role)
    await this.startGATTServer();

    // Start scanning (central role)
    await this.startNobleScanning();

    this.running = true;
    console.log('[BLE] Transport started');
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.stopBeaconing();

    // Stop scanning
    try { noble.stopScanning(); } catch {}

    // Stop advertising
    try { bleno.stopAdvertising(); } catch {}

    // Disconnect all peers
    for (const [addr, peer] of this.discoveredPeers) {
      if (peer.peripheral && peer.connected) {
        try { peer.peripheral.disconnect(); } catch {}
      }
    }
    this.discoveredPeers.clear();
    this.reassemblyBuffers.clear();
    this.notifySubscribers.clear();

    console.log('[BLE] Transport stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ═══════════════════════════════════════
  // Discovery (BLE Advertisements)
  // ═══════════════════════════════════════

  async startBeaconing(beaconData: Uint8Array, intervalMs: number): Promise<void> {
    this.beaconData = beaconData;
    this.advertiseBeacon();
    // Re-advertise periodically (BLE ads are stateless)
    this.beaconTimer = setInterval(() => this.advertiseBeacon(), intervalMs);
  }

  async stopBeaconing(): Promise<void> {
    if (this.beaconTimer) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    this.beaconData = null;
    try { bleno.stopAdvertising(); } catch {}
  }

  async startScanning(): Promise<void> {
    // Already started in start()
  }

  async stopScanning(): Promise<void> {
    try { noble.stopScanning(); } catch {}
  }

  // ═══════════════════════════════════════
  // Data Transfer (GATT)
  // ═══════════════════════════════════════

  async sendTo(peerAddress: string, data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');

    const peer = this.discoveredPeers.get(peerAddress);
    if (!peer) {
      throw new Error(`Unknown BLE peer: ${peerAddress}`);
    }

    // Connect if not connected
    if (!peer.connected || !peer.writeChar) {
      await this.connectToPeer(peer);
    }

    if (!peer.writeChar) {
      throw new Error(`No write characteristic for peer ${peerAddress}`);
    }

    // Fragment if needed
    if (data.length <= BLE_CHUNK_SIZE) {
      // Single packet — no fragmentation header needed
      await this.bleWrite(peer.writeChar, data);
    } else {
      // Fragment: [totalLen: 4B][offset: 4B][chunk]
      const totalLen = data.length;
      let offset = 0;

      while (offset < totalLen) {
        const chunkSize = Math.min(BLE_CHUNK_SIZE - FRAG_HEADER_SIZE, totalLen - offset);
        const fragment = new Uint8Array(FRAG_HEADER_SIZE + chunkSize);
        const view = new DataView(fragment.buffer);
        view.setUint32(0, totalLen, false);
        view.setUint32(4, offset, false);
        fragment.set(data.slice(offset, offset + chunkSize), FRAG_HEADER_SIZE);

        await this.bleWrite(peer.writeChar, fragment);
        offset += chunkSize;
      }
    }
  }

  async broadcast(data: Uint8Array): Promise<void> {
    if (!this.running) throw new Error('Transport not running');

    const promises: Promise<void>[] = [];
    for (const [addr] of this.discoveredPeers) {
      promises.push(this.sendTo(addr, data).catch(() => {}));
    }
    await Promise.allSettled(promises);
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
  // Noble (Central — scanning for peers)
  // ═══════════════════════════════════════

  private async waitForBluetooth(): Promise<void> {
    // Wait for both noble and bleno to be ready
    const nobleReady = new Promise<void>((resolve, reject) => {
      if (noble.state === 'poweredOn') return resolve();
      const timeout = setTimeout(() => reject(new Error('Noble: Bluetooth not ready (10s timeout)')), 10000);
      noble.on('stateChange', (state: string) => {
        if (state === 'poweredOn') { clearTimeout(timeout); resolve(); }
        else if (state === 'unsupported') { clearTimeout(timeout); reject(new Error('Bluetooth not supported')); }
      });
    });

    const blenoReady = new Promise<void>((resolve, reject) => {
      if (bleno.state === 'poweredOn') return resolve();
      const timeout = setTimeout(() => reject(new Error('Bleno: Bluetooth not ready (10s timeout)')), 10000);
      bleno.on('stateChange', (state: string) => {
        if (state === 'poweredOn') { clearTimeout(timeout); resolve(); }
        else if (state === 'unsupported') { clearTimeout(timeout); reject(new Error('Bluetooth not supported')); }
      });
    });

    await Promise.all([nobleReady, blenoReady]);
  }

  private async startNobleScanning(): Promise<void> {
    // Enable multi-role (noble + bleno on same adapter)
    process.env.NOBLE_MULTI_ROLE = '1';

    noble.on('discover', (peripheral: any) => {
      this.handleBLEDiscovery(peripheral);
    });

    // Scan for CMP service UUID, allow duplicates for beacon updates
    noble.startScanning([CMP_SERVICE_UUID], true);
  }

  private handleBLEDiscovery(peripheral: any): void {
    if (!this.running) return;

    const ad = peripheral.advertisement;
    if (!ad || !ad.manufacturerData) return;

    const mfgData = ad.manufacturerData;
    if (mfgData.length < 12) return; // 2 mfg ID + 8 instanceId + 2 port minimum

    // Check manufacturer ID
    const mfgId = mfgData.readUInt16LE(0);
    if (mfgId !== CMP_MANUFACTURER_ID) return;

    // Extract instanceId (bytes 2-9)
    const peerInstanceId = mfgData.slice(2, 10);

    // Self-filter
    let isOwn = true;
    for (let i = 0; i < 8; i++) {
      if (peerInstanceId[i] !== this.instanceId[i]) { isOwn = false; break; }
    }
    if (isOwn) return;

    const instanceIdHex = Buffer.from(peerInstanceId).toString('hex');
    const peerAddress = `ble:${instanceIdHex}`;

    // Extract beacon data (after 2 mfg ID + 8 instanceId)
    const beaconPayload = new Uint8Array(mfgData.slice(10));

    // Update or add peer
    const existing = this.discoveredPeers.get(peerAddress);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.peripheral = peripheral;
    } else {
      this.discoveredPeers.set(peerAddress, {
        bleAddress: peripheral.address || peripheral.id,
        instanceIdHex,
        peripheral,
        connected: false,
        lastSeen: Date.now(),
      });
    }

    // Emit discovery with beacon data
    this.emit({
      type: 'peer_discovered',
      peerAddress,
      data: beaconPayload,
      transport: this.name,
      timestamp: Date.now(),
    });
  }

  // ═══════════════════════════════════════
  // Bleno (Peripheral — advertising + GATT server)
  // ═══════════════════════════════════════

  private async startGATTServer(): Promise<void> {
    const Characteristic = bleno.Characteristic;
    const PrimaryService = bleno.PrimaryService;

    // Write characteristic — peers write messages to us here
    this.writeCharacteristic = new Characteristic({
      uuid: CMP_WRITE_CHAR_UUID,
      properties: ['write', 'writeWithoutResponse'],
      onWriteRequest: (data: Buffer, offset: number, withoutResponse: boolean, callback: Function) => {
        this.handleIncomingData(data);
        callback(Characteristic.RESULT_SUCCESS);
      },
    });

    // Notify characteristic — we push messages to connected peers
    this.notifyCharacteristic = new Characteristic({
      uuid: CMP_NOTIFY_CHAR_UUID,
      properties: ['notify'],
      onSubscribe: (maxValueSize: number, updateValueCallback: Function) => {
        this.notifySubscribers.add(updateValueCallback);
      },
      onUnsubscribe: () => {
        // Can't easily identify which subscriber, but they auto-clean
      },
    });

    const cmpService = new PrimaryService({
      uuid: CMP_SERVICE_UUID,
      characteristics: [this.writeCharacteristic, this.notifyCharacteristic],
    });

    bleno.setServices([cmpService]);
  }

  private advertiseBeacon(): void {
    if (!this.beaconData || !bleno) return;

    // Build manufacturer data: [mfgId: 2B LE][instanceId: 8B][beacon payload]
    const mfgData = Buffer.alloc(2 + 8 + this.beaconData.length);
    mfgData.writeUInt16LE(CMP_MANUFACTURER_ID, 0);
    mfgData.set(this.instanceId, 2);
    mfgData.set(this.beaconData, 10);

    // Build EIR (Extended Inquiry Response) advertisement data
    // This includes the service UUID and manufacturer data
    try {
      bleno.startAdvertising('CMP', [CMP_SERVICE_UUID], (err: any) => {
        if (err) console.error('[BLE] Advertise error:', err);
      });
    } catch (err) {
      // Some platforms need raw EIR data
      try {
        const adData = this.buildAdvertisementData(mfgData);
        bleno.startAdvertisingWithEIRData(adData);
      } catch {}
    }
  }

  /**
   * Build BLE advertisement data manually with manufacturer data.
   */
  private buildAdvertisementData(mfgData: Buffer): Buffer {
    // EIR format: [len][type][data]
    // Type 0xFF = manufacturer specific data
    const eirEntry = Buffer.alloc(2 + mfgData.length);
    eirEntry[0] = 1 + mfgData.length; // length (type + data)
    eirEntry[1] = 0xFF; // type: manufacturer specific
    mfgData.copy(eirEntry, 2);

    // Type 0x07 = Complete list of 128-bit UUIDs
    const uuidBytes = Buffer.from(CMP_SERVICE_UUID, 'hex');
    const uuidEntry = Buffer.alloc(2 + uuidBytes.length);
    uuidEntry[0] = 1 + uuidBytes.length;
    uuidEntry[1] = 0x07;
    uuidBytes.copy(uuidEntry, 2);

    return Buffer.concat([eirEntry, uuidEntry]);
  }

  // ═══════════════════════════════════════
  // GATT Connection & Data Transfer
  // ═══════════════════════════════════════

  private async connectToPeer(peer: {
    bleAddress: string;
    instanceIdHex: string;
    peripheral?: any;
    writeChar?: any;
    connected: boolean;
  }): Promise<void> {
    if (!peer.peripheral) throw new Error('No peripheral reference');
    if (peer.connected && peer.writeChar) return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('BLE connect timeout')), 10000);

      peer.peripheral.connect((err: any) => {
        if (err) { clearTimeout(timeout); reject(err); return; }

        peer.peripheral.discoverSomeServicesAndCharacteristics(
          [CMP_SERVICE_UUID],
          [CMP_WRITE_CHAR_UUID, CMP_NOTIFY_CHAR_UUID],
          (err2: any, services: any[], characteristics: any[]) => {
            clearTimeout(timeout);
            if (err2) { reject(err2); return; }

            for (const char of characteristics || []) {
              if (char.uuid === CMP_WRITE_CHAR_UUID.replace(/-/g, '')) {
                peer.writeChar = char;
              }
              if (char.uuid === CMP_NOTIFY_CHAR_UUID.replace(/-/g, '')) {
                // Subscribe to notifications
                char.on('data', (data: Buffer) => {
                  this.handleIncomingData(data, `ble:${peer.instanceIdHex}`);
                });
                char.subscribe();
              }
            }

            peer.connected = true;
            console.log(`[BLE] Connected to peer ${peer.instanceIdHex.substring(0, 8)}`);
            resolve();
          }
        );
      });
    });
  }

  private async bleWrite(characteristic: any, data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(data);
      characteristic.write(buf, true, (err: any) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  // ═══════════════════════════════════════
  // Incoming Data — reassembly
  // ═══════════════════════════════════════

  private handleIncomingData(data: Buffer, senderAddress?: string): void {
    if (!this.running) return;

    const bytes = new Uint8Array(data);
    const sender = senderAddress || 'ble:unknown';

    // Check if this is a fragment (totalLen > BLE_CHUNK_SIZE)
    if (bytes.length >= FRAG_HEADER_SIZE) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const totalLen = view.getUint32(0, false);
      const offset = view.getUint32(4, false);

      // Looks like a fragment if totalLen > BLE_CHUNK_SIZE and offset is valid
      if (totalLen > BLE_CHUNK_SIZE && offset < totalLen) {
        this.handleFragment(sender, totalLen, offset, bytes.slice(FRAG_HEADER_SIZE));
        return;
      }
    }

    // Single complete message
    this.emit({
      type: 'message',
      peerAddress: sender,
      data: bytes,
      transport: this.name,
      timestamp: Date.now(),
    });
  }

  private handleFragment(sender: string, totalLen: number, offset: number, chunk: Uint8Array): void {
    const key = `${sender}:${totalLen}`;

    let buf = this.reassemblyBuffers.get(key);
    if (!buf) {
      buf = {
        totalLen,
        chunks: new Map(),
        receivedBytes: 0,
        startTime: Date.now(),
      };
      this.reassemblyBuffers.set(key, buf);
    }

    // Store chunk
    buf.chunks.set(offset, chunk);
    buf.receivedBytes += chunk.length;

    // Check if complete
    if (buf.receivedBytes >= totalLen) {
      // Reassemble
      const assembled = new Uint8Array(totalLen);
      const sortedOffsets = [...buf.chunks.keys()].sort((a, b) => a - b);
      for (const off of sortedOffsets) {
        assembled.set(buf.chunks.get(off)!, off);
      }

      this.reassemblyBuffers.delete(key);

      this.emit({
        type: 'message',
        peerAddress: sender,
        data: assembled,
        transport: this.name,
        timestamp: Date.now(),
      });
    }

    // Cleanup old buffers
    const now = Date.now();
    for (const [k, b] of this.reassemblyBuffers) {
      if (now - b.startTime > REASSEMBLY_TIMEOUT) {
        this.reassemblyBuffers.delete(k);
      }
    }
  }

  // ═══════════════════════════════════════
  // Manual peer connection (like connectTo for hotspots)
  // ═══════════════════════════════════════

  /**
   * Send a beacon directly to a known BLE address.
   * (For BLE, this isn't needed — discovery is automatic via scanning)
   */
  sendBeaconTo(_address: string): void {
    // BLE discovery is passive (scanning), no directed beacon needed
    // Re-trigger advertisement to ensure visibility
    this.advertiseBeacon();
  }
}
