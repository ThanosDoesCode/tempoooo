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

export function ChallengeStatus({ atRisk, children }: { atRisk: boolean; children: ReactNode }) {
  return (
    <p
      className={`rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed ${atRisk ? "border-warn-soft/20 bg-warn-soft/5 text-warn-soft" : "border-transparent bg-elevated/50 text-muted-foreground"}`}
    >
      {children}
    </p>
  );
}
