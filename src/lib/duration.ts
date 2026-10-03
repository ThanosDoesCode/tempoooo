/**
 * The single source of truth for interpreting the Add/Edit activity "Time" field. Used by the
 * live pace/speed preview, validation, save, and edit prefill — there is no other duration logic.
 *
 * Grammar (first matching rule wins):
 *  - Unit-based ("30s", "15m", "1h 5m 30s", "1 hour 15 minutes"): sum h/m/s, overflow allowed.
 *  - Clock-based with ":" or "." (one separator kind only):
 *      2 parts  "mm:ss" / "mm.ss"  -> minutes:seconds (seconds < 60; minutes unbounded)
 *      3 parts  "h:mm:ss" / "h.mm.ss" -> hours:minutes:seconds (minutes < 60, seconds < 60)
 *  - A plain number with no unit and no separator is MINUTES ("15" = 15 min, "90" = 1h30m).
 * Returns whole seconds, or null for anything invalid/non-positive.
 */
export function parseDurationToSeconds(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  // Unit-based input (anything with a letter must be a valid unit expression).
  if (/[a-z]/.test(value)) return parseUnitDuration(value);

  const hasColon = value.includes(":");
  const hasDot = value.includes(".");

  // Clock-based input. Mixing ":" and "." is rejected.
  if (hasColon || hasDot) {
    if (hasColon && hasDot) return null;
    const parts = value.split(hasColon ? ":" : ".");
    if (!parts.every((p) => /^\d+$/.test(p))) return null;
    const nums = parts.map(Number);
    if (nums.length === 2) {
      const [m, s] = nums as [number, number];
      if (s >= 60) return null;
      const total = m * 60 + s;
      return total > 0 ? total : null;
    }
    if (nums.length === 3) {
      const [h, m, s] = nums as [number, number, number];
      if (m >= 60 || s >= 60) return null;
      const total = h * 3600 + m * 60 + s;
      return total > 0 ? total : null;
    }
    return null;
  }

  // Plain number = minutes.
  if (!/^\d+$/.test(value)) return null;
  const total = Number(value) * 60;
  return total > 0 ? total : null;
}

const UNIT_PATTERN = /(\d+)\s*(hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)/g;

function parseUnitDuration(value: string): number | null {
  UNIT_PATTERN.lastIndex = 0;
  let total = 0;
  let matched = 0;
  let match: RegExpExecArray | null;
  while ((match = UNIT_PATTERN.exec(value)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2]!;
    if (unit.startsWith("h")) total += amount * 3600;
    else if (unit.startsWith("m"))
      total += amount * 60; // m/min/mins/minute/minutes
    else total += amount; // s/sec/secs/second/seconds
    matched += 1;
  }
  if (matched === 0) return null;
  // The whole string must be unit tokens; reject trailing junk like "15 foo".
  const leftover = value.replace(UNIT_PATTERN, "").replace(/\s+/g, "");
  if (leftover.length > 0) return null;
  return total > 0 ? total : null;
}

/**
 * Seconds -> canonical display. Under an hour it is "m:ss" (e.g. "0:30", "5:00", "15:50"); from an
 * hour it is "h:mm:ss" (e.g. "1:00:00", "1:05:30", "1:30:00"). Used for blur and edit prefill.
 */
export function formatClock(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:` : "") + `${mm}:${String(s).padStart(2, "0")}`;
}

/** Reformat a valid entry to its canonical display on blur; leave anything unparseable untouched. */
export function canonicalDuration(raw: string): string {
  const seconds = parseDurationToSeconds(raw);
  return seconds === null ? raw : formatClock(seconds);
}
