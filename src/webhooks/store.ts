export type ProcessingStatus = "received" | "processing" | "processed" | "failed" | "duplicate";

export type WebhookEvent = {
  id: string;
  sweepandgoEventId?: string;
  eventType: string;
  receivedAt: string;
  processingStatus: ProcessingStatus;
  payload: unknown;
  errorDetails?: unknown;
  eventFingerprint: string;
};

export type CreateWebhookEventInput = {
  sweepandgoEventId?: string;
  eventType: string;
  payload: unknown;
  eventFingerprint: string;
};

export type CreateWebhookEventResult = {
  event: WebhookEvent;
  inserted: boolean;
};

export interface WebhookEventStore {
  createEvent(input: CreateWebhookEventInput): Promise<CreateWebhookEventResult>;
  updateStatus(id: string, status: ProcessingStatus, errorDetails?: unknown): Promise<void>;
  listEvents(limit: number, offset: number): Promise<WebhookEvent[]>;
  getEvent(id: string): Promise<WebhookEvent | undefined>;
}
