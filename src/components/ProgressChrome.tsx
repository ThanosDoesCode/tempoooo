import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type ReactNode } from "react";
import { NotificationBell } from "./NotificationBell";

import { PERIOD_OPTIONS, useProgressSections, type ProgressSection } from "@/lib/progress-view";

import { progressPeriodLabel, type ProgressPeriod } from "@/lib/progress-period";

const NAV: Record<ProgressSection, { label: string; to: string }> = {
  overview: { label: "Overview", to: "/bulk/progress" },
  endurance: { label: "Endurance", to: "/bulk/progress/endurance" },
  strength: { label: "Strength", to: "/bulk/progress/strength" },
  body: { label: "Body & food", to: "/bulk/progress/body" },
};

/** The segmented Progress links. Keeps enabled areas visible before analytics exist. */
export function ProgressNav({ active }: { active: ProgressSection }) {
  const { sections } = useProgressSections();
  return (
    <nav
      aria-label="Progress view"
      className="mb-3.5 grid auto-cols-fr grid-flow-col rounded-[13px] bg-card p-1"
    >
      {sections.map((section) => {
        const { label, to } = NAV[section];
        const on = section === active;
        return (
          <Link
            key={section}
            to={to}
            preload="intent"
            aria-current={on ? "page" : undefined}
            className={`flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-[10px] px-1 text-[11px] min-[360px]:text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
              on ? "bg-elevated font-semibold text-foreground" : "font-medium text-muted-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Align the title with Today's heading below its leading metadata line. */
export function ProgressHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="mb-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-6">
      <h1 className="fade-up order-1 text-3xl font-semibold tracking-tight">Progress</h1>
      <div className="order-2 ml-auto min-[400px]:order-3">
        <NotificationBell />
      </div>
      {children ? (
        <div className="order-3 ml-auto flex min-w-0 basis-full justify-end min-[400px]:order-2 min-[400px]:basis-auto">
          {children}
        </div>
      ) : null}
    </header>
  );
}

export function PeriodPicker({
  period,
  onChange,
}: {
  period: ProgressPeriod;
  onChange: (period: ProgressPeriod) => void;
}) {
  return (
    <label className="relative inline-flex min-w-0">
      <span className="sr-only">Period</span>
      <NativeSelect
        value={period}
        onChange={(event) => onChange(event.target.value as ProgressPeriod)}
        className="h-11 rounded-[10px] bg-elevated text-[13px] font-medium text-foreground outline-none focus:ring-2 focus:ring-ring"
      >
        {PERIOD_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {progressPeriodLabel(option)}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

/** A labelled link row with an optional hint and chevron. Shared across Progress screens. */
export function ProgressRow({ to, label, hint }: { to: string; label: string; hint?: ReactNode }) {
  return (
    <Link
      to={to}
      preload="intent"
      className="flex min-h-[52px] items-center justify-between gap-3 border-t border-border first:border-t-0 active:opacity-80"
    >
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      {hint != null ? <span className="text-[13px] text-muted-foreground">{hint}</span> : null}
      <ChevronRight className="control-chevron text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/** A tiny trend sparkline. Renders nothing when there are fewer than two points. */
export function Sparkline({
  points,
  width = 130,
  height = 30,
  tone = "var(--color-primary)",
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const d = points
    .map((value, index) => {
      const x = index * stepX;
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={d}
        fill="none"
        stroke={tone}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
