/**
 * CMP Event Bus
 * Typed event emitter for internal mesh communication between layers.
 *
 * @module mesh/event-bus
 * @author Agent Viscro
 */

export type EventHandler<T = any> = (data: T) => void;

/**
 * All CMP internal events with their payload types.
 */
export interface CMPEvents {
  // Discovery
  'peer:discovered': { meshId: Uint8Array; transport: string; rssi?: number };
  'peer:lost': { meshId: Uint8Array; reason: string };
  'peer:stale': { meshId: Uint8Array };
  'peer:handshake_complete': { meshId: Uint8Array };

  // Capability
  'capability:updated': { meshId: Uint8Array };
  'capability:mesh_changed': { peerCount: number; totalCores: number };

  // Negotiation
  'task:request_received': { taskId: Uint8Array; requesterId: Uint8Array };
  'task:bid_received': { taskId: Uint8Array; bidderId: Uint8Array; score: number };
  'task:assigned': { taskId: Uint8Array; assignees: Uint8Array[] };

  // Execution
  'chunk:received': { chunkId: Uint8Array; taskId: Uint8Array };
  'chunk:executing': { chunkId: Uint8Array };
  'chunk:complete': { chunkId: Uint8Array; status: number; timeMs: number };
  'chunk:executed': { chunkId: Uint8Array; taskId: Uint8Array; status: number; executionTimeMs: number; creditsEarned?: number };

  // Assembly
  'result:received': { chunkId: Uint8Array; executorId: Uint8Array };
  'task:complete': { taskId: Uint8Array; timeMs: number; devicesUsed: number };
  'task:failed': { taskId: Uint8Array; reason: string };

  // Fault tolerance
  'heartbeat:received': { meshId: Uint8Array; taskId: Uint8Array };
  'executor:suspected': { meshId: Uint8Array; missedBeats: number };
  'executor:dead': { meshId: Uint8Array; taskId: Uint8Array };
  'chunk:reassigned': { chunkId: Uint8Array; newAssignee: Uint8Array };
  'departure:received': { meshId: Uint8Array };

  // Checkpointing
  'checkpoint:stored': { chunkId: Uint8Array; taskId: Uint8Array; stepsCompleted: number };
  'checkpoint:restored': { chunkId: Uint8Array; taskId: Uint8Array; stepsCompleted: number };

  // Certification (Layer 7)
  'certificate:generated': { certId: string; deviceCount: number; consensus: number };

  // Incentive
  'credit:earned': { amount: number; taskId: Uint8Array };
  'credit:spent': { amount: number; taskId: Uint8Array };
  'reputation:updated': { meshId: Uint8Array; score: number };

  // Transport
  'transport:message': { from: Uint8Array; data: Uint8Array; transport: string };
  'transport:error': { transport: string; error: string };

  // Node lifecycle
  'node:started': { meshId: Uint8Array };
  'node:stopped': {};
}

/**
 * Typed event emitter for CMP internal events.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * Subscribe to an event.
   */
  on<K extends keyof CMPEvents>(event: K, handler: EventHandler<CMPEvents[K]>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends keyof CMPEvents>(event: K, handler: EventHandler<CMPEvents[K]>): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(event);
    }
  }

  /**
   * Subscribe to an event once.
   */
  once<K extends keyof CMPEvents>(event: K, handler: EventHandler<CMPEvents[K]>): void {
    const wrapped: EventHandler<CMPEvents[K]> = (data) => {
      this.off(event, wrapped);
      handler(data);
    };
    this.on(event, wrapped);
  }

  /**
   * Emit an event to all subscribed handlers.
   */
  emit<K extends keyof CMPEvents>(event: K, data: CMPEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[CMP EventBus] Error in handler for '${event}':`, err);
        }
      }
    }
  }

  /**
   * Wait for an event with optional timeout.
   */
  waitFor<K extends keyof CMPEvents>(
    event: K,
    timeoutMs?: number
  ): Promise<CMPEvents[K]> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;

      const handler: EventHandler<CMPEvents[K]> = (data) => {
        if (timer) clearTimeout(timer);
        resolve(data);
      };

      this.once(event, handler);

      if (timeoutMs) {
        timer = setTimeout(() => {
          this.off(event, handler);
          reject(new Error(`Timeout waiting for event: ${event}`));
        }, timeoutMs);
      }
    });
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get count of handlers for an event.
   */
  listenerCount(event: keyof CMPEvents): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}