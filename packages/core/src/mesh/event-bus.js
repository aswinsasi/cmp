"use strict";
/**
 * CMP Event Bus
 * Typed event emitter for internal mesh communication between layers.
 *
 * @module mesh/event-bus
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
/**
 * Typed event emitter for CMP internal events.
 */
class EventBus {
    handlers = new Map();
    /**
     * Subscribe to an event.
     */
    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event).add(handler);
    }
    /**
     * Unsubscribe from an event.
     */
    off(event, handler) {
        const set = this.handlers.get(event);
        if (set) {
            set.delete(handler);
            if (set.size === 0)
                this.handlers.delete(event);
        }
    }
    /**
     * Subscribe to an event once.
     */
    once(event, handler) {
        const wrapped = (data) => {
            this.off(event, wrapped);
            handler(data);
        };
        this.on(event, wrapped);
    }
    /**
     * Emit an event to all subscribed handlers.
     */
    emit(event, data) {
        const set = this.handlers.get(event);
        if (set) {
            for (const handler of set) {
                try {
                    handler(data);
                }
                catch (err) {
                    console.error(`[CMP EventBus] Error in handler for '${event}':`, err);
                }
            }
        }
    }
    /**
     * Wait for an event with optional timeout.
     */
    waitFor(event, timeoutMs) {
        return new Promise((resolve, reject) => {
            let timer;
            const handler = (data) => {
                if (timer)
                    clearTimeout(timer);
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
    clear() {
        this.handlers.clear();
    }
    /**
     * Get count of handlers for an event.
     */
    listenerCount(event) {
        return this.handlers.get(event)?.size ?? 0;
    }
}
exports.EventBus = EventBus;
//# sourceMappingURL=event-bus.js.map