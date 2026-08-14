# Restore database access for the app

## What I found

Your accounts and your bulk plan are still there. I checked the database directly:

- Both accounts exist: thanosxnt@gmail.com and thanos.xintarakis@gmail.com
- There is 1 bulk plan, owned by thanosxnt@gmail.com, with its targets row
- 2 profile rows exist

The problem is permissions, not missing data. Every table in the app currently has no access granted to the app's signed-in role, so the app reads back nothing and the bulk plan looks like it does not exist. The helper functions the app calls are still granted correctly, so only table access needs repair.

## The fix

One database migration that re-grants Data API access on all 16 app tables:

- Signed-in users: read, create, update and delete on all app tables (row-level security rules still apply on top, so each person only sees their own data)
- Backend/service role: full access
- No access for signed-out visitors, since nothing in this app is public

After that migration, sign in with thanosxnt@gmail.com and the bulk plan opens with Today, Training, Progress and Check-In available.

## Technical notes

Tables to grant: profiles, bulk_profiles, bulk_members, bulk_invitations, bulk_targets, bulk_days, bulk_workouts, bulk_week_notes, bulk_photos, challenges, challenge_members, challenge_invitations, challenge_activities, challenge_weeks, challenge_payments, challenge_activity_audit.

Pattern per table:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
GRANT ALL ON public.<table> TO service_role;
```

No `anon` grants. Existing RLS policies and the immutability triggers on challenge_weeks, challenge_payments and challenge_activity_audit stay untouched, so the append-only and two-step payment guarantees are preserved.

No frontend changes are needed.
