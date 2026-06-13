import { logger, sanitizeForLogs, serializeError } from "../logger.ts";
import type { WebhookEvent, WebhookEventStore } from "./store.ts";

export type WebhookProcessor = {
  process(event: WebhookEvent): Promise<void>;
};

export class NoopWebhookProcessor implements WebhookProcessor {
  async process(event: WebhookEvent): Promise<void> {
    logger.info(
      {
        webhookEventId: event.id,
        sweepandgoEventId: event.sweepandgoEventId,
        eventType: event.eventType,
        eventFingerprint: event.eventFingerprint
      },
      "Sweep&Go webhook stored for phase-one processing"
    );
  }
}

export function scheduleWebhookProcessing(
  store: WebhookEventStore,
  processor: WebhookProcessor,
  event: WebhookEvent
): void {
  setImmediate(async () => {
    try {
      await store.updateStatus(event.id, "processing");
      await processor.process(event);
      await store.updateStatus(event.id, "processed");
    } catch (error) {
      const serialized = sanitizeForLogs(serializeError(error));
      await store.updateStatus(event.id, "failed", serialized);
      logger.error(
        {
          error: serialized,
          webhookEventId: event.id,
          eventType: event.eventType,
          eventFingerprint: event.eventFingerprint
        },
        "Sweep&Go webhook processing failed"
      );
    }
  });
}
