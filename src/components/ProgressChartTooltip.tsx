import { format, parseISO } from "date-fns";

type ChartPoint = {
  date?: string;
  calories?: number | null;
  target?: number | null;
  avg?: number | null;
  value?: number | null;
  distanceKm?: number;
  pace?: number;
  durationSeconds?: number;
};
export function ProgressChartTooltip({
  active,
  payload,
  kind,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  kind: "food" | "weight" | "strength" | "pace";
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const number = (value: number) => value.toLocaleString("en-GB", { maximumFractionDigits: 1 });
  const pace = (seconds: number) => {
    const rounded = Math.round(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
  };
  return (
    <div
      role="status"
      className="max-w-[min(240px,calc(100vw-56px))] rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-lg"
    >
      <p className="font-semibold text-foreground">
        {point.date ? format(parseISO(point.date), "EEE d MMM") : "Logged performance"}
      </p>
      <p className="num mt-1 font-semibold text-foreground">
        {kind === "food"
          ? point.calories != null
            ? `${number(point.calories)} kcal`
            : "No meals logged"
          : kind === "pace"
            ? `${pace(point.pace!)} /km`
            : `${number((point.avg ?? point.value)!)} kg`}
      </p>
      {kind === "food" && point.target != null ? (
        <p className="mt-0.5 text-muted-foreground">Target {number(point.target)}</p>
      ) : null}
      {kind === "pace" ? (
        <p className="num mt-0.5 text-muted-foreground">
          {number(point.distanceKm!)} km · {pace(point.durationSeconds!)}
        </p>
      ) : null}
    </div>
  );
}
