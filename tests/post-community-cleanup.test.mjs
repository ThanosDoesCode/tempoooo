import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountUI, deferred, textOf } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";
import * as onboarding from "../src/lib/bulk-onboarding.ts";
import { LOG_ACTIONS } from "../src/lib/main-navigation.ts";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const drawers = Object.fromEntries(
  ["Drawer", "DrawerClose", "DrawerContent", "DrawerTitle"].map((x) => [x, x]),
);
function logFixture({
  data = null,
  isLoading = false,
  isError = false,
  fitness = false,
  open = true,
} = {}) {
  const calls = [];
  const modules = {
    "@tanstack/react-router": {
      Link: "Link",
      useNavigate: () => async (value) => calls.push(value),
    },
    "@/lib/challenge": {
      useMyChallenge: () => ({ data, isLoading, isError, refetch: () => calls.push("retry") }),
    },
    "@/lib/main-navigation": { LOG_ACTIONS },
    "@/components/ui/drawer": drawers,
  };
  return {
    calls,
    ui: accountUI("src/components/LogSheet.tsx", "LogSheet", modules, {
      open,
      onOpenChange: (value) => calls.push(value),
      showFitnessActions: fitness,
    }),
  };
}
test("closed Log sheet doesn't mount its Challenge reader or add startup work", () => {
  const f = logFixture({ open: false });
  assert.equal(f.ui.find("DrawerContent").length, 0);
});
for (const data of [null, { status: "draft" }, { status: "completed" }])
  test(`Run/Ride unavailable without active Challenge (${data?.status ?? "none"})`, () => {
    const { ui } = logFixture({ data });
    for (const label of ["Run", "Ride"]) assert.equal(ui.button(label).props.disabled, true);
    assert.doesNotMatch(ui.text(), /Counts toward your challenge|Your day/);
    assert.match(ui.text(), /Join or create an active challenge/);
    assert.equal(
      ui.find("Link").some((n) => n.props.to === "/challenge/add"),
      false,
    );
    assert.ok(ui.find("Link").some((n) => n.props.to === "/challenge"));
  });
test("active Challenge keeps explicit Run/Ride selection; fitness actions retain actual destinations", () => {
  const { ui, calls } = logFixture({ data: { status: "active" }, fitness: true });
  assert.match(ui.text(), /Counts toward your challenge/);
  const links = ui.find("Link");
  assert.deepEqual(
    links.map((n) => plain(n.props.search)),
    [{ type: "run" }, { type: "cycle" }],
  );
  assert.ok(links.every((n) => n.props.to === "/challenge/add"));
  for (const [name, to] of [
    ["Meal", "/bulk/meals/add"],
    ["Workout", "/bulk/training"],
    ["Weigh-in & sleep", "/bulk/morning"],
  ]) {
    ui.find("button")
      .find((n) => textOf(n).startsWith(name))
      .props.onClick();
    assert.deepEqual(plain(calls.at(-1)), { to });
  }
});
test("Log access pending/error never flashes actionable run links; retry stays local", () => {
  assert.match(logFixture({ isLoading: true }).ui.text(), /Checking challenge/);
  const { ui, calls } = logFixture({ isError: true });
  assert.match(ui.text(), /Could not check Challenge access/);
  ui.button("Try again").props.onClick();
  assert.deepEqual(calls, ["retry"]);
});
function setupFixture() {
  const calls = [];
  const ui = accountUI("src/routes/_authenticated/bulk-onboarding.tsx", "Route", {
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/lib/bulk-access": {},
    "@/lib/bulk-onboarding": onboarding,
    "@/lib/network-errors": { userFacingError: () => "failed" },
    "@/lib/goal-discovery": { useAcknowledgeGoal: () => () => {} },
    "@/integrations/supabase/client": { supabase: { rpc: async (...args) => calls.push(args) } },
  });
  return { ui, calls };
}
test("setup escapes from step 1; step Back preserves answers and never saves partially", () => {
  const { ui, calls } = setupFixture();
  assert.equal(ui.find("HistoryBackLink")[0].props.fallback, "/profile");
  ui.button("Bulk").props.onClick();
  ui.find("input")[0].props.onChange({ target: { value: "70" } });
  ui.find("input")[1].props.onChange({ target: { value: "78" } });
  ui.button("Continue").props.onClick();
  assert.match(ui.text(), /Fitness setup · 2 of 5/);
  assert.equal(ui.find("HistoryBackLink")[0].props.labelOverride, "Cancel setup");
  ui.find("BackButton")[0].props.onClick();
  assert.match(ui.text(), /Fitness setup · 1 of 5/);
  assert.equal(ui.find("input")[0].props.value, "70");
  assert.equal(ui.find("input")[1].props.value, "78");
  assert.equal(calls.length, 0);
});
test("setup steps 2–5 use local Back, retain answers and offer explicit cancellation without saves", () => {
  const { ui, calls } = setupFixture();
  ui.button("Bulk").props.onClick();
  ui.find("input")[0].props.onChange({ target: { value: "70" } });
  ui.find("input")[1].props.onChange({ target: { value: "78" } });
  ui.button("Continue").props.onClick();
  ui.button(onboarding.EXPERIENCE_LEVELS[1].label).props.onClick();
  ui.button("3").props.onClick();
  ui.button(onboarding.EQUIPMENT_OPTIONS[0].label).props.onClick();
  ui.button("Continue").props.onClick();
  assert.match(ui.text(), /Fitness setup · 3 of 5/);
  const custom = ui.find("button").find((b) => textOf(b).startsWith("Create my own program"));
  custom.props.onClick();
  ui.button("Continue").props.onClick();
  assert.match(ui.text(), /Fitness setup · 4 of 5/);
  ui.button("Continue").props.onClick();
  assert.match(ui.text(), /Fitness setup · 5 of 5/);
  for (const step of [5, 4, 3, 2]) {
    assert.equal(ui.find("HistoryBackLink")[0].props.labelOverride, "Cancel setup");
    assert.equal(calls.length, 0);
    ui.find("BackButton")[0].props.onClick();
    assert.match(ui.text(), new RegExp(`Fitness setup · ${step - 1} of 5`));
  }
  assert.equal(ui.find("input")[0].props.value, "70");
});
function logoutFixture(logout) {
  const calls = [];
  return {
    calls,
    ui: accountUI("src/components/SignOutButton.tsx", "SignOutButton", {
      "@tanstack/react-router": { useNavigate: () => async (v) => calls.push(v) },
      "@/lib/auth": { signOut: logout },
    }),
  };
}
test("shared Profile/Settings Sign out waits for confirmed success and blocks double submission", async () => {
  const gate = deferred();
  let attempts = 0;
  const { ui, calls } = logoutFixture(async () => {
    attempts++;
    await gate.promise;
    return true;
  });
  ui.button("Sign out").props.onClick();
  ui.button("Signing out…").props.onClick();
  assert.equal(attempts, 1);
  assert.equal(calls.length, 0);
  assert.equal(ui.button("Signing out…").props.disabled, true);
  gate.resolve();
  await ui.flush();
  assert.deepEqual(plain(calls), [{ to: "/auth", replace: true }]);
});
test("sign-out failures stay local with no navigation, and can be retried", async () => {
  let fail = true;
  const { ui, calls } = logoutFixture(async ({ onError }) => {
    if (fail) {
      onError("Could not safely disconnect notifications.");
      return false;
    }
    return true;
  });
  ui.button("Sign out").props.onClick();
  await ui.flush();
  assert.match(ui.text(), /Could not safely disconnect/);
  assert.equal(calls.length, 0);
  assert.equal(ui.button("Sign out").props.disabled, false);
  fail = false;
  ui.button("Sign out").props.onClick();
  await ui.flush();
  assert.equal(calls.length, 1);
  for (const path of ["profile.tsx", "profile_.settings.tsx"])
    assert.match(read(`src/routes/_authenticated/${path}`), /<SignOutButton \/>/);
});
for (const failure of ["detach", "auth", null])
  test(`auth sign-out keeps cleanup order (${failure ?? "success"})`, async () => {
    const calls = [],
      errors = [];
    const auth = presentationComponent(
      "src/lib/auth.ts",
      {
        "@/integrations/supabase/client": {
          supabase: {
            auth: {
              signOut: async () => {
                calls.push("auth");
                return { error: failure === "auth" ? new Error("offline") : null };
              },
            },
          },
        },
        "./challenge-push": {
          detachChallengePush: async () => {
            calls.push("detach");
            if (failure === "detach") throw new Error("offline");
          },
        },
        "@/lib/browser-data": { clearAccountScopedBrowserData: () => calls.push("clear") },
        "@/lib/network-errors": {},
        "@/lib/startup": {},
      },
      {
        window: {
          alert() {
            throw new Error("native alert should not run with local reporter");
          },
        },
      },
    );
    assert.equal(await auth.signOut({ onError: (message) => errors.push(message) }), !failure);
    assert.deepEqual(
      calls,
      failure === "detach"
        ? ["detach"]
        : failure === "auth"
          ? ["detach", "auth"]
          : ["detach", "auth", "clear"],
    );
    assert.equal(errors.length, failure ? 1 : 0);
  });
test("Today and Challenge use the same honest flame + weeks headline", () => {
  const data = { current: 6, activeRings: [] };
  const today = accountUI("src/components/TodayStreak.tsx", "TodayStreak", {}, { data });
  const challenge = accountUI("src/components/StreakFlame.tsx", "StreakFlame", {
    "@/lib/streak": { useStreak: () => ({ data }) },
  });
  for (const ui of [today, challenge]) {
    assert.match(ui.text(), /6 weeks/);
    assert.equal(ui.find("Link")[0].props.to, "/streak");
    assert.equal(ui.find("Flame")[0].props.className, "h-4 w-4 text-orange-400");
  }
  const loading = accountUI("src/components/StreakFlame.tsx", "StreakFlame", {
    "@/lib/streak": { useStreak: () => ({}) },
  });
  assert.equal(loading.find("Link")[0].props.to, "/streak");
  assert.equal(loading.text(), "Streak");
  assert.doesNotMatch(loading.text(), /0 weeks/);
});
test("Challenge empty state is concise and preserves real invitation/header/create entry points", () => {
  const source = read("src/routes/_authenticated/challenge/index.tsx");
  const empty = source.slice(
    source.indexOf("  if (!challenge) {"),
    source.indexOf("  const today = todayIn"),
  );
  assert.match(empty, /No active challenge/);
  assert.match(empty, /<ChallengeInvitations \/>/);
  assert.match(empty, /to="\/challenge\/new"/);
  assert.match(empty, /<ChallengeHeader \/>/);
  assert.doesNotMatch(empty, /fitness|penalty when|Joining is invite-only|<Note>/);
});
