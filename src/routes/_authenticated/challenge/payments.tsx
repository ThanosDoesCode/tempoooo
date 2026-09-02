import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, PendingLabel, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  eur,
  owedText,
  photoText,
  reopenPayment,
  settleMyDebts,
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
          "Outstanding penalties, photo forfeits, settle up and recipient confirmation for your two-person endurance challenge.",
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
  const [pending, setPending] = useState<{
    id: string;
    action: "mark" | "undo" | "confirm" | "settle" | "reopen";
  } | null>(null);
  const [settleArmed, setSettleArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const rows = payments ?? [];
  const open = rows.filter((p) => p.status !== "confirmed_paid");
  const settled = rows.filter((p) => p.status === "confirmed_paid");
  const iOwe = open
    .filter((p) => p.payer_id === user?.id)
    .reduce((s, p) => s + Number(p.amount_eur), 0);
  const owedToMe = open
    .filter((p) => p.recipient_id === user?.id)
    .reduce((s, p) => s + Number(p.amount_eur), 0);

  const weekOf = (id: string) => weeks?.find((w) => w.id === id)?.week_number;
  const name = (id: string) =>
    id === user?.id ? "Me" : (members?.find((m) => m.userId === id)?.name ?? "Athlete");

  const refresh = () => qc.invalidateQueries({ queryKey: ["challenge-payments"] });

  const setStatus = async (id: string, status: "marked_paid" | "confirmed_paid" | "unpaid") => {
    const action =
      status === "marked_paid" ? "mark" : status === "confirmed_paid" ? "confirm" : "undo";
    setPending({ id, action });
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await supabase
        .from("challenge_payments")
        .update({ status })
        .eq("id", id);
      if (e) throw e;
      await refresh();
      setNotice(
        status === "marked_paid"
          ? "Payment marked as paid."
          : status === "confirmed_paid"
            ? "Payment confirmed as received."
            : "Payment returned to unpaid.",
      );
    } catch (e) {
      setError(`Could not update the payment. ${(e as Error).message}`);
    } finally {
      setPending(null);
    }
  };

  const settleUp = async () => {
    if (!challenge || !user) return;
    setPending({ id: "settle", action: "settle" });
    setError(null);
    setNotice(null);
    try {
      await settleMyDebts(challenge.id, user.id);
      await refresh();
      setSettleArmed(false);
      setNotice("Your open payments are settled.");
    } catch (e) {
      setError(`Could not settle your payments. ${(e as Error).message}`);
    } finally {
      setPending(null);
    }
  };

  const reopen = async (id: string) => {
    setPending({ id, action: "reopen" });
    setError(null);
    setNotice(null);
    try {
      await reopenPayment(id);
      await refresh();
      setNotice("Payment reopened.");
    } catch (e) {
      setError(`Could not reopen the payment. ${(e as Error).message}`);
    } finally {
      setPending(null);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Payments"
        subtitle="Penalties are created automatically when a week closes. Every €5 is also 1 photo."
      />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">I owe</p>
          <p className="num mt-1 text-2xl font-semibold text-warn">{eur(iOwe)}</p>
          <p className="text-[11px] text-muted-foreground">
            {photoText(iOwe) ? `+ ${photoText(iOwe)}` : "No photos owed"}
          </p>
        </Card>
        <Card>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Owed to me</p>
          <p className="num mt-1 text-2xl font-semibold text-good">{eur(owedToMe)}</p>
          <p className="text-[11px] text-muted-foreground">
            {photoText(owedToMe) ? `+ ${photoText(owedToMe)}` : "No photos owed"}
          </p>
        </Card>
      </div>

      {iOwe > 0 ? (
        <Card className="mt-3">
          <SectionTitle>Settle up</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Once you have actually sent {owedText(iOwe)}, clear everything you owe in one step. Your
            total goes back to zero and the items move to the settled list.
          </p>
          <button
            disabled={pending !== null}
            onClick={() => {
              if (!settleArmed) {
                setSettleArmed(true);
                return;
              }
              void settleUp();
            }}
            className={`mt-3 w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 ${
              settleArmed ? "bg-good text-background" : "bg-primary text-primary-foreground"
            }`}
          >
            {pending?.id === "settle" ? (
              <PendingLabel>Settling payments…</PendingLabel>
            ) : settleArmed ? (
              `Confirm, I have paid ${owedText(iOwe)}`
            ) : (
              "I have paid, reset my total"
            )}
          </button>
        </Card>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-xs text-good">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        <SectionTitle>Open obligations</SectionTitle>
        {open.length === 0 ? <Note>Nothing outstanding. Everything is settled.</Note> : null}
        {open.map((p) => {
          const mine = p.payer_id === user?.id;
          return (
            <Card key={p.id} className="p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">
                  {name(p.payer_id)} → {name(p.recipient_id)}
                </p>
                <span className="num text-sm font-semibold">{owedText(Number(p.amount_eur))}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Week {weekOf(p.week_id) ?? "?"} ·{" "}
                {p.status === "unpaid" ? "Unpaid" : "Marked paid, awaiting confirmation"}
              </p>
              <div className="mt-2 flex gap-2">
                {mine && p.status === "unpaid" ? (
                  <button
                    disabled={pending !== null}
                    onClick={() => void setStatus(p.id, "marked_paid")}
                    className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {pending?.id === p.id && pending.action === "mark" ? (
                      <PendingLabel>Marking paid…</PendingLabel>
                    ) : (
                      "Mark as paid"
                    )}
                  </button>
                ) : null}
                {mine && p.status === "marked_paid" ? (
                  <button
                    disabled={pending !== null}
                    onClick={() => void setStatus(p.id, "unpaid")}
                    className="flex-1 rounded-xl border border-border py-2 text-xs font-medium disabled:opacity-60"
                  >
                    {pending?.id === p.id && pending.action === "undo" ? (
                      <PendingLabel>Undoing…</PendingLabel>
                    ) : (
                      "Undo"
                    )}
                  </button>
                ) : null}
                {!mine && p.status === "marked_paid" ? (
                  <button
                    disabled={pending !== null}
                    onClick={() => void setStatus(p.id, "confirmed_paid")}
                    className="flex-1 rounded-xl bg-good py-2 text-xs font-semibold text-background disabled:opacity-60"
                  >
                    {pending?.id === p.id && pending.action === "confirm" ? (
                      <PendingLabel>Confirming…</PendingLabel>
                    ) : (
                      "Confirm received"
                    )}
                  </button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      {settled.length ? (
        <div className="mt-4">
          <SectionTitle
            right={
              <button
                onClick={() => setShowSettled((s) => !s)}
                className="text-xs font-medium text-primary"
              >
                {showSettled ? "Hide" : `Show (${settled.length})`}
              </button>
            }
          >
            Settled
          </SectionTitle>
          {showSettled ? (
            <div className="space-y-2">
              {settled.map((p) => (
                <Card key={p.id} className="p-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-medium">
                      {name(p.payer_id)} → {name(p.recipient_id)}
                    </p>
                    <span className="num text-sm text-muted-foreground">
                      {owedText(Number(p.amount_eur))}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-good">
                    Week {weekOf(p.week_id) ?? "?"} · Settled
                  </p>
                  {p.settled_by === user?.id ? (
                    <button
                      disabled={pending !== null}
                      onClick={() => void reopen(p.id)}
                      className="mt-2 w-full rounded-xl border border-border py-2 text-xs font-medium disabled:opacity-60"
                    >
                      {pending?.id === p.id && pending.action === "reopen" ? (
                        <PendingLabel>Reopening…</PendingLabel>
                      ) : (
                        "Reopen, this was a mistake"
                      )}
                    </button>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <Note>
        Only the payer can mark or settle a payment, only the recipient can confirm one they
        received, and a settle can be reopened only by the person who did it.
      </Note>
    </AppShell>
  );
}
