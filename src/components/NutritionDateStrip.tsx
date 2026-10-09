import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TempoDatePicker } from "./TempoDateTimePicker";
import { iso } from "@/lib/calc";

/** Controlled by the route's local calendar date, never a parallel selection state. */
export function NutritionDateStrip({
  selectedDate,
  today,
  onChange,
}: {
  selectedDate: string;
  today: string;
  onChange: (date: string) => void;
}) {
  const start = startOfWeek(parseISO(selectedDate), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, index) => iso(addDays(start, index)));
  const move = (amount: number) => onChange(iso(addDays(parseISO(selectedDate), amount)));
  return (
    <div className="min-w-0 space-y-1" data-no-pull>
      <div className="mx-auto grid min-h-11 w-full max-w-xs grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-1">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => move(-7)}
          className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="control-chevron" aria-hidden="true" />
        </button>
        <TempoDatePicker
          label="Nutrition date"
          value={selectedDate}
          max={today}
          onChange={onChange}
          className="min-h-11 min-w-0 flex-1 justify-center rounded-lg border-0 bg-transparent px-0 text-center text-[13px] hover:bg-elevated [&>svg]:hidden"
        />
        <button
          type="button"
          aria-label="Next week"
          onClick={() =>
            onChange(
              iso(addDays(parseISO(selectedDate), 7)) > today
                ? today
                : iso(addDays(parseISO(selectedDate), 7)),
            )
          }
          disabled={selectedDate >= today}
          className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-elevated disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="control-chevron" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1" aria-label="Nutrition days">
        {days.map((date) => (
          <button
            key={date}
            type="button"
            disabled={date > today}
            aria-label={format(parseISO(date), "EEEE d MMMM yyyy")}
            aria-pressed={date === selectedDate}
            aria-current={date === today ? "date" : undefined}
            onClick={() => onChange(date)}
            className={`flex h-13 min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-sm disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-80 ${date === selectedDate ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30" : "bg-card text-muted-foreground"}`}
          >
            <span className="text-[10px] min-[360px]:text-[11px]">
              {format(parseISO(date), "EEE")}
            </span>
            <span className="num text-base font-semibold">{format(parseISO(date), "d")}</span>
            <span
              aria-hidden="true"
              className={`h-1 w-1 rounded-full ${date === today ? "bg-primary" : "bg-transparent"}`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
