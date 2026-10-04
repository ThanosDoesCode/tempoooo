import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type ReactNode } from "react";

import { PERIOD_OPTIONS, useProgressSections, type ProgressSection } from "@/lib/progress-view";

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
    <nav aria-label="Progress view" className="mb-3 flex gap-0.5 rounded-[13px] bg-card p-1">
      {sections.map((section) => {
        const { label, to } = NAV[section];
        const on = section === active;
        return (
          <Link
            key={section}
            to={to}
            preload="intent"
            aria-current={on ? "page" : undefined}
            className={`flex min-h-11 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[10px] text-[11px] min-[360px]:text-[13px] ${
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

export function PeriodPicker({
  weeks,
  onChange,
}: {
  weeks: number;
  onChange: (weeks: number) => void;
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">Period</span>
      <select
        value={weeks}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-9 rounded-[10px] bg-elevated pl-3 pr-7 text-[13px] font-medium text-foreground outline-none focus:ring-2 focus:ring-ring"
      >
        {PERIOD_OPTIONS.map((option) => (
          <option key={option} value={option}>
            Last {option} weeks
          </option>
        ))}
      </select>
      <ChevronRight
        className="pointer-events-none absolute right-1.5 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-muted-foreground"
        aria-hidden="true"
      />
    </label>
  );
}

/** A labelled link row with an optional hint and chevron. Shared across Progress screens. */
export function ProgressRow({ to, label, hint }: { to: string; label: string; hint?: ReactNode }) {
  return (
    <Link
      to={to}
      preload="intent"
      className="flex min-h-[52px] items-center gap-3 border-t border-border first:border-t-0 active:opacity-80"
    >
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      {hint != null ? <span className="text-[13px] text-muted-foreground">{hint}</span> : null}
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" aria-hidden="true" />
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
