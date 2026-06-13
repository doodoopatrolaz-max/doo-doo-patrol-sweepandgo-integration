const sensitiveKeyPattern = /(authorization|token|secret|password|credit.*card|card.*number|payment.*link|credit.*link|api.*key)/i;
const sensitiveUrlPattern = /(stripe|payment|credit.?card|card|token|secret)/i;

export function sanitizeForLogs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForLogs);
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : sanitizeForLogs(nestedValue);
    }
    return output;
  }

  if (typeof value === "string" && /^https?:\/\//i.test(value) && sensitiveUrlPattern.test(value)) {
    return "[REDACTED_URL]";
  }

  return value;
}

export function serializeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack
    };
  }

  return { message: String(error) };
}

function writeLog(level: "info" | "warn" | "error", dataOrMessage: unknown, maybeMessage?: string) {
  const message = typeof dataOrMessage === "string" ? dataOrMessage : maybeMessage;
  const data = typeof dataOrMessage === "string" ? undefined : sanitizeForLogs(dataOrMessage);
  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(data && typeof data === "object" ? data as Record<string, unknown> : { data })
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(dataOrMessage: unknown, maybeMessage?: string) {
    writeLog("info", dataOrMessage, maybeMessage);
  },
  warn(dataOrMessage: unknown, maybeMessage?: string) {
    writeLog("warn", dataOrMessage, maybeMessage);
  },
  error(dataOrMessage: unknown, maybeMessage?: string) {
    writeLog("error", dataOrMessage, maybeMessage);
  }
};
