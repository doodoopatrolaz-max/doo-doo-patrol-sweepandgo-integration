import type { WebhookEvent } from "./store.ts";
import type { WebhookProcessor } from "./processor.ts";

export class CompositeWebhookProcessor implements WebhookProcessor {
  private readonly processors: WebhookProcessor[];

  constructor(processors: WebhookProcessor[]) {
    this.processors = processors;
  }

  async process(event: WebhookEvent): Promise<void> {
    for (const processor of this.processors) {
      await processor.process(event);
    }
  }
}
