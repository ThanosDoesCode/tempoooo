# Training metrics and session data

Training additions stay inside the existing `bulk_workouts.payload` JSON document. No database migration is required. Old payloads remain readable because every new field is optional.

## Completion and history

New sessions autosave with `status: "draft"`. The explicit **Complete workout** action writes `status: "completed"`, `completedAt`, and the automatic `durationSeconds`. Weekly, monthly, and all-time completed-workout totals include only server-confirmed completed payloads with at least one working set. A failed completion remains a draft.

Historical payloads without `status` remain in exercise history and can provide volume when their original displayed load and reps are unambiguous. They are excluded from completed-workout counts because the old autosave behavior did not prove that a session was finished. Historical Pull-Up or Chin-Up entries without a bodyweight snapshot do not get a guessed bodyweight, effective load, volume, or load comparison. Opening the old training date lets the user confirm the workout or edit notes.

## Bodyweight load and progression

Pull-Ups and Chin-Ups use the latest valid positive bodyweight whose log date is on or before the selected training date. That value is copied into the exercise entry when a new session is created. It can be manually overridden and never changes when later daily weights change.

The load model is:

`effective load = session bodyweight + added weight - assistance`

Added weight defaults to zero. `assistance` is an optional payload field and already reduces effective load, but the current UI does not expose it.

Comparisons require a known effective load and the same number of working sets. The existing same-load thresholds remain: +2 total reps is progressed, −3 total reps is regressed, and values between them are the same. At a higher effective load, the session progresses when every set maintains reps, or when every set remains at or above the exercise target minimum and loses no more than two reps versus its matching prior set. That second case shows the existing rebuild-reps hint. A larger rep loss at a higher load is regressed. A lower effective load is regressed. Volume never determines the verdict.

Weight, rep, and volume PR chips keep their prior behavior, using effective load for Pull-Ups and Chin-Ups. The explanation below the verdict states the load and total-rep differences.

## Volume and best set

Only positive whole-number reps count as working sets.

- Standard, machine, and cable exercise: `displayed load × total working reps`
- Incline Dumbbell Press and Incline Dumbbell Curls: `one-dumbbell load × 2 × total working reps`
- Pull-Ups and Chin-Ups: `effective load × total working reps`

No multiplier is inferred for Romanian Deadlifts, Lateral Raises, or other ambiguous exercises. If a working exercise has no trustworthy load, its volume and the containing workout/period volume are unavailable instead of presenting a partial value as a total.

Best Set uses actual sets from non-draft sessions in the prior 90 calendar days. It first keeps sets whose reps are comparable: at or above the target minimum and within two reps of the best recent target-range performance. It then chooses higher load, followed by higher reps and the more recent date. It does not calculate an estimated one-rep max.

## Notes, duration, and numeric input

Exercise notes preserve the old `notes` text and add optional `noteTags` and `rpe`. The session-level `sessionNote` stays separate. A Pain/discomfort tag is highlighted in history and has no blocking or advisory behavior.

Automatic duration starts when the first positive integer working set is committed. ISO timestamps survive reloads and backgrounding. Completion freezes automatic duration; `durationOverrideSeconds` stores an optional manual correction separately. Legacy duration is left blank.

The shared decimal parser trims whitespace, changes commas to periods only on blur/save, accepts a strict finite decimal form, and returns a distinct empty/invalid/value result. It rejects partial parses, exponents, hexadecimal, NaN, and Infinity. Inputs keep their raw string while focused so values such as `61,` are not rewritten mid-entry. Bulk numeric inputs and Challenge distance/duration/target fields store only validated numeric values.

## Limits

- There is no configured weekly workout goal, so the UI shows the actual completed count without inventing a `/ 5` target.
- Assistance is modeled but does not yet have a visible input.
- Duration uses the device clock; manual correction covers clock changes or missed start/stop times.
- Completed totals intentionally start with workouts explicitly confirmed after this update unless an older date is opened and confirmed.
