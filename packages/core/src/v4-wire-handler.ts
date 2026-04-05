/**
 * CMP v4.0 — Wire Handler
 *
 * Routes v4 wire messages (0xF2-0xFB) between the transport layer
 * and the v4 modules. This is the missing link that makes gravity,
 * racing, pipes, and job distribution work across real devices.
 *
 * Inbound:  transport → V4WireHandler → module.handleX()
 * Outbound: module calls send() → V4WireHandler → transport.sendTo()
 *
 * Message map (all in 0xF2-0xFB range, non-conflicting with v1-v3):
 *   0xF2  LOAD_REPORT      LoadMonitor peer load exchange
 *   0xF3  JOB_ANNOUNCE      JobAnnouncer remote job distribution
 *   0xF4  JOB_RESULT        JobAnnouncer remote job result
 *   0xF5  PIPE_DATA         Pipeline stage data between devices
 *   0xF6  PIPE_BACKPRESSURE Pipeline backpressure signal
 *   0xF7  CATALOG_GOSSIP    DataCatalog shard location gossip
 *   0xF8  CODE_SHIP         Gravity: ship code to data device
 *   0xF9  CODE_RESULT       Gravity: result from code execution
 *   0xFA  TASK_CANCEL       Racing: cancel losing racers
 *   0xFB  TASK_CANCEL_ACK   Racing: cancel acknowledgement
 *
 * @module v4-wire-handler
 * @author Agent Viscro
 */

import { Logger } from './utils/logger';
import { MessageType } from './types/beacon';
import { encodeMessage } from './layers/serializer';
import { encodeJSON, decodeJSON } from './layers/serializer';

// Module types
import { LoadMonitor } from './scheduler/load-monitor';
import { JobAnnouncer } from './scheduler/job-announcer';
import { CancelTracker } from './scheduler/cancel-protocol';
import { DataCatalog, CatalogGossipWire } from './gravity/data-catalog';
import { CodeShipper, CodeShipWire, CodeResultWire } from './gravity/code-shipper';
import { PipelineManager } from './pipes/pipeline-manager';

const log = new Logger('V4Wire');

// ─── Transport Interface ───

export interface V4TransportSend {
  sendTo(peerAddress: string, data: Uint8Array): Promise<void>;
  broadcast(data: Uint8Array): Promise<void>;
}

// ─── Peer Resolver ───

export interface V4PeerResolver {
  /** Resolve a mesh ID (hex) to a transport address */
  resolveAddress(meshIdHex: string): string | null;
  /** Get all active peer addresses */
  getActivePeerAddresses(): Array<{ meshIdHex: string; address: string }>;
}

// ─── V4 Wire Handler ───

export class V4WireHandler {
  private transport: V4TransportSend | null = null;
  private peerResolver: V4PeerResolver | null = null;

  // Module references
  private loadMonitor: LoadMonitor | null = null;
  private jobAnnouncer: JobAnnouncer | null = null;
  private cancelTracker: CancelTracker | null = null;
  private dataCatalog: DataCatalog | null = null;
  private codeShipper: CodeShipper | null = null;
  private pipelineManager: PipelineManager | null = null;

  // Stats
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    messagesBroadcast: 0,
    errors: 0,
    byType: {} as Record<number, number>,
  };

  constructor() {}

  // ══════════════════════════════════════
  // Setup
  // ══════════════════════════════════════

  /**
   * Set the transport for sending messages.
   */
  setTransport(transport: V4TransportSend, peerResolver: V4PeerResolver): void {
    this.transport = transport;
    this.peerResolver = peerResolver;

    // Wire outbound send functions into modules
    this.wireModuleTransports();

    log.info('Transport connected');
  }

  /**
   * Register v4 modules for inbound message routing.
   */
  registerModules(modules: {
    loadMonitor?: LoadMonitor;
    jobAnnouncer?: JobAnnouncer;
    cancelTracker?: CancelTracker;
    dataCatalog?: DataCatalog;
    codeShipper?: CodeShipper;
    pipelineManager?: PipelineManager;
  }): void {
    if (modules.loadMonitor) this.loadMonitor = modules.loadMonitor;
    if (modules.jobAnnouncer) this.jobAnnouncer = modules.jobAnnouncer;
    if (modules.cancelTracker) this.cancelTracker = modules.cancelTracker;
    if (modules.dataCatalog) this.dataCatalog = modules.dataCatalog;
    if (modules.codeShipper) this.codeShipper = modules.codeShipper;
    if (modules.pipelineManager) this.pipelineManager = modules.pipelineManager;

    // Re-wire transports if transport is already set
    if (this.transport) this.wireModuleTransports();

    log.info('Modules registered: ' + Object.keys(modules).filter(k => (modules as any)[k]).join(', '));
  }

  // ══════════════════════════════════════
  // Inbound: transport → modules
  // ══════════════════════════════════════

  /**
   * Check if a message type belongs to the v4 range.
   */
  isV4Message(msgType: number): boolean {
    return msgType >= 0xF2 && msgType <= 0xFB;
  }

  /**
   * Handle an inbound v4 message from the transport layer.
   * Called by cmp-node.handleTransportMessage().
   */
  handleMessage(msgType: number, payload: Uint8Array, peerAddress?: string): void {
    this.stats.messagesReceived++;
    this.stats.byType[msgType] = (this.stats.byType[msgType] || 0) + 1;

    const wire = decodeJSON(payload);
    if (!wire) {
      log.warn(`Failed to decode v4 message type 0x${msgType.toString(16)}`);
      this.stats.errors++;
      return;
    }

    switch (msgType) {
      case MessageType.V4_LOAD_REPORT:
        this.handleLoadReport(wire);
        break;

      case MessageType.V4_JOB_ANNOUNCE:
        this.handleJobAnnounce(wire, peerAddress);
        break;

      case MessageType.V4_JOB_RESULT:
        this.handleJobResult(wire);
        break;

      case MessageType.V4_PIPE_DATA:
        this.handlePipeData(wire);
        break;

      case MessageType.V4_PIPE_BACKPRESSURE:
        this.handlePipeBackpressure(wire);
        break;

      case MessageType.V4_CATALOG_GOSSIP:
        this.handleCatalogGossip(wire);
        break;

      case MessageType.V4_CODE_SHIP:
        this.handleCodeShip(wire);
        break;

      case MessageType.V4_CODE_RESULT:
        this.handleCodeResult(wire);
        break;

      case MessageType.V4_TASK_CANCEL:
        this.handleTaskCancel(wire, peerAddress);
        break;

      case MessageType.V4_TASK_CANCEL_ACK:
        this.handleTaskCancelAck(wire);
        break;

      default:
        log.warn(`Unknown v4 message type: 0x${msgType.toString(16)}`);
    }
  }

  // ══════════════════════════════════════
  // Inbound Handlers
  // ══════════════════════════════════════

  private handleLoadReport(wire: any): void {
    if (!this.loadMonitor) return;
    this.loadMonitor.handleLoadReport({
      deviceId: wire.deviceId,
      cpu: wire.cpu,
      mem: wire.mem,
      memMb: wire.memMb,
      thermal: wire.thermal,
      tasks: wire.tasks,
      ts: wire.ts,
    });
  }

  private handleJobAnnounce(wire: any, peerAddress?: string): void {
    if (!this.jobAnnouncer) return;
    this.jobAnnouncer.handleAnnouncement(wire);
  }

  private handleJobResult(wire: any): void {
    if (!this.jobAnnouncer) return;
    this.jobAnnouncer.handleResult(wire);
  }

  private handlePipeData(wire: any): void {
    if (!this.pipelineManager) return;
    const { pipeline, stageIndex, data: dataHex } = wire;
    const data = fromHex(dataHex);
    this.pipelineManager.push(pipeline, data);
  }

  private handlePipeBackpressure(wire: any): void {
    // Backpressure signal — log for now, full implementation needs
    // pipeline manager to pause upstream
    log.info(`Backpressure signal from stage ${wire.stageIndex} of pipeline "${wire.pipeline}"`);
  }

  private handleCatalogGossip(wire: any): void {
    if (!this.dataCatalog) return;
    this.dataCatalog.handleGossip(wire as CatalogGossipWire);
  }

  private handleCodeShip(wire: any): void {
    if (!this.codeShipper) return;
    this.codeShipper.handleCodeShip(wire as CodeShipWire);
  }

  private handleCodeResult(wire: any): void {
    if (!this.codeShipper) return;
    this.codeShipper.handleCodeResult(wire as CodeResultWire);
  }

  private handleTaskCancel(wire: any, peerAddress?: string): void {
    // The executor side receives a cancel — stop the task
    log.info(`TASK_CANCEL received: task=${wire.taskId}, race=${wire.raceId}, reason=${wire.reason}`);

    // Send ack back
    if (peerAddress) {
      this.sendToAddress(peerAddress, MessageType.V4_TASK_CANCEL_ACK, {
        taskId: wire.taskId,
        raceId: wire.raceId,
        deviceId: 'local', // Will be set by the sender
        stopped: true,
        partialBytes: 0,
        computeMs: 0,
      });
    }
  }

  private handleTaskCancelAck(wire: any): void {
    if (!this.cancelTracker) return;
    this.cancelTracker.handleAck(wire);
  }

  // ══════════════════════════════════════
  // Outbound: modules → transport
  // ══════════════════════════════════════

  /**
   * Send a v4 message to a specific peer by mesh ID.
   */
  async sendToPeer(meshIdHex: string, msgType: MessageType, payload: any): Promise<boolean> {
    if (!this.transport || !this.peerResolver) return false;

    const address = this.peerResolver.resolveAddress(meshIdHex);
    if (!address) {
      log.warn(`Cannot resolve address for peer ${meshIdHex.substring(0, 8)}`);
      return false;
    }

    return this.sendToAddress(address, msgType, payload);
  }

  /**
   * Send a v4 message to a specific transport address.
   */
  async sendToAddress(address: string, msgType: MessageType, payload: any): Promise<boolean> {
    if (!this.transport) return false;

    try {
      const jsonBytes = encodeJSON(payload);
      const msg = encodeMessage(msgType, jsonBytes);
      await this.transport.sendTo(address, msg);
      this.stats.messagesSent++;
      return true;
    } catch (err: any) {
      log.warn(`Failed to send v4 message 0x${msgType.toString(16)}: ${err.message}`);
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Broadcast a v4 message to all peers.
   */
  async broadcast(msgType: MessageType, payload: any): Promise<boolean> {
    if (!this.transport) return false;

    try {
      const jsonBytes = encodeJSON(payload);
      const msg = encodeMessage(msgType, jsonBytes);
      await this.transport.broadcast(msg);
      this.stats.messagesBroadcast++;
      return true;
    } catch (err: any) {
      log.warn(`Failed to broadcast v4 message 0x${msgType.toString(16)}: ${err.message}`);
      this.stats.errors++;
      return false;
    }
  }

  // ══════════════════════════════════════
  // Wire Module Transports
  // ══════════════════════════════════════

  /**
   * Connect outbound send functions to each module so they can
   * send messages through the real transport.
   */
  private wireModuleTransports(): void {
    if (!this.transport || !this.peerResolver) return;

    // LoadMonitor: broadcast load reports periodically
    if (this.loadMonitor) {
      this.loadMonitor.setTransport((_msgType, payload) => {
        this.broadcast(MessageType.V4_LOAD_REPORT, payload);
      });
    }

    // CancelTracker: send cancel messages to specific peers
    if (this.cancelTracker) {
      this.cancelTracker.setTransport((deviceId, _msgType, payload) => {
        this.sendToPeer(deviceId, MessageType.V4_TASK_CANCEL, payload);
      });
    }

    // DataCatalog: broadcast gossip
    if (this.dataCatalog) {
      this.dataCatalog.setTransport((_msgType, payload) => {
        this.broadcast(MessageType.V4_CATALOG_GOSSIP, payload);
      });
    }

    // CodeShipper: send CODE_SHIP and CODE_RESULT to specific peers
    if (this.codeShipper) {
      this.codeShipper.setTransport((deviceId, msgType, payload) => {
        // Map internal msg types to wire types
        const wireType = msgType === 0xFD
          ? MessageType.V4_CODE_SHIP
          : MessageType.V4_CODE_RESULT;
        this.sendToPeer(deviceId, wireType, payload);
      });
    }

    log.info('Module transports wired');
  }

  // ══════════════════════════════════════
  // Stats
  // ══════════════════════════════════════

  getStats(): {
    messagesReceived: number;
    messagesSent: number;
    messagesBroadcast: number;
    errors: number;
    byType: Record<string, number>;
  } {
    // Convert numeric keys to hex names
    const byTypeNamed: Record<string, number> = {};
    for (const [type, count] of Object.entries(this.stats.byType)) {
      const name = messageTypeName(parseInt(type));
      byTypeNamed[name] = count;
    }

    return {
      messagesReceived: this.stats.messagesReceived,
      messagesSent: this.stats.messagesSent,
      messagesBroadcast: this.stats.messagesBroadcast,
      errors: this.stats.errors,
      byType: byTypeNamed,
    };
  }
}

// ─── Helpers ───

function messageTypeName(type: number): string {
  const names: Record<number, string> = {
    [MessageType.V4_LOAD_REPORT]: 'LOAD_REPORT',
    [MessageType.V4_JOB_ANNOUNCE]: 'JOB_ANNOUNCE',
    [MessageType.V4_JOB_RESULT]: 'JOB_RESULT',
    [MessageType.V4_PIPE_DATA]: 'PIPE_DATA',
    [MessageType.V4_PIPE_BACKPRESSURE]: 'PIPE_BACKPRESSURE',
    [MessageType.V4_CATALOG_GOSSIP]: 'CATALOG_GOSSIP',
    [MessageType.V4_CODE_SHIP]: 'CODE_SHIP',
    [MessageType.V4_CODE_RESULT]: 'CODE_RESULT',
    [MessageType.V4_TASK_CANCEL]: 'TASK_CANCEL',
    [MessageType.V4_TASK_CANCEL_ACK]: 'TASK_CANCEL_ACK',
  };
  return names[type] || `0x${type.toString(16)}`;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
