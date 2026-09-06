import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, DataError, SectionTitle } from "@/components/ui-kit";
import { muscleLabel, type BulkMuscleCoverageResult } from "@/lib/bulk-muscle-coverage";
import { userFacingError } from "@/lib/network-errors";

const statusLabel = {
  not_trained: "Not trained",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
} as const;

export function BulkMuscleCoverage({
  result,
  loading,
  error,
  onRetry,
}: {
  result: BulkMuscleCoverageResult | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <SectionTitle>Muscle Coverage</SectionTitle>
      <p className="text-xs text-muted-foreground">
        Estimated from your current plan. Direct sets count fully and indirect sets count half.
      </p>
      {loading ? (
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-elevated" />
      ) : error ? (
        <div className="mt-3">
          <DataError
            message={userFacingError(error, "analyze muscle coverage")}
            onRetry={onRetry}
          />
        </div>
      ) : result ? (
        <>
          <div className="mt-3 rounded-xl bg-elevated p-3">
            <p className="font-semibold">{result.summary.headline}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {result.summary.trainedMuscleCount} of 19 detailed muscle groups receive plan work.
            </p>
            {result.dataStatus === "incomplete_metadata" ? (
              <p className="mt-2 text-xs text-warn">
                Some custom or unavailable exercise metadata could not be analyzed.
              </p>
            ) : null}
          </div>
          {result.advisories.length ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Needs attention
              </p>
              {result.advisories.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-lg border border-border px-3 py-2">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No clear major coverage gaps were found.
            </p>
          )}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring"
          >
            {expanded ? "Hide detailed coverage" : "Show detailed coverage"}
            <ChevronDown
              className={`size-4 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
            />
          </button>
          {expanded ? (
            <div className="mt-2 divide-y divide-border">
              {result.muscles.map((row) => (
                <div key={row.muscle} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{muscleLabel(row.muscle)}</p>
                    <p className="text-xs font-semibold">{statusLabel[row.status]}</p>
                  </div>
                  <p className="num mt-1 text-xs text-muted-foreground">
                    {row.primarySets} direct · {row.secondarySets} indirect · {row.effectiveSets}{" "}
                    effective
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Across {row.dayCount} workout day{row.dayCount === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Add exercises to analyze this plan.</p>
      )}
    </Card>
  );
}
