# Calorie migration equivalence

The integration preserves both migration representations:

- `supabase/migrations/20261122120000_calorie_recommendation_local_day.sql`
- `drizzle/migrations/0010_calorie_recommendation_local_day.sql`

They are byte-for-byte identical. Each has SHA-256:

`41dc8d0ef0fadeea935c4b44a627c364bed183a7ff6281ad0076763ec95ae9f7`

Both add the same required-timezone overload of
`public.apply_bulk_calorie_recommendation(numeric, numeric, text)` and preserve
its existing two-argument compatibility overload. They are representations of
one database change, not two changes to apply sequentially.

The user confirms this change is already applied in Lovable production. This
integration did not connect to production or independently inspect its catalog.
Do not replay either file against that environment. Keep Drizzle's `0010` journal
entry and snapshot unchanged; do not alter either migration ledger as part of
this integration. Future deployment tooling must account for the existing
application before attempting to run either migration representation.
