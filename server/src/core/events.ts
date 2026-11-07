import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { logger } from '../config/logger';

/**
 * In-process domain event bus. Modules publish facts ("task.created");
 * subscribers (activity feed, notifications, automation, sockets) react.
 * Subscribers must be fast and should hand heavy work to BullMQ queues.
 * A failing subscriber is logged and never breaks the publisher.
 */
export interface DomainEvent<TPayload = unknown> {
  /** Unique per publication (automation idempotency). */
  id: string;
  name: string;
  payload: TPayload;
  actorId?: string;
  requestId?: string;
  /** Automation loop guard: incremented when an automation action emits an event. */
  depth?: number;
  occurredAt: Date;
}

/**
 * Automation loop guard: actions run inside automationScope.run({ depth }), so every event
 * they cause is published with that depth without threading it through each service.
 */
export const automationScope = new AsyncLocalStorage<{ depth: number }>();

type Handler = (event: DomainEvent) => void | Promise<void>;

class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: false });
  private readonly pending = new Set<Promise<void>>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  subscribe(name: string, handler: Handler): () => void {
    const wrapped = (event: DomainEvent) => {
      const run: Promise<void> = Promise.resolve()
        .then(() => handler(event))
        .catch((err: unknown) =>
          logger.error(
            { err, event: event.name, requestId: event.requestId },
            'Event handler failed',
          ),
        )
        .finally(() => this.pending.delete(run));
      this.pending.add(run);
    };
    this.emitter.on(name, wrapped);
    return () => this.emitter.off(name, wrapped);
  }

  publish<T>(
    name: string,
    payload: T,
    meta: Partial<Omit<DomainEvent, 'name' | 'payload' | 'id'>> = {},
  ): void {
    const event: DomainEvent<T> = {
      id: randomUUID(),
      name,
      payload,
      occurredAt: new Date(),
      ...meta,
      depth: meta.depth ?? automationScope.getStore()?.depth ?? 0,
    };
    this.emitter.emit(name, event);
    this.emitter.emit('*', event);
  }

  /** Resolves once every handler started so far (and any they trigger) has finished. Used by tests. */
  async settle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  clear(): void {
    this.emitter.removeAllListeners();
  }
}

export const eventBus = new EventBus();
