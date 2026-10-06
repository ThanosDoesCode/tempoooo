import { useId, useState } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  pickerDate,
  pickerDateAllowed,
  pickerDateLabel,
  pickerDateValue,
  pickerTime,
  pickerTimeValue,
} from "@/lib/tempo-picker";
import { Calendar } from "./ui/calendar";
import { TimeWheel } from "./TempoTimeWheel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

const triggerClass =
  "flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[14px] border border-input bg-elevated px-3 py-2 text-left text-sm font-medium text-foreground outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const panelClass =
  "max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] max-w-sm overflow-y-auto rounded-[20px] border-border bg-card p-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-xl motion-reduce:animate-none motion-reduce:transition-none sm:p-5 [&>button:last-child]:right-1 [&>button:last-child]:top-1 [&>button:last-child]:grid [&>button:last-child]:size-11 [&>button:last-child]:place-items-center";

type PickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string | undefined;
  "aria-label"?: string | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: boolean | undefined;
};

export function TempoDatePicker({
  value,
  onChange,
  min,
  max,
  clearable = false,
  label,
  "aria-label": ariaLabel,
  className,
  ...props
}: PickerProps & { min?: string; max?: string; clearable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => pickerDate(value) ?? new Date());
  const title = ariaLabel ?? label ?? "Choose date";
  const today = pickerDateValue(new Date());
  const select = (next: string) => {
    if (!pickerDateAllowed(next, min, max)) return;
    onChange(next);
    setOpen(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(pickerDate(value) ?? pickerDate(max ?? "") ?? new Date());
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          {...props}
          aria-label={`${title}: ${pickerDateLabel(value)}`}
          className={cn(triggerClass, className)}
        >
          <span className="min-w-0 break-words">{pickerDateLabel(value)}</span>
          <CalendarDays className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className={panelClass} data-no-pull>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">Choose a calendar date.</DialogDescription>
        </DialogHeader>
        <Calendar
          mode="single"
          weekStartsOn={1}
          month={month}
          onMonthChange={setMonth}
          selected={pickerDate(value)}
          onSelect={(day) => day && select(pickerDateValue(day))}
          disabled={(day) => !pickerDateAllowed(pickerDateValue(day), min, max)}
          autoFocus
          className="w-full bg-transparent p-0 [--cell-size:min(2.75rem,calc((100vw_-_2.625rem)/7))] [&_button[data-selected-single=true]]:bg-primary/15 [&_button[data-selected-single=true]]:text-primary"
          classNames={{
            root: "w-full",
            day: "group/day relative w-[14.2857%] min-w-0 p-0 text-center",
            today: "rounded-xl ring-1 ring-inset ring-primary/40",
          }}
        />
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <button
            type="button"
            disabled={!pickerDateAllowed(today, min, max)}
            onClick={() => select(today)}
            className="min-h-11 rounded-xl px-4 text-sm font-semibold text-primary disabled:opacity-40 hover:bg-elevated"
          >
            Today
          </button>
          {clearable ? (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="min-h-11 rounded-xl px-4 text-sm text-muted-foreground hover:bg-elevated"
            >
              Clear
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TempoTimePicker({
  value,
  onChange,
  label,
  "aria-label": ariaLabel,
  className,
  ...props
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => pickerTime(value) ?? { hour: 0, minute: 0 });
  const title = ariaLabel ?? label ?? "Choose time";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(pickerTime(value) ?? { hour: 0, minute: 0 });
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          {...props}
          aria-label={`${title}: ${pickerTime(value) ? value : "Choose time"}`}
          className={cn(triggerClass, className)}
        >
          <span>{pickerTime(value) ? value : "Choose time"}</span>
          <Clock className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className={panelClass} data-no-pull>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>24-hour time</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 grid-cols-2 gap-3">
          {(["hour", "minute"] as const).map((part) => (
            <TimeWheel
              key={part}
              max={part === "hour" ? 23 : 59}
              value={draft[part]}
              ariaLabel={part === "hour" ? "Hours" : "Minutes"}
              onChange={(number) => setDraft((current) => ({ ...current, [part]: number }))}
            />
          ))}
        </div>
        <button
          type="button"
          className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          onClick={() => {
            onChange(pickerTimeValue(draft.hour, draft.minute));
            setOpen(false);
          }}
        >
          Use time
        </button>
      </DialogContent>
    </Dialog>
  );
}

/** Compose the same pickers while retaining the datetime-local string contract. */
export function TempoDateTimePicker({
  value,
  onChange,
  dateFallback,
  label,
  disabled,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: PickerProps & { dateFallback: string }) {
  const id = useId();
  const date = value.slice(0, 10) || dateFallback;
  const time = value.slice(11, 16);
  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-time`} className="block text-sm">
        {label}
      </label>
      <TempoTimePicker
        id={`${id}-time`}
        label={label}
        disabled={disabled}
        value={time}
        onChange={(next) => onChange(`${date}T${next}`)}
        aria-describedby={describedBy}
        aria-invalid={invalid}
      />
      <TempoDatePicker
        label={`${label} date`}
        disabled={disabled}
        value={date}
        onChange={(next) => onChange(`${next}T${time || "00:00"}`)}
        className="border-transparent bg-transparent py-1 text-xs text-muted-foreground"
        aria-describedby={describedBy}
        aria-invalid={invalid}
      />
    </div>
  );
}
