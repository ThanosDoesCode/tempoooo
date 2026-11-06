import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { ActivityTile, PlannerCard, PlannerRowText, plannerRowClass } from "./PlannerParts";
import { plannedTitle, plannedWhen } from "@/lib/planner";
import { usePlannerUpcoming } from "@/lib/planner-query";

/**
 * Today's Upcoming: one bounded, non-blocking Planner read (null profile = no read at all).
 * Renders nothing while loading, on error, or when nothing is planned: never a large empty card.
 */
export function TodayUpcoming({ profileId, today }: { profileId: string | null; today: string }) {
  const upcoming = usePlannerUpcoming(profileId, today);
  const items = upcoming.data ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="today-upcoming" className="space-y-2">
      <div className="flex items-center justify-between px-1 text-[13px]">
        <h2 id="today-upcoming" className="font-medium text-muted-foreground">
          Upcoming
        </h2>
        <Link
          to="/planner"
          className="inline-flex min-h-11 items-center font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Planner
        </Link>
      </div>
      <PlannerCard>
        {items.map((item) => (
          <Link key={item.id} to="/planner" search={{ item: item.id }} className={plannerRowClass}>
            <ActivityTile item={item} />
            <PlannerRowText title={plannedTitle(item)} detail={plannedWhen(item, today)} />
            <ChevronRight
              className="control-chevron flex-none text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
        ))}
      </PlannerCard>
    </section>
  );
}
