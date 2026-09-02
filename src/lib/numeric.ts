export type DecimalResult =
  { kind: "empty" } | { kind: "invalid" } | { kind: "value"; value: number };

/** No thousands separators, exponent notation, partial parses, NaN or Infinity. */
export function parseDecimal(raw: string): DecimalResult {
  const normalized = raw.trim().replaceAll(",", ".");
  if (!normalized) return { kind: "empty" };
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return { kind: "invalid" };
  const value = Number(normalized);
  return Number.isFinite(value) ? { kind: "value", value } : { kind: "invalid" };
}

/** Call on blur or submit, never while the user is typing. Invalid text stays visible. */
export function normalizeDecimal(raw: string): string {
  const parsed = parseDecimal(raw);
  return parsed.kind === "value" ? String(parsed.value) : parsed.kind === "empty" ? "" : raw;
}

export function decimalError(
  parsed: DecimalResult,
  {
    min,
    max,
    integer = false,
  }: { min?: number | undefined; max?: number | undefined; integer?: boolean },
): string {
  if (parsed.kind === "invalid") return "Enter a valid number (for example 61,5).";
  if (parsed.kind !== "value") return "";
  if (integer && !Number.isInteger(parsed.value)) return "Enter a whole number.";
  if (min != null && parsed.value < min) return `Use ${min} or more.`;
  if (max != null && parsed.value > max) return `Use ${max} or less.`;
  return "";
}
