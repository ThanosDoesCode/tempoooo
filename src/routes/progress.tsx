import { createFileRoute } from "@tanstack/react-router";
import { addMonths, format, isWithinInterval, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { useMemo, useRef, useState } from "react";
import {
  Bar as RBar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Chip, Note, SectionTitle, Stat } from "@/components/ui-kit";
import {
  avg7,
  exerciseHistory,
  fmt,
  fmt0,
  iso,
  latestWeight,
  mean,
  signed,
  sortedDays,
  weekStartOf,
} from "@/lib/calc";
import { setData, useAppData } from "@/lib/store";
import { EXERCISES, type AppData, type PhotoSet } from "@/lib/types";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Progress — Lean Bulk Tracker" },
      {
        name: "description",
        content: "Weight trend, waist, calories, activity and strength across the 12-month bulk.",
      },
      { property: "og:title", content: "Progress — Lean Bulk Tracker" },
      {
        property: "og:description",
        content: "Long-term charts and progress photo comparisons for a lean bulk.",
      },
    ],
  }),
  component: ProgressPage,
});

const MONTHS = Array.from({ length: 13 }, (_, i) => addMonths(new Date(2026, 8, 1), i));

function ProgressPage() {
  const data = useAppData();
  const [monthIdx, setMonthIdx] = useState(() => {
    const now = new Date();
    const idx = MONTHS.findIndex((m) => format(m, "yyyy-MM") === format(now, "yyyy-MM"));
    return idx >= 0 ? idx : 0;
  });

  if (!data) {
    return (
      <AppShell>
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </AppShell>
    );
  }

  const month = MONTHS[monthIdx] as Date;
  const interval = { start: startOfMonth(month), end: endOfMonth(month) };
  const all = sortedDays(data);
  const inMonth = all.filter((d) => isWithinInterval(parseISO(d.date), interval));

  const latest = latestWeight(data);
  const rolling = latest ? avg7(data, latest.date) : null;
  const start = data.targets.startWeight;
  const target = data.targets.targetWeight;
  const gained = latest ? latest.weight - start : null;
  const remaining = latest ? target - latest.weight : null;

  const weekly = weeklySeries(data);
  const avgWeeklyGain =
    weekly.length > 1
      ? mean(
          weekly
            .slice(1)
            .map((w, i) => (w.avg != null && weekly[i]!.avg != null ? w.avg - weekly[i]!.avg! : null))
            .filter((v): v is number => v != null),
        )
      : null;

  const weightSeries = inMonth.map((d) => ({
    date: d.date,
    weight: d.weight ?? null,
    avg: avg7(data, d.date),
  }));

  const waistSeries = all
    .filter((d) => d.waist != null)
    .map((d) => ({ date: d.date, waist: d.waist as number }));

  return (
    <AppShell>
      <PageHeader title="Progress" subtitle="September 2026 to September 2027" />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {MONTHS.map((m, i) => (
          <div key={i} className="shrink-0">
            <Chip active={i === monthIdx} onClick={() => setMonthIdx(i)}>
              {format(m, "MMM yy")}
            </Chip>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Current" value={fmt(latest?.weight, 1)} hint="kg" />
        <Stat label="7-day avg" value={fmt(rolling, 1)} hint="kg" />
        <Stat label="Start" value={fmt(start, 1)} hint="kg" />
        <Stat label="Target" value={fmt(target, 1)} hint="kg" />
        <Stat label="Gained" value={signed(gained, 1)} hint="kg" tone="good" />
        <Stat label="Remaining" value={fmt(remaining, 1)} hint="kg" />
      </div>

      <div className="mt-2">
        <Stat
          label="Average weekly gain"
          value={signed(avgWeeklyGain, 2)}
          hint="kg/week · target +0.20 to +0.30"
          tone={
            avgWeeklyGain == null
              ? "muted"
              : avgWeeklyGain < 0.2
                ? "warn"
                : avgWeeklyGain > 0.3
                  ? "danger"
                  : "good"
          }
        />
      </div>

      <div className="mt-4 space-y-4">
        <Card>
          <SectionTitle>Weight · {format(month, "MMMM yyyy")}</SectionTitle>
          <ChartBox>
            <ComposedChart data={weightSeries} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => format(parseISO(d), "d")} {...axis} />
              <YAxis domain={["auto", "auto"]} {...axis} />
              <Tooltip {...tooltip} />
              <ReferenceLine y={start} stroke="var(--color-chart-5)" strokeDasharray="4 4" />
              <ReferenceLine y={target} stroke="var(--color-chart-2)" strokeDasharray="4 4" />
              <Scatter dataKey="weight" fill="var(--color-chart-5)" opacity={0.5} />
              <Line
                type="monotone"
                dataKey="avg"
                stroke="var(--color-chart-1)"
                strokeWidth={2.5}
                dot={false}
                connectNulls
                name="7-day avg"
              />
            </ComposedChart>
          </ChartBox>
        </Card>

        <Card>
          <SectionTitle>Waist</SectionTitle>
          <ChartBox>
            <ComposedChart data={waistSeries} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => format(parseISO(d), "d MMM")} {...axis} />
              <YAxis domain={["auto", "auto"]} {...axis} />
              <Tooltip {...tooltip} />
              <Line type="monotone" dataKey="waist" stroke="var(--color-chart-3)" strokeWidth={2.5} dot />
            </ComposedChart>
          </ChartBox>
        </Card>

        <Card>
          <SectionTitle>Calories by week</SectionTitle>
          <ChartBox>
            <BarChart data={weekly} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip {...tooltip} />
              <ReferenceLine y={data.targets.calories} stroke="var(--color-chart-2)" strokeDasharray="4 4" />
              <RBar dataKey="calories" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} name="Avg kcal" />
            </BarChart>
          </ChartBox>
        </Card>

        <Card>
          <SectionTitle>Activity by week</SectionTitle>
          <ChartBox>
            <BarChart data={weekly} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip {...tooltip} />
              <RBar dataKey="cycling" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} name="Cycling km" />
              <RBar dataKey="running" fill="var(--color-chart-3)" radius={[6, 6, 0, 0]} name="Running km" />
            </BarChart>
          </ChartBox>
          <p className="mt-2 text-xs text-muted-foreground">
            Average steps/day, last week logged:{" "}
            <span className="num font-semibold text-foreground">
              {fmt0(weekly[weekly.length - 1]?.steps ?? null)}
            </span>
          </p>
        </Card>

        <Card>
          <SectionTitle>Strength trend</SectionTitle>
          <div className="space-y-2">
            {Object.values(EXERCISES)
              .flat()
              .map((ex) => {
                const h = exerciseHistory(data, ex);
                const first = h[0];
                const last = h[h.length - 1];
                const delta = first && last ? last.volume - first.volume : null;
                return (
                  <div key={ex} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-muted-foreground">{ex}</span>
                    <span
                      className={`num shrink-0 font-semibold ${
                        delta == null ? "text-muted-foreground" : delta > 0 ? "text-good" : delta === 0 ? "text-warn" : "text-danger"
                      }`}
                    >
                      {delta == null
                        ? "—"
                        : `${delta > 0 ? "↑" : delta === 0 ? "→" : "↓"} ${last?.weight ?? 0}kg × ${last?.bestReps ?? 0}`}
                    </span>
                  </div>
                );
              })}
          </div>
        </Card>

        <PhotosSection data={data} />
      </div>
    </AppShell>
  );
}

const axis = {
  tick: { fontSize: 10, fill: "var(--color-muted-foreground)" },
  axisLine: false,
  tickLine: false,
} as const;

const tooltip = {
  contentStyle: {
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    borderRadius: 12,
    fontSize: 12,
  },
} as const;

function ChartBox({ children }: { children: React.ReactElement }) {
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function weeklySeries(data: AppData) {
  const buckets = new Map<string, { cal: number[]; steps: number[]; cycling: number; running: number; end: string }>();
  for (const d of sortedDays(data)) {
    const key = iso(weekStartOf(parseISO(d.date)));
    const b = buckets.get(key) ?? { cal: [], steps: [], cycling: 0, running: 0, end: d.date };
    if (d.calories != null) b.cal.push(d.calories);
    if (d.steps != null) b.steps.push(d.steps);
    b.cycling += d.cyclingKm ?? 0;
    b.running += d.runningKm ?? 0;
    b.end = d.date;
    buckets.set(key, b);
  }
  return [...buckets.entries()].map(([key, b]) => ({
    label: format(parseISO(key), "d MMM"),
    calories: mean(b.cal) ?? 0,
    steps: mean(b.steps),
    cycling: Number(b.cycling.toFixed(1)),
    running: Number(b.running.toFixed(1)),
    avg: avg7(data, b.end),
  }));
}

function PhotosSection({ data }: { data: AppData }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ id: string; slot: "front" | "side" | "back" } | null>(null);
  const [compare, setCompare] = useState(false);

  const photos = useMemo(
    () => [...data.photos].sort((a, b) => a.date.localeCompare(b.date)),
    [data.photos],
  );
  const first = photos[0];
  const last = photos[photos.length - 1];

  const addSet = () => {
    const latest = latestWeight(data);
    const entry: PhotoSet = {
      id: crypto.randomUUID(),
      date: iso(new Date()),
      ...(latest ? { weight: latest.weight } : {}),
    };
    setData((prev) => ({ ...prev, photos: [...prev.photos, entry] }));
  };

  const onFile = async (file: File) => {
    if (!pending) return;
    const dataUrl = await downscale(file);
    setData((prev) => ({
      ...prev,
      photos: prev.photos.map((p) => (p.id === pending.id ? { ...p, [pending.slot]: dataUrl } : p)),
    }));
    setPending(null);
  };

  return (
    <Card>
      <SectionTitle
        right={
          <button onClick={addSet} className="text-xs font-medium text-primary">
            + New set
          </button>
        }
      >
        Progress photos
      </SectionTitle>
      <Note>
        Take every 4 weeks in the same location, lighting, distance and pose. Photos stay on this
        device only.
      </Note>

      {first && last && first.id !== last.id ? (
        <button
          onClick={() => setCompare((c) => !c)}
          className="mt-3 w-full rounded-xl border border-border bg-elevated py-2 text-sm font-medium"
        >
          {compare ? "Hide comparison" : "Compare start vs now"}
        </button>
      ) : null}

      {compare && first && last ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[first, last].map((p, i) => (
            <div key={p.id} className="rounded-xl border border-border p-2">
              <p className="mb-1 text-[11px] text-muted-foreground">
                {i === 0 ? "Start" : "Now"} · {format(parseISO(p.date), "d MMM yy")} · {fmt(p.weight, 1)} kg
              </p>
              {p.front ? (
                <img src={p.front} alt="Progress front view" className="w-full rounded-lg" />
              ) : (
                <div className="grid h-32 place-items-center rounded-lg bg-elevated text-[11px] text-muted-foreground">
                  No front photo
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {photos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No photo sets yet.</p>
        ) : null}
        {photos.map((p) => (
          <div key={p.id} className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium">{format(parseISO(p.date), "d MMM yyyy")}</span>
              <span className="num text-muted-foreground">{fmt(p.weight, 1)} kg</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["front", "side", "back"] as const).map((slot) => (
                <button
                  key={slot}
                  onClick={() => {
                    setPending({ id: p.id, slot });
                    fileRef.current?.click();
                  }}
                  className="overflow-hidden rounded-lg border border-border bg-elevated"
                >
                  {p[slot] ? (
                    <img src={p[slot]} alt={`${slot} progress`} className="h-28 w-full object-cover" />
                  ) : (
                    <span className="grid h-28 place-items-center text-[11px] capitalize text-muted-foreground">
                      + {slot}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
    </Card>
  );
}

async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxW = 640;
  const scale = Math.min(1, maxW / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}
