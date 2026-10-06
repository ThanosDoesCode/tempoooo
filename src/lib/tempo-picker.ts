import { format, isValid, parseISO } from "date-fns";

/** Calendar values stay local YYYY-MM-DD strings, never UTC timestamps. */
export function pickerDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parseISO(value);
  return isValid(date) && format(date, "yyyy-MM-dd") === value ? date : undefined;
}

export function pickerDateValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function pickerDateLabel(value: string): string {
  const date = pickerDate(value);
  return date ? format(date, "d MMMM yyyy") : "Choose date";
}

export function pickerDateAllowed(value: string, min?: string, max?: string): boolean {
  return !!pickerDate(value) && (!min || value >= min) && (!max || value <= max);
}

export function pickerTime(value: string): { hour: number; minute: number } | undefined {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  return { hour: hour!, minute: minute! };
}

export function pickerTimeValue(hour: number, minute: number): string {
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  )
    throw new RangeError("Choose a valid 24-hour time.");
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
