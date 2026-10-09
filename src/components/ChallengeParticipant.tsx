import type { ReactNode } from "react";

/** Presentation only: callers retain their existing totals, targets and pause rules. */
export function ChallengeParticipantHeading({
  label,
  value,
  suffix,
  status,
}: {
  label: string;
  value?: string;
  suffix?: string;
  status?: string | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 break-words text-sm font-medium">{label}</span>
      {status ? (
        <span className="shrink-0 text-sm text-muted-foreground">{status}</span>
      ) : value != null ? (
        <span className="num shrink-0 whitespace-nowrap text-right">
          <span className="text-2xl font-semibold leading-none tracking-tight">{value}</span>
          {suffix ? <span className="ml-1 text-[13px] text-muted-foreground">{suffix}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Calm risk presentation: the consequence and the action that lowers it read as neutral text, with
 * amber reduced to a small dot. Calculations are unchanged — this only restyles the penalty.
 */
export function ChallengeStatus({
  penalty,
}: {
  penalty: { atRisk: boolean; line: string; consequence?: string | null; action?: string | null };
}) {
  if (penalty.atRisk && penalty.consequence) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-elevated/50 px-3 py-2.5">
        <span aria-hidden="true" className="mt-[7px] h-2 w-2 flex-none rounded-full bg-warn-soft" />
        <div className="min-w-0 text-[13px] leading-snug">
          <span className="text-muted-foreground">Current consequence</span>
          <p className="font-semibold text-foreground">{penalty.consequence}</p>
          {penalty.action ? <p className="mt-0.5 text-muted-foreground">{penalty.action}</p> : null}
        </div>
      </div>
    );
  }
  return (
    <p className="rounded-xl bg-elevated/50 px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
      {penalty.line}
    </p>
  );
}
