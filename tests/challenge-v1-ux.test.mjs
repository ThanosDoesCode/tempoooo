import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("first-use Challenge primer covers the complete scoring path without an open rule wall", async () => {
  const rules = await read("src/components/challenge-rules.tsx");
  assert.match(
    rules,
    /Reach \$\{formatKm\(configured\.weekly_target_km\)\} challenge km each week/,
  );
  assert.match(rules, /Equivalent km are your converted progress/);
  assert.match(rules, /runs count 1:1 below 7:00 min\/km/);
  assert.match(rules, /rides\s+count 3:1 from 18 km\/h/);
  assert.match(rules, /duration and a screenshot/);
  assert.match(rules, /applies the agreed consequence/);
  assert.match(rules, /Outside Greece or Sweden/);
  assert.match(rules, /<details/);
  assert.match(await read("src/routes/_authenticated/challenge/new.tsx"), /ChallengePrimer/);
});

test("Challenge empty and failed-load states explain recovery", async () => {
  const week = await read("src/routes/_authenticated/challenge/index.tsx");
  const history = await read("src/routes/_authenticated/challenge/history.tsx");
  const money = await read("src/routes/_authenticated/challenge/payments.tsx");
  assert.match(week, /Your opponent has not joined yet/);
  assert.match(week, /No activity yet/);
  assert.match(week, /Some challenge data did not load/);
  assert.match(history, /No finalized weeks yet/);
  assert.match(history, /DataError/);
  assert.match(money, /No penalties are outstanding/);
  assert.match(money, /No travel pauses are scheduled/);
  assert.match(money, /DataError/);
});

test("activity failures retain a session draft and distinguish validation from server errors", async () => {
  const log = await read("src/routes/_authenticated/challenge/log.tsx");
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
