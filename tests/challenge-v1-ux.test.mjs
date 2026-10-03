import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Terms is the one canonical rules screen and rule copy is gone elsewhere", async () => {
  const terms = await read("src/routes/_authenticated/challenge/terms.tsx");
  // The scoring path lives on Terms: weekly target, what counts, penalties, travel pause.
  assert.match(terms, /Every week/);
  assert.match(terms, /Monday to Sunday/);
  assert.match(terms, /1 km = 1 km, under 7:00 \/km/);
  assert.match(terms, /3 km = 1 km, over 18 km\/h/);
  assert.match(terms, /If you fall short/);
  assert.match(terms, /\/challenge\/terms\/override/);
  assert.match(terms, /\/challenge\/terms\/pause/);
  // Duplicate rule copy removed from the create screen and the week screen (Phase 2 item I).
  assert.doesNotMatch(await read("src/routes/_authenticated/challenge/new.tsx"), /ChallengePrimer/);
  const week = await read("src/routes/_authenticated/challenge/index.tsx");
  assert.doesNotMatch(week, /ChallengePrimer/);
  assert.doesNotMatch(week, /How Tempo works/);
});

test("Challenge empty and failed-load states explain recovery", async () => {
  const week = await read("src/routes/_authenticated/challenge/index.tsx");
  const history = await read("src/routes/_authenticated/challenge/history.tsx");
  const money = await read("src/routes/_authenticated/challenge/money.tsx");
  const pause = await read("src/routes/_authenticated/challenge/terms_.pause.tsx");
  assert.match(week, /Your opponent has not joined yet/);
  assert.match(week, /No runs or rides yet this week/);
  assert.match(week, /Some challenge data did not load/);
  assert.match(history, /No finalized weeks yet/);
  assert.match(history, /DataError/);
  assert.match(money, /You’re all square/);
  assert.match(money, /DataError/);
  assert.match(pause, /no upcoming weeks left to pause/);
  assert.match(pause, /DataError/);
});

test("activity failures retain a session draft and distinguish validation from server errors", async () => {
  const log = await read("src/routes/_authenticated/challenge/add.tsx");
  assert.match(log, /challenge-activity-draft:/);
  assert.match(log, /sessionStorage\.setItem/);
  assert.match(log, /Check your activity/);
  assert.match(log, /Activity was not saved/);
  assert.match(log, /entered details and selected screenshots are still here/);
  assert.match(log, /Try saving again/);
  assert.match(log, /disabled=\{busy\}/);
});

test("notification and invitation failures are retryable", async () => {
  const notifications = await read("src/components/ChallengeNotifications.tsx");
  const push = await read("src/lib/challenge-push.ts");
  const invitation = await read("src/routes/_authenticated/invite.challenge.$token.tsx");
  assert.match(notifications, /Notification permission has not been granted/);
  assert.match(notifications, /Permission denied/);
  assert.match(notifications, /Not requested/);
  assert.match(notifications, /Temporarily unavailable/);
  assert.match(notifications, /Unsupported/);
  assert.match(notifications, /Retry notifications/);
  assert.match(notifications, /setRetryKey/);
  assert.doesNotMatch(notifications, /location\.reload/);
  assert.match(push, /SDK_RETRY_DELAYS_MS/);
  assert.match(push, /sdkPromise = undefined/);
  assert.doesNotMatch(push, /Notification service could not load\. Reload/);
  assert.match(invitation, /Could not accept this invitation/);
  assert.match(invitation, /Try again/);
});

test("Challenge mobile controls expose focus, touch and reduced-motion safeguards", async () => {
  const styles = await read("src/styles.css");
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(pointer: coarse\)/);
  assert.match(styles, /min-height: 2\.75rem/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /animation-duration: 0\.01ms/);
});
