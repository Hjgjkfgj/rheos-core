// Event bus in-process (ADR-004/005). Découplé du stockage : persistance
// optionnelle via onPersist (branché sur le Repository).
import { uid, nowIso } from "./store.js";
import { DomainEvent } from "./types.js";

type Handler = (e: DomainEvent) => void;

export class EventBus {
  published: DomainEvent[] = [];
  private handlers: Handler[] = [];
  private seq: Record<string, number> = {};
  onPersist?: (e: DomainEvent) => void | Promise<void>;

  subscribe(h: Handler) { this.handlers.push(h); }

  publish(tenantId: string, aggregateType: string, aggregateId: string, type: string, payload: any, actorUserId?: string, version = 1): DomainEvent {
    const key = `${aggregateType}:${aggregateId}`;
    this.seq[key] = (this.seq[key] ?? 0) + 1;
    const e: DomainEvent = {
      id: uid(), tenantId, aggregateType, aggregateId, type, version,
      sequence: this.seq[key], payload, occurredAt: nowIso(), actorUserId,
    };
    this.published.push(e);
    this.onPersist?.(e);
    for (const h of this.handlers) h(e);
    return e;
  }

  eventsOf(tenantId: string, type?: string): DomainEvent[] {
    return this.published.filter((e) => e.tenantId === tenantId && (!type || e.type === type));
  }
}
