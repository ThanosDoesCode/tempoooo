type ErrorRecord = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function record(error: unknown): ErrorRecord {
  return error && typeof error === "object" ? (error as ErrorRecord) : {};
}

export function errorStatus(error: unknown): number | null {
  if (error instanceof Response) return error.status;
  const value = record(error).status ?? record(error).statusCode;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = record(error).message;
  return typeof message === "string" ? message : "";
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isNetworkError(error: unknown): boolean {
  if (isOffline()) return true;
  if (error instanceof Error && error.name === "StartupTimeoutError") return true;
  const status = errorStatus(error);
  if (status === 0) return true;
  const message = messageOf(error).toLowerCase();
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/.test(
    message,
  );
}

export function shouldRetryRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2 || isOffline()) return false;
  const status = errorStatus(error);
  if (status === 408 || status === 425 || status === 429 || (status !== null && status >= 500))
    return true;
  if (status !== null && status >= 400) return false;
  return isNetworkError(error);
}

export function readRetryDelay(attempt: number): number {
  return Math.min(4_000, 500 * 2 ** attempt);
}

export function userFacingError(
  error: unknown,
  action: string,
  options: { inputPreserved?: boolean } = {},
): string {
  const preserved = options.inputPreserved ? " Your entered data is still here." : "";
  if (isOffline()) return `You're offline.${preserved} Reconnect and try again.`;
  if (isNetworkError(error))
    return `Tempo couldn't reach the server.${preserved} Check your connection and try again.`;
  const status = errorStatus(error);
  if (status !== null && status >= 500)
    return `Tempo's server is temporarily unavailable.${preserved} Try again.`;
  if (status === 401) return "Your session has expired. Sign in again, then retry.";
  if (status === 403) return `You don't have permission to ${action}.`;
  return `Could not ${action}.${preserved} Please try again.`;
}
