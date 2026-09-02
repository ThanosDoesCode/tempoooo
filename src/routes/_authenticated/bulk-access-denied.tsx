import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui-kit";

export const Route = createFileRoute("/_authenticated/bulk-access-denied")({
  head: () => ({
    meta: [
      { title: "Bulk access required — Tempo" },
      {
        name: "description",
        content: "Bulk is a private Tempo administration area.",
      },
    ],
  }),
  component: BulkAccessDeniedPage,
});

function BulkAccessDeniedPage() {
  return (
    <AppShell>
      <Card className="mx-auto mt-8 max-w-sm text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warn/10 text-warn">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Bulk access required</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Bulk is private and only available to authorized administrators. Your Tempo Challenge
          access is unchanged.
        </p>
        <Link
          to="/challenge"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground active:scale-[0.98]"
        >
          Return to Challenge
        </Link>
      </Card>
    </AppShell>
  );
}
