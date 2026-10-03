/**
 * Parse the Time field into whole seconds. Accepts clock form "mm:ss" / "h:mm:ss" (the handoff UI)
 * and, as a convenience fallback, a plain number of minutes (comma or dot decimal). Returns null
 * when invalid so the live preview and the save path share one duration value.
 */
export function parseDurationToSeconds(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes(":")) {
    const parts = value.split(":").map((p) => p.trim());
    if (parts.length < 2 || parts.length > 3) return null;
    if (!parts.every((p) => /^\d+$/.test(p))) return null;
    const nums = parts.map(Number);
    const seconds = nums[nums.length - 1]!;
    const minutes = nums[nums.length - 2]!;
    const hours = nums.length === 3 ? nums[0]! : 0;
    if (seconds >= 60) return null;
    if (nums.length === 3 && minutes >= 60) return null;
    const total = hours * 3600 + minutes * 60 + seconds;
    return total > 0 ? total : null;
  }
  // Decimal-minutes fallback: a single comma or dot separator only (reject stray text).
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return null;
  const minutes = Number(value.replace(",", "."));
  if (!Number.isFinite(minutes)) return null;
  const total = Math.round(minutes * 60);
  return total > 0 ? total : null;
}

/** Seconds -> "mm:ss" (or "h:mm:ss" past an hour) for prefill and blur canonicalisation. */
export function formatClock(totalSeconds: number): string {
  const total = Math.round(totalSeconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:` : "") + `${mm}:${String(s).padStart(2, "0")}`;
}

/** Reformat a valid entry to canonical mm:ss on blur; leave anything unparseable untouched. */
export function canonicalDuration(raw: string): string {
  const seconds = parseDurationToSeconds(raw);
  return seconds === null ? raw : formatClock(seconds);
}
