import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { userFacingError } from "@/lib/network-errors";
import {
  cancelChallengeException,
  manualResolutionMessage,
  requestChallengeException,
  reviewChallengeException,
  useChallengeAdjustments,
  type AdjustmentKind,
} from "@/lib/challenge-adjustments";

/**
 * Sick / late-completion request + counterparty review for one challenge week. The caller decides
 * eligibility (sick = current week for the subject; late_completion = a finalized missed week they own)
 * and passes the opponent's name. No optimistic state: the UI only changes after the server confirms.
 */
export function ChallengeWeekExceptions({
  challengeId,
  week,
  kind,
  userId,
  opponentName,
  eligible,
}: {
  challengeId: string;
  week: number;
  kind: AdjustmentKind;
  userId: string;
  opponentName: string;
  eligible: boolean;
}) {
  const qc = useQueryClient();
  const adjustments = useChallengeAdjustments(challengeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const requestId = useRef<string | null>(null); // stable across retries; cleared on success

  const rows = adjustments.data ?? [];
  const forHere = (predicate: (a: (typeof rows)[number]) => boolean) =>
    rows.find((a) => a.week_number === week && a.kind === kind && predicate(a));
  const mine = forHere((a) => a.user_id === userId && a.status === "pending");
  const opponentPending = forHere((a) => a.user_id !== userId && a.status === "pending");
  const approved = !!forHere((a) => a.status === "approved");

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["challenge-adjustments", challengeId] }),
      qc.invalidateQueries({ queryKey: ["challenge-weeks", challengeId] }),
      qc.invalidateQueries({ queryKey: ["challenge-payments", challengeId] }),
    ]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      await requestChallengeException(
        challengeId,
        week,
        kind,
        note.trim() || null,
        requestId.current,
      );
      requestId.current = null;
      setOpen(false);
      setNote("");
      await refresh();
      setMessage(
        kind === "sick"
          ? `Sick request sent. Waiting for ${opponentName} to approve.`
          : `Completion submitted. Waiting for ${opponentName} to confirm.`,
      );
    } catch (e) {
      setError(
        userFacingError(
          e,
          kind === "sick" ? "send your sick request" : "submit your late completion",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancelChallengeException(id);
      await refresh();
      setMessage("Request cancelled.");
    } catch (e) {
      setError(userFacingError(e, "cancel your request"));
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, approve: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await reviewChallengeException(id, approve);
      await refresh();
      setMessage(
        approve
          ? (manualResolutionMessage(result) ?? "Result corrected.")
          : "Request rejected. The original obligation stays.",
      );
    } catch (e) {
      setError(userFacingError(e, "review this request"));
    } finally {
      setBusy(false);
    }
  }

  const feedback = (
    <>
      {message ? <p className="mt-2 text-[13px] text-muted-foreground">{message}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </>
  );

  // Opponent has a pending request here: show the review card.
  if (opponentPending) {
    return (
      <div className="rounded-[14px] border border-border bg-elevated/50 p-3">
        <p className="text-[13px] font-medium">
          {kind === "sick"
            ? `${opponentName} requested a sick week`
            : `${opponentName} submitted a late completion for Week ${week}`}
        </p>
        {opponentPending.note ? (
          <p className="mt-1 break-words text-[13px] text-muted-foreground">
            {opponentPending.note}
          </p>
        ) : null}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void review(opponentPending.id, false)}
            className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-muted-foreground disabled:opacity-60"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void review(opponentPending.id, true)}
            className="min-h-11 rounded-[14px] bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {kind === "sick" ? "Approve" : "Confirm completion"}
          </button>
        </div>
        {feedback}
      </div>
    );
  }

  // My request is pending: awaiting the opponent, with a cancel.
  if (mine) {
    return (
      <div className="rounded-[14px] border border-border bg-elevated/50 p-3">
        <p className="text-[13px] font-medium">
          {kind === "sick" ? "Sick request pending" : "Late completion pending"}
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Waiting for {opponentName} to {kind === "sick" ? "approve" : "confirm"}.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void cancel(mine.id)}
          className="mt-2 min-h-11 rounded-lg px-3 text-[13px] font-medium text-muted-foreground disabled:opacity-60"
        >
          Cancel request
        </button>
        {feedback}
      </div>
    );
  }

  const hasFeedback = !!message || !!error;
  // Approved (label is shown on the week itself) or not eligible: only surface lingering feedback.
  if (approved || !eligible) return hasFeedback ? <div>{feedback}</div> : null;

  // Eligible and nothing pending/approved: offer the request.
  return (
    <div>
      <Dialog.Root open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="min-h-11 rounded-[14px] bg-elevated px-4 text-[13px] font-medium disabled:opacity-60"
          >
            {kind === "sick" ? "Sick this week" : "Submit late completion"}
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-border bg-card p-5">
            <Dialog.Title className="text-xl font-semibold">
              {kind === "sick" ? "Request a sick week" : "Submit late completion"}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-[13px] leading-6 text-muted-foreground">
              {kind === "sick"
                ? `${opponentName} must approve before this week is excused. Nothing changes until they do.`
                : `${opponentName} must confirm. Evidence upload isn't available yet — add a note describing your activity.`}
            </Dialog.Description>
            <label className="mt-3 block text-[13px] text-muted-foreground">
              Note (optional)
              <textarea
                className="mt-1 min-h-20 w-full rounded-xl border border-input bg-elevated px-3 py-2 text-base text-foreground outline-none focus:border-ring"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 rounded-xl border border-input text-sm font-medium disabled:opacity-60"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="min-h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Sending…" : kind === "sick" ? "Request" : "Submit"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {feedback}
    </div>
  );
}
