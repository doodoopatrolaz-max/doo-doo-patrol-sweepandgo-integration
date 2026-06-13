import crypto from "node:crypto";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${canonicalJson(nestedValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function extractEventId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.event_id,
    record.eventId,
    record.webhook_id,
    record.webhookId,
    record.id,
    record.uuid
  ];

  return candidates.find((candidate): candidate is string | number => {
    return typeof candidate === "string" || typeof candidate === "number";
  })?.toString();
}

export function extractEventType(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "unknown";
  }

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.event_type,
    record.eventType,
    record.type,
    record.event,
    record.webhook_type,
    record.webhookType
  ];

  return candidates.find((candidate): candidate is string => typeof candidate === "string") ?? "unknown";
}

export function createEventFingerprint(payload: unknown): string {
  const eventId = extractEventId(payload);
  const eventType = extractEventType(payload);
  const source = eventId ? `${eventType}:${eventId}` : canonicalJson(payload);

  return crypto.createHash("sha256").update(source).digest("hex");
}
