/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TrainingSession } from "../../src/components/TrainingSession";
import { TrainingSummary } from "../../src/components/TrainingSummary";
import { DEFAULT_DATA, type AppData, type Workout } from "../../src/lib/types";
import "../../src/styles.css";
const base: AppData = {
  ...structuredClone(DEFAULT_DATA),
  days: { "2026-08-30": { date: "2026-08-30", weight: 65 } },
  workouts: {
    "2026-08-20": {
      date: "2026-08-20",
      type: "Chest & Back",
      entries: [
        {
          exercise: "Pull-Ups",
          bodyweight: 62,
          addedWeight: 0,
          reps: [10, 8, 7],
          notes: "Original multiline\nnote",
          noteTags: ["Pain/discomfort"],
        },
        { exercise: "Incline Dumbbell Press", weight: 16, reps: [10, 9, 8] },
      ],
      status: "completed",
      durationSeconds: 3000,
    },
    "2026-08-10": {
      date: "2026-08-10",
      type: "Chest & Back",
      entries: [{ exercise: "Pull-Ups", weight: 0, reps: [8, 7, 6], notes: "Legacy note" }],
    },
  },
};
function Fixture() {
  const [data, setData] = useState<AppData>(
    () => JSON.parse(localStorage.getItem("training-qa-data") ?? "null") ?? base,
  );
  const [date, setDate] = useState("2026-08-31");
  const [fail, setFail] = useState(false);
  const save = async (workout: Workout) => {
    if (fail) throw new Error("Simulated save failure");
    setData((current) => {
      const next = { ...current, workouts: { ...current.workouts, [workout.date]: workout } };
      localStorage.setItem("training-qa-data", JSON.stringify(next));
      return next;
    });
  };
  return (
    <main style={{ maxWidth: 512, margin: "0 auto", padding: "16px 16px 120px" }}>
      <h1>Training · local QA</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "12px 0" }}>
        <label>
          Training date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />
          Simulate save failure
        </label>
      </div>
      <TrainingSession
        key={date}
        data={data}
        date={date}
        cacheKey={`training-qa-draft:${date}`}
        onSave={save}
      />
      <TrainingSummary data={data} on={new Date(2026, 7, 31)} />
      <details>
        <summary>Saved payload (test data)</summary>
        <output style={{ display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(data.workouts[date], null, 2)}
        </output>
      </details>
    </main>
  );
}
const fixtureWindow = window as typeof window & { trainingQaRoot?: Root };
fixtureWindow.trainingQaRoot ??= createRoot(document.getElementById("root")!);
fixtureWindow.trainingQaRoot.render(<Fixture />);
