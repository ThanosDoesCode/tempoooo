import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, DataError, Note, PendingLabel } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { userFacingError } from "@/lib/network-errors";
import {
  owedText,
  reopenPayment,
  useChallengeMembers,
  useMyChallenge,
  usePayments,
  useWeeks,
  type Challenge,
  type PaymentRow,
  type WeekRow,
} from "@/lib/challenge";

export const Route = createFileRoute("/_authenticated/challenge/money")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "What you owe and are owed in your challenge, and how to settle up.",
      },
      { property: "og:title", content: "Tempo" },
      { property: "og:description", content: "Owe, pay, confirm. Nothing is deleted." },
    ],
  }),
  component: Money,
});

function Money() {
  const challengeQuery = useMyChallenge();
  const { data: challenge, isLoading, error } = challengeQuery;

  return (
    <AppShell>
      <PageHeader title="Money" backTo="/challenge" backLabel="This week" />
      {isLoading ? (
        <div className="space-y-3" aria-label="Loading money">
          <div className="h-24 animate-pulse rounded-[20px] bg-card" />
          <div className="h-40 animate-pulse rounded-[20px] bg-card" />
        </div>
      ) : error ? (
        <DataError
          message="No payment data was changed. Check your connection and try again."
          onRetry={() => void challengeQuery.refetch()}
        />
      ) : !challenge ? (
        <Note>Join or create a challenge before penalties can appear.</Note>
      ) : challenge.penalty_mode === "money" ? (
        <MoneyContent challenge={challenge} />
      ) : (
        <CustomConsequences challenge={challenge} />
      )}
    </AppShell>
  );
}

function MoneyContent({ challenge }: { challenge: Challenge }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const membersQuery = useChallengeMembers(challenge.id);
  const paymentsQuery = usePayments(challenge.id);
  const weeksQuery = useWeeks(challenge.id);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = paymentsQuery.data ?? [];
  const open = rows.filter((p) => p.status !== "confirmed_paid");
  const settled = rows.filter((p) => p.status === "confirmed_paid");
  const iOwe = open
    .filter((p) => p.payer_id === user?.id)
    .reduce((s, p) => s + Number(p.amount_eur), 0);
  const owedToMe = open
    .filter((p) => p.recipient_id === user?.id)
    .reduce((s, p) => s + Number(p.amount_eur), 0);

  const opponent = membersQuery.data?.find((m) => m.userId !== user?.id);
  const name = (id: string) =>
    id === user?.id ? "You" : (membersQuery.data?.find((m) => m.userId === id)?.name ?? "Athlete");
  const weekFor = (id: string) => weeksQuery.data?.find((w) => w.id === id);

  const setStatus = async (id: string, status: PaymentRow["status"]) => {
    setPending(id);
    setError(null);
    try {
      const { error: e } = await supabase
        .from("challenge_payments")
        .update({ status })
        .eq("id", id);
      if (e) throw e;
      await qc.invalidateQueries({ queryKey: ["challenge-payments"] });
    } catch (e) {
      setError(userFacingError(e, "update the payment"));
    } finally {
      setPending(null);
    }
  };

  const reopen = async (id: string) => {
    setPending(id);
    setError(null);
    try {
      await reopenPayment(id);
      await qc.invalidateQueries({ queryKey: ["challenge-payments"] });
    } catch (e) {
      setError(userFacingError(e, "reopen the payment"));
    } finally {
      setPending(null);
    }
  };

  const loading = membersQuery.isLoading || paymentsQuery.isLoading || weeksQuery.isLoading;

  return (
    <div className="space-y-3.5">
      <Card className="grid grid-cols-2 gap-3 p-[18px]">
        <div>
          <p className="text-[13px] text-muted-foreground">You owe</p>
          <p className={`num mt-1 text-3xl font-semibold ${iOwe > 0 ? "text-warn" : ""}`}>
            {owedText(iOwe, challenge.legacy_photo_owed)}
          </p>
        </div>
        <div>
          <p className="text-[13px] text-muted-foreground">
            {opponent ? `${opponent.name} owes you` : "Owed to you"}
          </p>
          <p className="num mt-1 text-3xl font-semibold">
            {owedText(owedToMe, challenge.legacy_photo_owed)}
          </p>
        </div>
      </Card>

      {loading ? <div className="h-32 animate-pulse rounded-[20px] bg-card" /> : null}

      {!loading && open.length === 0 && settled.length === 0 ? (
        <Card className="px-[18px] py-7 text-center">
          <p className="text-base font-medium">You’re all square</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Penalties show up here after Sunday closes.
          </p>
        </Card>
      ) : null}

      {open.length ? (
        <div>
          <p className="mx-1 mb-1.5 text-[13px] font-medium text-muted-foreground">Open</p>
          <div className="rounded-[20px] bg-card px-4">
            {open.map((p) => (
              <PaymentItem
                key={p.id}
                payment={p}
                week={weekFor(p.week_id)}
                mine={p.payer_id === user?.id}
                name={name}
                legacyPhotoOwed={challenge.legacy_photo_owed}
                pending={pending === p.id}
                busy={pending !== null}
                onMarkPaid={() => void setStatus(p.id, "marked_paid")}
                onUndo={() => void setStatus(p.id, "unpaid")}
                onConfirm={() => void setStatus(p.id, "confirmed_paid")}
              />
            ))}
          </div>
        </div>
      ) : null}

      {settled.length ? (
        <div>
          <p className="mx-1 mb-1.5 text-[13px] font-medium text-muted-foreground">Settled</p>
          <div className="rounded-[20px] bg-card px-4">
            {settled.map((p) => {
              const week = weekFor(p.week_id);
              return (
                <div
                  key={p.id}
                  className="flex min-h-16 items-center gap-3 border-t border-border first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium text-muted-foreground">
                      {name(p.payer_id)} paid {name(p.recipient_id)}{" "}
                      {owedText(Number(p.amount_eur), challenge.legacy_photo_owed)}
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {week ? `Week ${week.week_number} · ` : ""}settled
                    </p>
                  </div>
                  {p.settled_by === user?.id ? (
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void reopen(p.id)}
                      className="min-h-11 rounded-lg bg-elevated px-3 text-[13px] font-medium disabled:opacity-60"
                    >
                      {pending === p.id ? <PendingLabel>…</PendingLabel> : "Reopen"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <Card className="space-y-3.5 p-[18px]">
        <p className="text-[13px] font-medium text-muted-foreground">How settling works</p>
        <Step n={1}>Sunday locks the week and works out who owes what.</Step>
        <Step n={2}>The payer pays outside the app and taps “I paid”.</Step>
        <Step n={3}>The other person taps “Got it” to close it.</Step>
      </Card>

      <Note>
        Only the payer can mark a payment, only the recipient can confirm one they received, and a
        settle can be reopened only by the person who did it.
      </Note>
    </div>
  );
}

function PaymentItem({
  payment,
  week,
  mine,
  name,
  legacyPhotoOwed,
  pending,
  busy,
  onMarkPaid,
  onUndo,
  onConfirm,
}: {
  payment: PaymentRow;
  week: WeekRow | undefined;
  mine: boolean;
  name: (id: string) => string;
  legacyPhotoOwed: boolean;
  pending: boolean;
  busy: boolean;
  onMarkPaid: () => void;
  onUndo: () => void;
  onConfirm: () => void;
}) {
  const amount = owedText(Number(payment.amount_eur), legacyPhotoOwed);
  const title = mine
    ? `You owe ${name(payment.recipient_id)} ${amount}`
    : `${name(payment.payer_id)} owes you ${amount}`;
  const detail = week
    ? `Week ${week.week_number} · ${name(week.user_id)} did ${Number(week.equivalent_km).toFixed(1)} km`
    : "";

  return (
    <div className="flex min-h-16 items-center gap-3 border-t border-border first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">{title}</p>
        {detail ? <p className="mt-0.5 text-[13px] text-muted-foreground">{detail}</p> : null}
      </div>
      {mine && payment.status === "unpaid" ? (
        <button
          type="button"
          disabled={busy}
          onClick={onMarkPaid}
          className="min-h-11 rounded-[20px] bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? <PendingLabel>…</PendingLabel> : "I paid"}
        </button>
      ) : null}
      {mine && payment.status === "marked_paid" ? (
        <button
          type="button"
          disabled={busy}
          onClick={onUndo}
          className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-muted-foreground disabled:opacity-60"
        >
          {pending ? <PendingLabel>…</PendingLabel> : "Waiting · undo"}
        </button>
      ) : null}
      {!mine && payment.status === "unpaid" ? (
        <span className="text-[13px] text-muted-foreground">
          Waiting for {name(payment.payer_id)}
        </span>
      ) : null}
      {!mine && payment.status === "marked_paid" ? (
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="min-h-11 rounded-[20px] bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? <PendingLabel>…</PendingLabel> : "Got it"}
        </button>
      ) : null}
    </div>
  );
}

function CustomConsequences({ challenge }: { challenge: Challenge }) {
  const { user } = useAuth();
  const membersQuery = useChallengeMembers(challenge.id);
  const weeksQuery = useWeeks(challenge.id);
  const consequences = (weeksQuery.data ?? []).filter(
    (week) => week.penalty_mode === "custom" && week.penalty_consequence,
  );
  const name = (id: string) =>
    id === user?.id ? "You" : (membersQuery.data?.find((m) => m.userId === id)?.name ?? "Athlete");

  return (
    <div className="space-y-3.5">
      <p className="text-sm text-muted-foreground">
        This challenge uses custom consequences. They are recorded when a week closes.
      </p>
      {weeksQuery.isLoading ? (
        <div className="h-32 animate-pulse rounded-[20px] bg-card" />
      ) : consequences.length ? (
        <div className="rounded-[20px] bg-card px-4">
          {consequences.map((week) => (
            <div key={week.id} className="min-h-16 border-t border-border py-3 first:border-t-0">
              <p className="text-[15px] font-medium">
                Week {week.week_number} · {name(week.user_id)}
              </p>
              <p className="mt-0.5 text-[13px] text-warn">{week.penalty_consequence}</p>
            </div>
          ))}
        </div>
      ) : (
        <Card className="px-[18px] py-7 text-center">
          <p className="text-base font-medium">You’re all square</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Consequences show up here after a week closes below target.
          </p>
        </Card>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-[15px] leading-snug">
      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-elevated text-[13px] font-semibold">
        {n}
      </span>
      <span>{children}</span>
    </div>
  );
}
