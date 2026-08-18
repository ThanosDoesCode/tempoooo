# Flexible weekly targets, photo forfeits, and settling up

Three changes to the challenge: per-week km targets you can lower for a busy week, a photo forfeit shown alongside every euro amount, and a way to clear what is owed once it has actually been paid.

## 1. Change the km target for a specific week

- The challenge creator can set a custom target for any week that has not started yet (this week and past weeks stay locked, so nobody can lower a target after seeing the numbers).
- New "Weekly targets" screen in the Challenge section: a list of upcoming weeks with their dates and current target, each editable. Setting a week back to the default removes the override.
- You can apply one target to a range of weeks at once, so a busy month is a single action.
- The dashboard, the log screen and the progress bar all use the target of the week they are showing, instead of the fixed 15 km.
- Penalties follow the week's target proportionally: full target met is 0 euro, then 1/3 short is 5 euro, 2/3 short is 10 euro, below that 15 euro. With the default 15 km target this is exactly today's tiers (15 / 10 / 5 km).

## 2. Photo forfeit

- Rule: one photo per 5 euro owed. 5 euro = 1 photo, 10 euro = 2 photos, 15 euro = 3 photos.
- Stated as text everywhere an amount appears: this week's live penalty, the weekly history rows, each payment obligation, and the two totals at the top of the Payments screen ("I owe 10 euro and 2 photos").
- Added to the Rules card so the forfeit is part of the stated rules.
- No photo upload, tracking or confirmation, as agreed.

## 3. Settle up and reset

- Payments screen gets a "Settle up" action per direction: when you have paid your friend what you owe, one tap marks every outstanding obligation of yours as settled and drops your total to 0. The same works for them.
- Settled obligations move into a collapsed "Settled" history section, so the record is kept but the main list only shows what is still open.
- A settle can be undone by the person who did it while the other has not acted on it, in case of a mistake.

## Technical notes

- Migration:
  - New table `public.challenge_week_targets` (challenge_id, week_number, target_km, set_by, timestamps; unique per challenge+week) with GRANTs, RLS: members can read; only the challenge creator can insert/update/delete, and a trigger rejects writes for a week whose start date is not in the future for the challenge timezone.
  - New DB function `penalty_for(_km numeric, _target numeric)` implementing the proportional tiers; the existing single-argument `penalty_for` stays for compatibility.
  - `finalize_challenge` reads the week override (falling back to `challenges.weekly_target_km`) and stores it in `challenge_weeks.target_km`, then uses the two-argument penalty function.
  - Payments: allow the transition to `confirmed_paid` initiated by the payer via a settle path, and allow a reversal from `confirmed_paid` back to `unpaid` by the same actor when the counterpart has not yet acted. Implemented in `guard_payment()` plus a `settled_by` column, keeping the existing "only the recipient confirms" flow intact.
- Frontend: `src/lib/challenge.ts` gains `useWeekTargets`, `targetForWeek`, an updated `penaltyFor(km, target)` mirror and a `photosFor(euros)` helper; `src/routes/_authenticated/challenge/index.tsx`, `log.tsx`, `history.tsx`, `payments.tsx` and `src/components/challenge-rules.tsx` consume them; new route `src/routes/_authenticated/challenge/targets.tsx`.
- All official math stays server-side; the client values are display mirrors only.
