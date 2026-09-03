import { createFileRoute } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { TrainingSession } from "@/components/TrainingSession";
import { iso } from "@/lib/calc";
import { useAuth } from "@/lib/auth";
import { useActions, useAppData, useBulkMeta } from "@/lib/store";

export const Route = createFileRoute("/_authenticated/bulk/training")({
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content: "Log sets, reps and weights with last session's numbers side by side.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content: "Exercise logging with progression status and strength history graphs.",
      },
    ],
  }),
  component: TrainingPage,
});

function TrainingPage() {
  const data = useAppData();
  const { user } = useAuth();
  const { bulkId, role } = useBulkMeta();
  const { saveWorkout, saveTargets } = useActions();
  const today = iso(new Date());
  const [date, setDate] = useState(today);
  return (
    <AppShell>
      <PageHeader title="Training" subtitle={format(parseISO(date), "EEEE, d MMMM")} />
      <label className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        Training date
        <input
          type="date"
          value={date}
          max={today}
          onChange={(event) => {
            if (event.target.value && event.target.value <= today) setDate(event.target.value);
          }}
          className="min-h-11 min-w-0 rounded-xl border border-input bg-elevated px-3 text-base outline-none focus:border-ring"
        />
      </label>
      {data && bulkId && user ? (
        <TrainingSession
          key={`${user.id}:${bulkId}:${date}`}
          data={data}
          date={date}
          cacheKey={`training-draft:${user.id}:${bulkId}:${date}`}
          onSave={(workout) => saveWorkout(workout, user.id)}
          onSaveSetupNote={async (exercise, note) => {
            const notes = { ...(data.targets.exerciseSetupNotes ?? {}) };
            if (note) notes[exercise] = note;
            else delete notes[exercise];
            await saveTargets({ ...data.targets, exerciseSetupNotes: notes });
          }}
          readOnly={role === "viewer"}
        />
      ) : (
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      )}
    </AppShell>
  );
}
