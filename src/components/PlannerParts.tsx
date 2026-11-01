import type { ReactNode } from "react";
import { Bike, Check, Dumbbell, Footprints, type LucideIcon } from "lucide-react";
import {
  ACTIVITY_LABEL,
  ACTIVITY_TONE,
  plannedStatus,
  type PlannedActivity,
  type PlannedActivityType,
} from "@/lib/planner";

const ICON: Record<PlannedActivityType, LucideIcon> = {
  workout: Dumbbell,
  run: Footprints,
  ride: Bike,
};

export function ActivityTile({
  item,
  type = item?.type ?? "workout",
  size = "md",
}: {
  item?: PlannedActivity;
  type?: PlannedActivityType;
  size?: "md" | "lg";
}) {
  const done = item ? plannedStatus(item) === "completed" : false;
  const Icon = done ? Check : ICON[type];
  return (
    <span
      role="img"
      aria-label={done ? `${ACTIVITY_LABEL[type]}, completed` : ACTIVITY_LABEL[type]}
      className={`grid flex-none place-items-center ${
        size === "lg" ? "h-14 w-14 rounded-[16px]" : "h-10 w-10 rounded-[12px]"
      } ${done ? "bg-primary/60 text-primary-foreground" : ACTIVITY_TONE[type].tile}`}
    >
      <Icon className={size === "lg" ? "h-6 w-6" : "h-[18px] w-[18px]"} strokeWidth={1.9} />
    </span>
  );
}

/** Shared list surface for Today Upcoming, Agenda and the Calendar day list. */
export function PlannerCard({ children }: { children: ReactNode }) {
  return <div className="card-surface rounded-[20px] px-4">{children}</div>;
}

export const plannerRowClass =
  "flex min-h-[64px] w-full min-w-0 items-center gap-3 border-t border-border py-2.5 text-left first:border-t-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:opacity-80";

export function PlannerRowText({
  title,
  detail,
  muted,
}: {
  title: string;
  detail: string;
  muted?: boolean;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span
        className={`block truncate text-[15px] font-semibold ${muted ? "text-muted-foreground" : ""}`}
      >
        {title}
      </span>
      <span className="num block truncate text-[13px] text-muted-foreground">{detail}</span>
    </span>
  );
}

export const planningDisclaimer =
  "Planning doesn't count toward your streak or challenge. Log it when it's done.";
