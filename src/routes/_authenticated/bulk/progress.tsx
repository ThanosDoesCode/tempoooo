import { createFileRoute } from "@tanstack/react-router";
import { addMonths, format, parseISO, endOfMonth } from "date-fns";
import { useMemo, useRef, useState } from "react";
import {
  Area,
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
  bulkStatus,
  exerciseHistory,
  fmt,
  fmt0,
  iso,
  latestWeight,
  mean,
  pctSigned,
  signed,
  sortedDays,
  strengthChange,
  waistChange,
  weekStartOf,
} from "@/lib/calc";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";
import { ALL_EXERCISES, type AppData, type PhotoSet } from "@/lib/types";


export const Route = createFileRoute("/_authenticated/bulk/progress")({
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
  const all = sortedDays(data);


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

  const status = bulkStatus(data);
  const monthDays = Array.from(
    { length: endOfMonth(month).getDate() },
    (_, i) => iso(new Date(month.getFullYear(), month.getMonth(), i + 1)),
  );
  const firstAvg =
    monthDays.map((d) => avg7(data, d)).find((v): v is number => v != null) ?? null;

  const weightSeries = monthDays.map((d, i) => ({
    date: d,
    weight: data.days[d]?.weight ?? null,
    avg: avg7(data, d),
    bandLow: firstAvg == null ? null : firstAvg + (0.2 * i) / 7,
    bandHigh: firstAvg == null ? null : firstAvg + (0.3 * i) / 7,
  }));

  const waistSeries = all
    .filter((d) => d.waist != null)
    .map((d) => ({ date: d.date, waist: d.waist as number }));
  const waist4w = waistChange(data, 28);


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

      <div className="mt-2">
        <Card>
          <SectionTitle>Projection</SectionTitle>
          <div className="divide-y divide-border text-sm">
            {[
              ["Current 7-day average", fmt(status.currentAvg, 1, " kg")],
              ["Current pace", signed(status.rate, 2, " kg/week")],
              ["Projected Sep 2027", fmt(status.projected, 1, " kg")],
              [
                `Projected ${target} kg date`,
                status.projectedDate ? format(parseISO(status.projectedDate), "MMM yyyy") : "—",
              ],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 py-2">
                <span className="text-muted-foreground">{k}</span>
                <span className="num font-semibold">{v}</span>
              </div>
            ))}
          </div>
        </Card>
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
              <Area
                type="monotone"
                dataKey="bandHigh"
                stroke="none"
                fill="var(--color-good)"
                fillOpacity={0.14}
                connectNulls
                name="+0.30 kg/wk"
                activeDot={false}
              />
              <Area
                type="monotone"
                dataKey="bandLow"
                stroke="none"
                fill="var(--color-card)"
                fillOpacity={1}
                connectNulls
                name="+0.20 kg/wk"
                activeDot={false}
              />
              <Scatter dataKey="weight" fill="var(--color-chart-5)" opacity={0.45} />
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
          <p className="mt-1 text-[11px] text-muted-foreground">
            Faint points are daily weigh-ins. The line is the 7-day average. The shaded band is the
            +0.2 to +0.3 kg/week target zone from the start of the month.
          </p>
        </Card>

        <Card>
          <SectionTitle
            right={
              <span
                className={`num text-xs font-semibold ${
                  waist4w == null
                    ? "text-muted-foreground"
                    : waist4w > 1.5
                      ? "text-danger"
                      : waist4w > 0.8
                        ? "text-warn"
                        : "text-good"
                }`}
              >
                {signed(waist4w, 1, " cm / 4 weeks")}
              </span>
            }
          >
            Waist
          </SectionTitle>
          <ChartBox>
            <ComposedChart data={waistSeries} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => format(parseISO(d), "d MMM")} {...axis} />
              <YAxis domain={["auto", "auto"]} {...axis} />
              <Tooltip {...tooltip} />
              <Line type="monotone" dataKey="waist" stroke="var(--color-chart-3)" strokeWidth={2.5} dot />
            </ComposedChart>
          </ChartBox>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Some waist growth is normal while gaining. Only excessive growth matters.
          </p>
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
          <p className="mb-2 text-[11px] text-muted-foreground">
            Volume change from your first logged session to the latest.
          </p>
          <div className="space-y-2">
            {ALL_EXERCISES.map((def) => {
              const s = strengthChange(data, def.name);
              const arrow = s == null ? "•" : s.pct > 2 ? "↑" : s.pct < -2 ? "↓" : "→";
              const tone =
                s == null
                  ? "text-muted-foreground"
                  : s.pct > 2
                    ? "text-good"
                    : s.pct < -2
                      ? "text-danger"
                      : "text-warn";
              return (
                <div key={def.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">{def.name}</span>
                  <span className={`num shrink-0 font-semibold ${tone}`}>
                    {s == null ? "—" : `${arrow} ${pctSigned(s.pct)} · ${s.latest}`}
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
  const { addPhotoSet, setPhotoImage, importBackup: restoreBackup, deletePhotoSet } = useActions();
  const { role } = useBulkMeta();
  const owner = role === "owner";
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ id: string; slot: "front" | "side" | "back" } | null>(null);
  const [compare, setCompare] = useState(false);
  const [slot, setSlot] = useState<"front" | "side" | "back">("front");
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const removeSet = async (id: string) => {
    setConfirmDelete(null);
    await deletePhotoSet(id);
  };


  const photos = useMemo(
    () => [...data.photos].sort((a, b) => a.date.localeCompare(b.date)),
    [data.photos],
  );
  const first = photos[0];
  const last = photos[photos.length - 1];
  const a = photos.find((p) => p.id === aId) ?? first;
  const b = photos.find((p) => p.id === bId) ?? last;

  const addSet = () => {
    const latest = latestWeight(data);
    void addPhotoSet(iso(new Date()), latest?.weight);
  };

  const onFile = async (file: File) => {
    if (!pending) return;
    const dataUrl = await downscale(file);
    await setPhotoImage(pending.id, pending.slot, dataUrl);
    setPending(null);
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lean-bulk-backup-${iso(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppData;
      if (!parsed.days) return;
      await restoreBackup(parsed);
    } catch {
      /* invalid file */
    }
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
        Take every 4 weeks in the same location, lighting, distance and pose. Photos are stored
        privately in your account, and you can still export a backup file of your logs.
      </Note>


      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={exportBackup}
          className="rounded-xl border border-border bg-elevated py-2 text-sm font-medium"
        >
          Export backup
        </button>
        <button
          onClick={() => importRef.current?.click()}
          className="rounded-xl border border-border bg-elevated py-2 text-sm font-medium"
        >
          Restore backup
        </button>
      </div>
      <input
        ref={importRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importBackup(f);
          e.target.value = "";
        }}
      />

      {photos.length > 1 ? (
        <button
          onClick={() => setCompare((c) => !c)}
          className="mt-3 w-full rounded-xl border border-border bg-elevated py-2 text-sm font-medium"
        >
          {compare ? "Hide comparison" : "Compare two dates"}
        </button>
      ) : null}

      {compare && a && b ? (
        <div className="mt-3">
          <div className="mb-2 flex gap-1.5">
            {(["front", "side", "back"] as const).map((s) => (
              <Chip key={s} active={slot === s} onClick={() => setSlot(s)}>
                <span className="capitalize">{s}</span>
              </Chip>
            ))}
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <PhotoSelect photos={photos} value={a.id} onChange={setAId} />
            <PhotoSelect photos={photos} value={b.id} onChange={setBId} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[a, b].map((p, i) => (
              <div key={`${p.id}-${i}`} className="rounded-xl border border-border p-2">
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {format(parseISO(p.date), "d MMM yy")} · {fmt(p.weight, 1)} kg
                </p>
                {p[slot] ? (
                  <img src={p[slot]} alt={`${slot} progress`} className="w-full rounded-lg" />
                ) : (
                  <div className="grid h-32 place-items-center rounded-lg bg-elevated text-[11px] capitalize text-muted-foreground">
                    No {slot} photo
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}


      <div className="mt-3 space-y-3">
        {photos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No photo sets yet.</p>
        ) : null}
        {photos.map((p) => (
          <div key={p.id} className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">{format(parseISO(p.date), "d MMM yyyy")}</span>
              <div className="flex items-center gap-3">
                <span className="num text-muted-foreground">{fmt(p.weight, 1)} kg</span>
                {owner ? (
                  <button
                    onClick={() => {
                      if (confirmDelete === p.id) void removeSet(p.id);
                      else setConfirmDelete(p.id);
                    }}
                    className={`rounded-lg px-2 py-1 text-[11px] font-medium ${
                      confirmDelete === p.id
                        ? "bg-danger text-primary-foreground"
                        : "text-danger hover:bg-danger/10"
                    }`}
                  >
                    {confirmDelete === p.id ? "Confirm delete" : "Delete"}
                  </button>
                ) : null}
              </div>
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

function PhotoSelect({
  photos,
  value,
  onChange,
}: {
  photos: PhotoSet[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-input bg-elevated px-2 py-2 text-xs outline-none focus:border-ring"
    >
      {photos.map((p) => (
        <option key={p.id} value={p.id}>
          {format(parseISO(p.date), "d MMM yyyy")}
        </option>
      ))}
    </select>
  );
}
