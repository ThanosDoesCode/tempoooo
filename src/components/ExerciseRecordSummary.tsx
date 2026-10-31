import { exerciseRecordPresentation, type ExerciseRecord } from "@/lib/exercise-records";
import type { ProgressRange } from "@/lib/progress-period";
import { fmt, signed } from "@/lib/calc";

/** One exercise summary, with separate side values whenever collapsing would hide a difference. */
export function ExerciseRecordSummary({
  group,
  range,
  kind = "latest",
}: {
  group: ExerciseRecord;
  range: ProgressRange;
  kind?: "latest" | "best";
}) {
  const model = exerciseRecordPresentation(group, range, kind);
  return (
    <div className="min-w-0 space-y-1.5" data-exercise-summary={group.key}>
      {model.summary ? (
        <p className="num break-words text-lg font-semibold">{model.summary}</p>
      ) : null}
      {!model.summary
        ? model.rows.map((row) => (
            <div
              key={row.record.key}
              className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
            >
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="num min-w-0 break-words text-sm font-semibold">{row.value}</span>
            </div>
          ))
        : null}
      {model.commonComparison ? (
        <p className="text-sm text-muted-foreground">{model.commonComparison}</p>
      ) : (
        model.rows.map((row) =>
          row.comparison ? (
            <p key={row.record.key} className="break-words text-sm text-muted-foreground">
              {model.unilateral && row.label ? `${row.label}: ` : ""}
              {row.comparison}
            </p>
          ) : null,
        )
      )}
      {model.commonEstimate != null ? (
        <p className="num text-xs text-muted-foreground">
          Estimated 1RM {fmt(model.commonEstimate, 1)} kg each side
          {model.commonEstimateChange != null ? ` · ${signed(model.commonEstimateChange, 0)}%` : ""}
        </p>
      ) : (
        model.rows.map((row) =>
          row.estimate != null ? (
            <p key={row.record.key} className="num break-words text-xs text-muted-foreground">
              {model.unilateral && row.label ? `${row.label} estimated 1RM: ` : "Estimated 1RM "}
              {fmt(row.estimate, 1)} kg
              {row.estimateChange != null ? ` · ${signed(row.estimateChange, 0)}%` : ""}
            </p>
          ) : null,
        )
      )}
      {model.unilateral && model.rows.length === 1 ? (
        <p className="text-xs text-muted-foreground">
          {model.rows[0]!.record.side === "left" ? "Right" : "Left"}: No data yet
        </p>
      ) : null}
    </div>
  );
}
