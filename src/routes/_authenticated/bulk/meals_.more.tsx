import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, History, Salad } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";

const destinations = [
  {
    to: "/bulk/meals/presets",
    label: "Manage meal presets",
    description: "Create, edit and reorder reusable meals",
    icon: Salad,
  },
  {
    to: "/bulk/meals/history",
    label: "Nutrition history",
    description: "Review targets and logged meals from previous days",
    icon: History,
  },
] as const;

export const Route = createFileRoute("/_authenticated/bulk/meals_/more")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: MealsMorePage,
});

function MealsMorePage() {
  return (
    <AppShell>
      <PageHeader title="Meal tools" subtitle="Manage reusable meals and nutrition records." />
      <div className="space-y-3">
        {destinations.map(({ to, label, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            preload="intent"
            className="card-surface flex min-h-16 items-center gap-3 p-4 active:scale-[0.99]"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{label}</span>
              <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
