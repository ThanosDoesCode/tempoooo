# Why the date is rejected

Nothing is broken. Your challenge is set to start on **Monday 17 Aug 2026**, and you tried to log an activity dated **14 Aug 2026**, which is before week 1 begins. The server rejects any date outside the challenge window, so it answers "That week is closed or the date is invalid".

Two things make this confusing today: the date field lets you pick a date that can never be accepted, and the error does not say why.

## What to change

1. **Guard the date field on the log screen**
   - Set the picker's minimum to the challenge start date and its maximum to the end of the current open week.
   - Default the date to today only when today is inside the window, otherwise default to the challenge start date.

2. **Explain the state instead of failing late**
   - Before the challenge starts, show a clear banner on the log screen: "This challenge starts Monday 17 Aug 2026. You can log activities from that day." and disable Save.
   - Replace the raw server message with a readable one that names the allowed range.

3. **Let the creator move the start date before the challenge begins**
   - On the Challenge dashboard, if you created the challenge and it has not started yet and no activities exist, allow editing the start date (Mondays only).
   - This needs a database rule allowing the creator to update a not-yet-started challenge; there is currently no update rule at all, so the edit would silently fail without it.

## Technical notes

- Files: `src/routes/_authenticated/challenge/log.tsx` (date bounds, pre-start banner, friendlier error), `src/routes/_authenticated/challenge/index.tsx` (start-date editor), `src/lib/challenge.ts` (mutation + window helper).
- Migration: add an UPDATE policy on `public.challenges` for the creator, restricted to challenges whose `start_date` is still in the future and that have no activities, and keep the change limited to `start_date` snapping to a Monday.
- No change to the penalty, week-locking, or finalization logic; all official math stays server-side.
