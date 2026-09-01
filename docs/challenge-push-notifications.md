# Private Challenge push notifications

Implemented with OneSignal Web SDK v16 and Supabase. No bulk tracker writes, permissions, data, or calculations are used by this feature. Deployment and real-device delivery are not performed by the local implementation.

## Behavior

| Database event                                                   | Push behavior                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| New `challenge_activities` row in the current week               | Notify the other current member with run/cycle distance and server-calculated equivalent km.                       |
| First crossing of the week's target                              | One completion push per participant/week, including a meaningful distance correction that crosses the target.      |
| New finalized-week penalty obligation                            | One penalty push per week/participant, sourced from `challenge_payments` after its matching immutable week exists. |
| `unpaid → marked_paid`                                           | One payment push per obligation, even after undo/re-mark attempts.                                                 |
| Notes, evidence edits, profile edits, confirmations, bulk writes | No push.                                                                                                           |

The default target is 15 km. This application already supports future-week target overrides; notifications honor `private.target_for_week()` so they do not announce completion at 15 in a week whose target is 30. The conversion and penalty functions are unchanged. The existing **Settle up** shortcut jumps directly to `confirmed_paid`; per the requested `marked_paid` rule, it does not emit a payment notification. Use **Mark as paid** to exercise this event.

Finalization remains lazy: opening the Challenge home page invokes the existing authenticated finalization function for closed weeks. Push does not introduce a new midnight finalizer or change the penalty calculation. If both participants owe a penalty, each gets the result about the other participant, regardless of whose visit initiated finalization.

## Files and database changes

- `supabase/migrations/20260831120000_challenge_push_notifications.sql`: three tables, RLS/grants, event capture, activity-write serialization, safe registration/disable RPCs, and outbox claiming.
- `supabase/functions/challenge-push/index.ts`: reusable server-only delivery worker. Accepts no caller-selected event, recipient or message.
- `supabase/functions/challenge-push-subscription/index.ts`: authenticated own-device identity, registration, status and detach endpoint.
- `supabase/functions/_shared/challenge-push.ts`, `push-store.ts`: recipient checks, minimal message formatting, provider API, retries and database access.
- `supabase/config.toml`, `supabase/setup-challenge-push.sql`, `supabase/functions/.env.example`: secure invocation and deployment configuration.
- `src/lib/challenge-push.ts`, `src/components/ChallengeNotifications.tsx`: permission, device registration, status and account-wide disabling.
- `src/components/ChallengePushSession.tsx`, `src/lib/auth.ts`: account switching and sign-out cleanup. If a registered device cannot be detached, normal sign-out shows an error and stays signed in so it can be retried safely.
- `src/routes/_authenticated/challenge/index.tsx`, `src/routes/__root.tsx`: small Challenge card, session cleanup, manifest/icon links. No UI redesign.
- `src/integrations/supabase/types.ts`: disable RPC type. Regenerate complete database types after deployment if desired.
- `public/OneSignalSDKWorker.js`, `public/manifest.webmanifest`, `public/icons/challenge-{192,512}.png`: push service worker and installation metadata; no application cache or offline data storage. Icons are reproducible with `scripts/generate-challenge-icons.mjs`.
- `tests/challenge-push*.test.mjs`, `scripts/check-push-bundle.mjs`, `package.json`, `bun.lock`: automated tests, embedded PostgreSQL dev dependency, and browser-bundle secret scanning.
- `.env.example`, `.gitignore`, `README.md`, this guide: configuration and documentation.

To make the requested repository-wide lint check pass, 27 additional existing files received **only Prettier formatting**. Their contents were verified against formatting the original Git version; no logic changes were made in them:

```text
src/components/AppShell.tsx
src/components/ChallengeInvite.tsx
src/components/challenge-rules.tsx
src/components/ui-kit.tsx
src/integrations/supabase/auth-attacher.ts
src/integrations/supabase/auth-middleware.ts
src/integrations/supabase/client.server.ts
src/integrations/supabase/client.ts
src/lib/calc.ts
src/lib/challenge.ts
src/lib/privileged-rpcs.functions.ts
src/lib/privileged-rpcs.server.ts
src/lib/store.ts
src/routes/_authenticated/bulk/access.tsx
src/routes/_authenticated/bulk/check-in.tsx
src/routes/_authenticated/bulk/index.tsx
src/routes/_authenticated/bulk/progress.tsx
src/routes/_authenticated/bulk/route.tsx
src/routes/_authenticated/bulk/training.tsx
src/routes/_authenticated/challenge/history.tsx
src/routes/_authenticated/challenge/log.tsx
src/routes/_authenticated/challenge/new.tsx
src/routes/_authenticated/invite.bulk.$token.tsx
src/routes/_authenticated/invite.challenge.$token.tsx
src/routes/_authenticated/profile.tsx
src/routes/auth.tsx
src/routes/index.tsx
```

`push_subscriptions` stores auth user, provider, subscription UUID, web platform, timestamps and active status, with unique `(provider, subscription_id)`. `challenge_push_users` stores the account preference and a private random OneSignal external ID. `challenge_notification_events` is a service-only outbox with unique event keys, membership snapshots, minimal facts, retry status, leases and frozen delivery devices.

RLS policies added: **push identity read own**, **push subscriptions read own**, **push subscriptions delete own**. No existing RLS policy changes. Users cannot directly insert/update identities or subscriptions: that would let them claim arbitrary device IDs. Registration uses the authenticated Edge Function, verifies the subscription against OneSignal, and calls a service-only RPC. `disable_challenge_push()` uses `auth.uid()` and atomically disables only the caller. Outbox tables and claim/register RPCs have no anon/authenticated write/execute grants. Trigger helpers are private and not client-callable.

## OneSignal setup

1. Create a **dedicated app** for this Challenge using OneSignal's Free plan. Its current free web-push and API-send allowances are ample for two people; no paid Journeys, webhooks or marketing features are needed. [OneSignal pricing](https://onesignal.com/pricing)
2. Configure **Web → Custom Code**, and enter the exact production HTTPS origin. Use separate OneSignal apps for production and localhost/staging. Do not use a changing preview domain as production.
3. Keep automatic permission prompts, welcome notifications, marketing campaigns and subscription bells disabled. The code uses the explicit Challenge button. Do not add an additional OneSignal script through a tag manager or dashboard snippet.
4. Record the public App ID and generate the private **App API key** (called `ONESIGNAL_REST_API_KEY` here). This is not an organization key. The worker uses `Authorization: Key …`.
5. Keep the worker path `OneSignalSDKWorker.js`, scope `/`. Confirm it returns JavaScript, not the app's HTML fallback. The worker imports OneSignal's v16 push transport; it does not cache authenticated routes. [Web SDK reference](https://documentation.onesignal.com/docs/en/web-sdk-reference)
6. Do **not** use Supabase user UUIDs/emails as OneSignal login IDs, broadcast to segments, or enable mobile-only JWT verification for this web integration. Read the identity limitation below before launch.

## Environment and deployment

| Setting                                     | Location                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_ONESIGNAL_APP_ID`                     | Public frontend build environment; rebuild after configuring.                                                                                                     |
| `ONESIGNAL_APP_ID`                          | Supabase Edge Function secret; same public App ID.                                                                                                                |
| `ONESIGNAL_REST_API_KEY`                    | Supabase Edge Function secret only.                                                                                                                               |
| `CHALLENGE_PUSH_SITE_URL`                   | Edge Function secret/config: exact frontend origin, e.g. `https://my-app.example`, with no trailing slash or path. Used for CORS and the fixed `/challenge` link. |
| `CHALLENGE_PUSH_DISPATCH_SECRET`            | Random secret shared by the worker and Supabase Vault, at least 32 random bytes. Generate locally, e.g. `openssl rand -hex 32`.                                   |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Automatically supplied to hosted Edge Functions. Never add the service-role key to the frontend.                                                                  |

Existing frontend and TanStack server Supabase settings remain required. Never put secrets in `VITE_*` variables or the repository's tracked `.env`. Use deployment secrets and the ignored `supabase/functions/.env.local` based on the example.

Apply on staging first, then production:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set --env-file supabase/functions/.env.local
supabase functions deploy challenge-push
supabase functions deploy challenge-push-subscription
```

Both functions disable the gateway's legacy JWT check in `config.toml`, but **neither is unauthenticated**: subscription requests call `auth.getUser` on the bearer token; delivery requires the dedicated dispatch secret and reads committed events itself. Do not change these into publicly callable notification endpoints.

In the Supabase dashboard, create two Vault secrets:

- `challenge_push_worker_url`: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/challenge-push`
- `challenge_push_dispatch_secret`: exactly the same random value as `CHALLENGE_PUSH_DISPATCH_SECRET`.

Then run `supabase/setup-challenge-push.sql` in the SQL editor as administrator. This enables `pg_net`/`pg_cron`, adds an after-commit wake-up, and schedules a one-minute retry sweep. The script is separate so applying a schema migration never requires live provider keys or starts sending before setup is ready. It can be run again; the named cron job is updated. Supabase Vault is part of hosted Supabase; enable it first if absent in a custom installation. [Supabase scheduling guidance](https://supabase.com/docs/guides/functions/schedule-functions)

Deploy/rebuild the frontend through the existing Lovable workflow. Check the manifest, worker, icons and exact production origin. If a CSP is used, permit the OneSignal SDK and its required connections/workers according to the provider's documentation; do not disable CSP globally.

## Delivery guarantees and operations

Events enter the outbox in the same transaction as the activity/payment. Rollbacks produce no deliverable event. Only exactly two current members qualify. Both membership row IDs are captured and checked again during delivery: leaving, replacement, or leaving/rejoining invalidates old queued notifications. Recipients are resolved server-side, never from frontend IDs or notification payloads.

The worker leases five rows at a time. Failed calls retry with exponential delays (starting at one minute), at most eight attempts and within 24 hours. Each event uses its persistent UUID as the provider idempotency key; device IDs are frozen before the first send. A later device does not receive a retry intended for older devices. OneSignal's idempotency window is 30 days, longer than our retry window. Never reset IDs or replay expired rows to retry an ambiguous send. [Idempotent requests](https://documentation.onesignal.com/reference/idempotent-notification-requests)

Existing completed current weeks are seeded as skipped, so rollout does not announce old milestones. No eligible/opted-in device means the event is skipped, not held for future opt-in. Provider acceptance is recorded as `sent`; it is not proof that the OS displayed a notification. HTTP 200 with an empty provider ID is skipped, not marked sent. Failures expose only safe error codes.

Admin-only monitoring (never expose this through a public dashboard):

```sql
select kind, status, count(*)
from public.challenge_notification_events group by kind, status;

select id, kind, attempts, last_error, created_at
from public.challenge_notification_events
where status = 'failed' order by created_at desc;

select jobname, active from cron.job where jobname = 'challenge-push-retry';
```

Keep dedupe keys for the challenge lifetime. At this scale the queue is tiny. Do not prune successful target/payment events then replay old database transitions. To pause delivery, disable the `challenge-push-retry` cron job **and** the `challenge_push_wake` trigger. Disabling only the cron job leaves immediate delivery active.

## Two-account acceptance test

Use two devices/browser profiles and a private staging challenge. Both accounts must be current members. Enable notifications independently; there must be no native permission prompt merely from loading a page. Denial should leave **Notifications Off** with guidance.

1. A logs a run with a Strava screenshot: only B receives it. B logs a ride: only A receives it, using the stored cycle conversion.
2. Bring A below then to the weekly target (15 by default). B should receive one activity push and one completion push. Add another activity: only the activity push. Retrying delivery or repeated completion must not add completion pushes.
3. A third account outside the challenge must not post activities, read subscriptions/outbox, claim events, or invoke delivery with its ordinary auth token. A second challenge's events must reach only its members.
4. Use a closed staging week at 10–14.99 equivalent km against a 15 km target. Open Challenge home to finalize. The opponent gets one €5 result; reopening the page must not duplicate it. Do not alter production dates/results to manufacture this test.
5. The payer selects **Mark as paid**. The recipient gets one payment push; clicking/retrying again, confirmation, and undo/re-mark do not duplicate it.
6. Edit notes/evidence or bulk tracker data: no challenge push. Run/cycle conversion and penalties must remain unchanged.
7. Disable notifications on all devices. Post an opponent activity: no push to any disabled device. A reload or background refresh must not enable them. Explicitly enable on one device to resume there.
8. Pause dispatch, queue an event, then remove/leave the opponent's membership. Resume: the event must be skipped. Replace or rejoin the member: the old event must still be skipped.
9. Sign out on a shared device and sign in as the other user. It must not receive notifications addressed to the old user. Test offline sign-out: the app explains the detach failure and asks for a retry.
10. Check the protected `/challenge` link, foreground/background delivery, lock-screen previews, browser denied permission, CDN blocking, and an actual iPhone Home Screen installation.

## iPhone/PWA and security limits

iPhone/iPad web push requires iOS/iPadOS 16.4+, HTTPS, an app installed via **Share → Add to Home Screen**, opening that installed app, and a user gesture to request permission. Browser tabs and an installed app may have different subscriptions/sign-in state. Private browsing, OS notification settings, Focus modes and delivery conditions can suppress notifications. This is push-only PWA support, not an offline mode. [OneSignal iOS web-push requirements](https://documentation.onesignal.com/docs/en/web-push-for-ios)

OneSignal's documented JWT identity-verification feature currently supports native Android/iOS, not this web SDK. This implementation instead uses unguessable random per-account capability IDs, visible only to their authenticated owner, and checks provider ownership at registration and before each send. These IDs and device IDs must be treated as credentials: never put them in profiles, URLs, analytics, console logs or messages to opponents. This is not cryptographic web-device attestation. An XSS, compromised browser, leaked capability, or malicious provider can defeat that boundary. Use a dedicated OneSignal app, protect dashboard/API access, and keep the site free of untrusted scripts. [Identity verification support and limitations](https://documentation.onesignal.com/docs/en/identity-verification)

Notifications expose only a sanitized first display-name token and necessary distance/amount, plus a fixed private app URL. There are no notes, evidence links, emails, challenge IDs or bulk data in custom payloads. A user can choose an email as their display name; avoid that if lock-screen privacy matters. OneSignal and the OS necessarily process the message. Already-accepted pushes cannot be atomically recalled when a member leaves or opts out; membership/device state is rechecked just before submission and TTL is limited to five minutes. Do not rely on push for guaranteed delivery or confidential evidence.

## Local verification and existing issues

```sh
bun install --frozen-lockfile
npm test
npx tsc --noEmit
npm run build
npm run test:push:bundle -- --build
npm run lint
```

Tests execute the actual application migrations/RLS in PGlite (PostgreSQL compiled to WASM), plus provider/worker tests and browser-adapter tests with mocked auth/browser boundaries. Only Supabase's platform auth/storage schemas are test fixtures. No real push is sent. PGlite does not replace a live multi-session PostgreSQL concurrency test or an actual OneSignal/iPhone acceptance run.

The existing migrations block client distance corrections/deletes when the activity guard tries to insert into `challenge_activity_audit` without an insert policy. This predates push and is not changed here. Tests assert that denial, then verify deduplication under an authorized server correction. The original repository had 882 Prettier lint errors; formatting-only fixes were applied so the requested lint check passes, without changing bulk behavior or challenge calculations.

Verified locally on 2026-08-31:

| Check                                       | Result                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automated suite                             | 35 passing tests, including real migrations/RLS, batch crossing, rollback, queue leases, own-device registration, provider isolation and browser permission flows. |
| TypeScript                                  | `npx tsc --noEmit` passes.                                                                                                                                         |
| Edge Function runtime types                 | `deno check` passes for both entry points.                                                                                                                         |
| Repository lint                             | Passes: zero errors, seven existing Fast Refresh warnings.                                                                                                         |
| Production build                            | Passes.                                                                                                                                                            |
| Client secret scan                          | 32 browser assets scanned, no secret references or injected secret canaries.                                                                                       |
| PWA assets                                  | Manifest, worker, 192px and 512px icons return HTTP 200 with their expected content types.                                                                         |
| Local browser                               | `/challenge` redirects a signed-out user to `/auth`. No permission prompt on load.                                                                                 |
| Live Supabase/OneSignal and physical iPhone | Not deployed/tested; requires the manual setup and two-account acceptance checklist above.                                                                         |
