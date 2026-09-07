import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck, ChevronRight, History, LineChart } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/bulk/more")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkMorePage,
});

const destinations = [
  {
    to: "/bulk/progress",
    label: "Progress",
    description: "Weight trends, photos and muscle coverage",
    icon: LineChart,
  },
  {
    to: "/bulk/check-in",
    label: "Check-In",
    description: "Review your week and calorie recommendation",
    icon: CalendarCheck,
  },
  {
    to: "/bulk/history",
    label: "History",
    description: "Past nutrition and completed workouts",
    icon: History,
  },
] as const;

function BulkMorePage() {
  return (
    <AppShell>
      <PageHeader title="More" subtitle="Progress, check-ins and your Goal history." />
      <div className="space-y-3">
        {destinations.map(({ to, label, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            preload="intent"
            className="card-surface flex min-h-16 items-center gap-3 p-4 transition active:scale-[0.99] active:bg-elevated"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {description}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
