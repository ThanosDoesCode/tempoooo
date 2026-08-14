import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  eur,
  usePayments,
  useChallengeMembers,
  useMyChallenge,
  useWeeks,
} from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Challenge" },
      {
        name: "description",
        content:
          "Outstanding penalties, mark as paid and recipient confirmation for your two-person endurance challenge.",
      },
      { property: "og:title", content: "Payments — Challenge" },
      { property: "og:description", content: "Owe, pay, confirm. Nothing is deleted." },
    ],
  }),
  component: Payments,
});

function Payments() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: challenge } = useMyChallenge();
  const { data: members } = useChallengeMembers(challenge?.id);
  const { data: payments } = usePayments(challenge?.id);
  const { data: weeks } = useWeeks(challenge?.id);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = payments ?? [];
  const iOwe = rows
    .filter((p) => p.payer_id === user?.id && p.status !== "confirmed_paid")
    .reduce((s, p) => s + Number(p.amount_eur), 0);
  const owedToMe = rows
    .filter((p) => p.recipient_id === user?.id && p.status !== "confirmed_paid")
    .reduce((s, p) => s + Number(p.amount_eur), 0);

  const weekOf = (id: string) => weeks?.find((w) => w.id === id)?.week_number;
  const name = (id: string) =>
    id === user?.id ? "Me" : (members?.find((m) => m.userId === id)?.name ?? "Athlete");

  const setStatus = async (id: string, status: "marked_paid" | "confirmed_paid" | "unpaid") => {
    setBusy(id);
    await supabase.from("challenge_payments").update({ status }).eq("id", id);
    await qc.invalidateQueries({ queryKey: ["challenge-payments"] });
    setBusy(null);
  };

  return (
    <AppShell>
      <PageHeader title="Payments" subtitle="Penalties are created automatically when a week closes." />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">I owe</p>
          <p className="num mt-1 text-2xl font-semibold text-warn">{eur(iOwe)}</p>
        </Card>
        <Card>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Owed to me</p>
          <p className="num mt-1 text-2xl font-semibold text-good">{eur(owedToMe)}</p>
        </Card>
      </div>

      <div className="mt-4 space-y-2">
        <SectionTitle>Obligations</SectionTitle>
        {rows.length === 0 ? <Note>Nothing outstanding. No week has closed with a miss.</Note> : null}
        {rows.map((p) => {
          const mine = p.payer_id === user?.id;
          return (
            <Card key={p.id} className="p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">
                  {name(p.payer_id)} → {name(p.recipient_id)}
                </p>
                <span className="num text-sm font-semibold">{eur(Number(p.amount_eur))}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Week {weekOf(p.week_id) ?? "?"} ·{" "}
                {p.status === "unpaid"
                  ? "Unpaid"
                  : p.status === "marked_paid"
                    ? "Marked paid, awaiting confirmation"
                    : "Confirmed paid"}
              </p>
              {p.status !== "confirmed_paid" ? (
                <div className="mt-2 flex gap-2">
                  {mine && p.status === "unpaid" ? (
                    <button
                      disabled={busy === p.id}
                      onClick={() => void setStatus(p.id, "marked_paid")}
                      className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground"
                    >
                      Mark as paid
                    </button>
                  ) : null}
                  {mine && p.status === "marked_paid" ? (
                    <button
                      disabled={busy === p.id}
                      onClick={() => void setStatus(p.id, "unpaid")}
                      className="flex-1 rounded-xl border border-border py-2 text-xs font-medium"
                    >
                      Undo
                    </button>
                  ) : null}
                  {!mine && p.status === "marked_paid" ? (
                    <button
                      disabled={busy === p.id}
                      onClick={() => void setStatus(p.id, "confirmed_paid")}
                      className="flex-1 rounded-xl bg-good py-2 text-xs font-semibold text-background"
                    >
                      Confirm received
                    </button>
                  ) : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      <Note>
        Only the payer can mark a payment, only the recipient can confirm it, and confirmed
        payments are final.
      </Note>
    </AppShell>
  );
}
