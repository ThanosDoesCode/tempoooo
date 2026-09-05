import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Dumbbell } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, PendingLabel } from "@/components/ui-kit";
import { bulkOwnerQueryOptions } from "@/lib/bulk-access";
import { userFacingError } from "@/lib/network-errors";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/bulk-onboarding")({
  beforeLoad: async ({ context }) => {
    const plans = await context.queryClient.ensureQueryData(bulkOwnerQueryOptions());
    if (plans.length) throw redirect({ to: "/bulk", replace: true });
  },
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: BulkOnboardingPlaceholder,
});

function BulkOnboardingPlaceholder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: planId, error: activationError } = await supabase.rpc("activate_my_bulk");
      if (activationError || !planId) throw activationError ?? new Error("Bulk activation failed");
      await queryClient.invalidateQueries({
        queryKey: ["bulk-memberships"],
        refetchType: "none",
      });
      const plans = await queryClient.fetchQuery({ ...bulkOwnerQueryOptions(), staleTime: 0 });
      if (!plans.some((plan) => plan.bulk_profile_id === planId))
        throw new Error("Your Bulk plan is still being prepared. Please retry.");
      await navigate({ to: "/bulk", replace: true });
    } catch (cause) {
      setError(userFacingError(cause, "activate Bulk"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageHeader title="Start My Bulk" subtitle="Your personal nutrition and training space" />
      <Card className="text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Dumbbell className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Activate your Bulk plan</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This creates your private Bulk space. Personalized setup questions will be added in the
          next step of the rollout.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void activate()}
          className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? <PendingLabel>Activating My Bulk...</PendingLabel> : "Activate My Bulk"}
        </button>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Card>
    </AppShell>
  );
}
