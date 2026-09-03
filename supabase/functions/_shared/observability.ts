type OperationalFields = {
  requestId?: string;
  eventId?: string;
  eventKind?: string;
  phase?: string;
  code?: string;
  outcome?: string;
  attempt?: number;
  processed?: number;
  status?: number;
};

const SAFE_CODE = /^[a-z0-9_]{1,64}$/;

export function safeOperationalCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return SAFE_CODE.test(message) ? message : fallback;
}

export function operationalLog(
  level: "info" | "warn" | "error",
  operation: string,
  fields: OperationalFields = {},
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    operation,
    ...fields,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}
