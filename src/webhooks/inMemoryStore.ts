import type {
  CreateWebhookEventInput,
  CreateWebhookEventResult,
  ProcessingStatus,
  WebhookEvent,
  WebhookEventStore
} from "./store.ts";

export class InMemoryWebhookEventStore implements WebhookEventStore {
  private readonly events = new Map<string, WebhookEvent>();
  private nextId = 1;

  async createEvent(input: CreateWebhookEventInput): Promise<CreateWebhookEventResult> {
    const existing = [...this.events.values()].find(
      (event) => event.eventFingerprint === input.eventFingerprint
    );

    if (existing) {
      return { event: existing, inserted: false };
    }

    const event: WebhookEvent = {
      id: String(this.nextId++),
      sweepandgoEventId: input.sweepandgoEventId,
      eventType: input.eventType,
      receivedAt: new Date().toISOString(),
      processingStatus: "received",
      payload: input.payload,
      eventFingerprint: input.eventFingerprint
    };

    this.events.set(event.id, event);
    return { event, inserted: true };
  }

  async updateStatus(id: string, status: ProcessingStatus, errorDetails?: unknown): Promise<void> {
    const event = this.events.get(id);
    if (!event) {
      return;
    }

    this.events.set(id, {
      ...event,
      processingStatus: status,
      errorDetails
    });
  }

  async listEvents(limit: number, offset: number): Promise<WebhookEvent[]> {
    return [...this.events.values()]
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(offset, offset + limit);
  }

  async getEvent(id: string): Promise<WebhookEvent | undefined> {
    return this.events.get(id);
  }
}
