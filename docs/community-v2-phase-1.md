# Community V2 Phase 1: privacy foundation

This is an unshipped, additive backend foundation. No UI, event publisher, source trigger,
historical feed backfill, notification integration, PR sharing or streak sharing is included.
Plans remains Coming soon. No database outside isolated PGlite tests was accessed.

## Schema and deployment assumptions

The local migration is `supabase/migrations/20261127120000_community_v2_privacy_foundation.sql`.
It depends on the existing Community graph/helpers, profiles, Challenge activities and normalized
workout sessions. The local tests apply the complete Supabase migration sequence before exercising
the new contracts. Existing source-table policies are compared before/after and remain identical.

This does **not** verify production catalog parity. Earlier live catalog exports concerned push
registration/preferences, not all of these objects. Before any separately authorized deployment,
verify their live signatures, columns, owners, grants and policies, and check for new-object name
collisions. The repository contains two migration representations; Community notification migration
`20261024120000` and Drizzle `0009` are identical. Do not run both migration histories against the
same database or assume that the production migration ledger includes manually applied changes.
No Drizzle journal/snapshot or generated live Supabase types are changed by this proposal.

Apply this migration once, transactionally, only after review and a live-baseline check. Its CREATE
statements deliberately fail on collisions rather than silently accepting an incompatible object.
It inserts no events, reactions, acceptance timestamps or other historical data. The new index is
a normal transactional CREATE INDEX and can block activity writes while being built; review table
size and maintenance timing before deployment. Concurrent index deployment, if needed, must be a
separate reviewed procedure rather than replaying this transaction.

## Identity and authorization

All public contracts derive the viewer from `auth.uid()`; none accepts a viewer/actor identity.
Anonymous execution is revoked, and null-auth calls fail even under an otherwise privileged role.
The private audience helper includes self and accepted friends, excluding both block directions.
Every read recomputes authorization, including reads by a known event ID and later cursor pages.
Friend removal/blocking therefore revokes subsequent Community reads regardless of known IDs.
Separate existing Challenge membership permissions are neither broadened nor removed.

Private event/reaction tables have RLS, no authenticated direct table grants and no anonymous grants.
Only service-role maintenance can populate the event index; there is no client publication RPC.
Event visibility policies independently enforce the same rules if table SELECT is later granted.
Reaction RLS exposes only the caller's own reaction on a currently accessible event. Public RPCs
are SECURITY DEFINER with an empty search_path and explicit authenticated/service_role grants.
Internal audience/calendar helpers and the private detail view are not client-readable/executable.

Revocation follows PostgreSQL statement-snapshot semantics: statements beginning after the removal
commits see the changed relationship. Data already returned cannot be recalled, and a read already
in flight is not cancelled by a database policy change. Client cache cancellation, identity fencing
and cross-device invalidation remain work for the UI phase; these backend changes do not claim to
erase cached data. Tests change auth subjects on the same connection to verify account isolation.

## Leaderboard contract

`community_weekly_leaderboard(_activity_type, _timezone, _after_distance?, _after_user?, _limit=20)`

- `_activity_type` is `run` or `ride` (mapped internally to the existing `cycle` enum).
- The server derives the current Monday/Sunday dates from statement time and a validated IANA zone.
- Actual `distance_km` is summed across the audience's Challenge activity rows. Qualification and
  Challenge-equivalent conversion do not participate. Date bounds exclude future logged dates.
- This is a **recorded-calendar-date** week, matching the available activity_date contract. It is
  not an invented UTC occurrence interval. No client clock or client-supplied viewer is accepted.
- The response contains `activity_type`, `timezone`, `week_start`, `week_end`, `participants`,
  `rows`, `self` and `next_cursor`. Rows contain only user ID, nullable username, raw distance,
  competition rank and stable presentation position.
- Equal totals share competition rank (`1,1,3`); UUID ascending breaks presentation ties only.
  Zero-distance audience members remain included. Self is returned independently of the page,
  even while the public profile is not yet initialized.
- Self's `distance_to_next_rank_km` exceeds the nearest strictly higher total by 0.01 km; null
  means no higher total. `distance_to_break_tie_km` is 0.01 when tied, otherwise null. These are
  distinct so a joint leader is not told there is a higher-ranked participant.
- Cursor order is distance descending, UUID ascending. Limits are 1–50 with bounded lookahead.
  These are stateless live pages: activity changes can move ranks while browsing; refresh rather
  than treating the cursor as an immutable leaderboard snapshot.

The leaderboard intentionally shares the accepted audience's entire current-week totals. Feed
acceptance-time restrictions are separate and are not silently applied to leaderboard totals.

## Acceptance timestamp and deferred Run/Ride feed capture

The existing transition RPC assigns `responded_at=now()` on acceptance under the pair lock.
An acceptance retry does not replace it. A new pending lifecycle clears it; the next successful
acceptance assigns a new timestamp. Removal/blocking overwrites it but also revokes accepted state.
For a **currently accepted** relationship, a non-null responded_at is therefore the repository's
server-authoritative current-lifecycle acceptance timestamp. Do not use updated_at or created_at
as a substitute. Legacy accepted rows with null responded_at fail closed for feed access; the
migration does not guess or repair them. Production provenance still requires catalog/data review.

Challenge activities have an activity_date and a logging created_at, but no exact activity
occurrence timestamp/timezone. A same-day run might have occurred before acceptance; a newly logged
activity may be backdated. created_at cannot prove the intended occurrence policy. **Run/Ride feed
indexing/publication is stopped for review**, not approximated using logging time.

Smallest next alternatives, neither implemented here:

1. Approve a conservative date-only policy that excludes ambiguous acceptance-day activities and
   explicitly defines which calendar timezone is used.
2. Approve a separate schema/write-contract change recording a validated occurrence instant and
   timezone for new activities. Unknown historical instants must remain unknown.

There are no Run/Ride event columns, RPC publishers, placeholder events or notification kinds
pretending that this prerequisite is solved. PRs and composite streaks remain deferred as approved.

## Future workout feed and flame scaffold

`private.community_activity_events` contains only a UUID event ID, a unique FK to a normalized
workout session and a server-default publication timestamp. No workout payload is copied. Source
deletion cascades the event and its reactions. Additional source kinds require a reviewed extension.
There is deliberately no automatic publisher yet, so completing a workout does not change the
current product or publish pre-existing history. Tests alone seed events as privileged fixtures.

The internal projection requires a completed session, finite ordered start/end timestamps and
completion no later than publication. For friends, both the workout start and completion, and the
publication time, must be on/after current acceptance. This conservative policy excludes workouts
already underway at acceptance. Self can read their own valid indexed events. Unknown acceptance
fails closed. Re-friending does not restore events from a previous acceptance lifecycle.

`get_community_activity_event(_event)` returns zero rows for an inaccessible/missing event.
`list_community_activity_events(_before_published_at?, _before_id?, _limit=20)` returns `events`
and a nullable cursor; order is publication timestamp descending, UUID descending. Authorization
is applied before the page limit; lookahead is bounded and reaction aggregation is set-based for
the page. The exact response allowlist is:

`id, actor_user_id, username, event_type, activity_date, occurred_at, published_at,
duration_seconds, flame_count, has_flame`

event_type is currently only `workout`. No plan/workout names, source IDs, bodyweight, exercise/set
data, RPE, private notes, nutrition, money, evidence, email or display names are exposed.

`private.community_flames` has only `(event_id,user_id)` as its primary key, with cascading FKs.
`set_community_flame(_event,_enabled)` uses the authenticated caller and desired boolean state;
insert/delete retries are idempotent. It takes the existing pair lock used by removal/blocking,
then rechecks event access before writing. No caller can write another user's flame or forge an
event. The aggregate exposes no reactor identities. Counts retain legitimate historical reactions
after a reactor's later removal; that person cannot subsequently read or mutate the event. This
is not a notification surface and does not enqueue push events.

## Local query-plan review and limitations

A 12,000-row unrelated-activity fixture compared the same actor/type/current-week aggregate before
and after `community_activity_actor_type_day_idx(user_id,activity_type,activity_date) INCLUDE(distance_km)`.
Before: the existing Challenge-leading index used three searches and nine shared-hit blocks.
After: the new covering index used one search, an index-only scan and three shared blocks total
(one hit/two reads) on that run. These are local PGlite observations, not production latency claims.
The test prints both EXPLAIN ANALYZE/BUFFERS JSON plans for review. Existing friendship, block,
source-FK and flame-primary-key indexes are reused; no additional speculative indexes are added.
There are no per-friend network requests. Global aggregate cost still depends on friend count and
activity volume, and full production query plans must be reviewed before release.

PGlite tests cover real database roles, RLS, grants, RPC authorization, pagination, lifecycle and
source deletion. PGlite is one connection: it does not prove real multi-session lock scheduling.
Serialized removal/block-before-flame cases are tested, and both writers use the existing same
pair lock. A separate multi-session PostgreSQL race test remains a release check before emission.

## Rollback

No existing rows/functions/policies are rewritten. Before any client uses these new contracts,
rollback can remove their public RPCs, policies/private helper/view, new private tables and the new
source index in dependency order. Existing friendships, Challenge activities and workout history
must be retained. Do not execute DROP CASCADE against an existing source table. Once events or
reactions exist, preserve/export those tables before any destructive rollback and use a reviewed
forward migration; removing the feature must not remove source history. No rollback was applied.
