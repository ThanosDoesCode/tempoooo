import type { WeeklyProgressCoachModel } from "@/lib/weekly-progress-coach";

export function WeeklyProgressCoach({ model }: { model: WeeklyProgressCoachModel }) {
  return (
    <div className="mt-3 min-w-0 divide-y divide-border" aria-label="Weekly progress assessment">
      {(
        [
          ["Weight", model.weight],
          ["Training", model.training],
          ["Nutrition", model.nutrition],
          ["Next week", model.action],
        ] as const
      ).map(([label, row]) => (
        <section key={label} aria-label={label} className="min-w-0 py-3 first:pt-0 last:pb-0">
          <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
          <p
            className={`mt-1 break-words text-sm font-semibold ${label === "Next week" ? "text-primary" : ""}`}
          >
            {row.value}
          </p>
          <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
            {row.detail}
          </p>
        </section>
      ))}
    </div>
  );
}
