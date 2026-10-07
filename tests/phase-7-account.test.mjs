import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountUI, deferred, event, textOf } from "./account-ui-fixture.mjs";
import { presentationComponent } from "./presentation-component-fixture.mjs";

const username = presentationComponent("src/lib/account-profile.ts", {
  "@tanstack/react-query": {},
  "@/integrations/supabase/client": {},
  "./network-errors": {},
});
const recommendation = presentationComponent("src/lib/bulk-onboarding.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const queryClient = { invalidateQueries: async () => {}, clear() {}, setQueryData() {} };
const router = (navigate = async () => {}, search = {}) => ({
  createFileRoute: () => (options) => ({ options, useSearch: () => search }),
  useNavigate: () => navigate,
  Link: "Link",
});

function onboarding({
  profile = { username: null, account_onboarded_at: null },
  check = async () => true,
  save = async () => {},
  navigate = async () => {},
} = {}) {
  return accountUI("src/routes/_authenticated/onboarding.tsx", "Route", {
    "@tanstack/react-router": router(navigate),
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/auth": { useAuth: () => ({ user: { id: "owner" } }) },
    "@/lib/account-profile": { ...username, useAccountProfile: () => ({ data: profile }) },
    "@/lib/privileged-rpcs.functions": {
      checkUsernameAvailability: check,
      saveAccountUsername: save,
    },
    "@/lib/pending-destination": { takeDestination: () => null },
  });
}
function deletion(remove = async () => {}, onDeleted = async () => {}) {
  return accountUI(
    "src/components/DeleteAccountDialog.tsx",
    "DeleteAccountDialog",
    {
      "@/lib/privileged-rpcs.functions": { deleteTempoAccount: remove },
    },
    { onDeleted },
  );
}
function enterConfirmation(ui, value = "DELETE") {
  ui.find("Dialog.Root")[0].props.onOpenChange(true);
  ui.find("input")[0].props.onChange(event(value));
  ui.render();
}

const targets = () => ({
  calories: 2800,
  protein: 140,
  carbs: 380,
  fat: 80,
  goal: "gain",
  targetWeight: 75,
  weeklyWorkoutGoal: 5,
  trainingDaysPerWeek: 3,
});
function editor(name, save, role = "owner") {
  const data = { targets: targets() };
  const dirty = [];
  const ui = accountUI(
    `src/components/${name}.tsx`,
    name,
    {
      "@/lib/store": {
        useAppData: () => data,
        useBulkMeta: () => ({ role }),
        useActions: () => ({
          saveTargets: async (next) => {
            await save(next);
            data.targets = next;
          },
        }),
      },
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/lib/calc": { iso: () => "2026-10-07" },
      "@/lib/bulk-nutrition-query": { refreshBulkNutritionTargets: async () => {} },
    },
    { onDirtyChange: (value) => dirty.push(value) },
  );
  return { ui, data, dirty };
}

test("Phase 7 landing has genuine signup/sign-in routes and optional fitness copy", () => {
  const ui = accountUI("src/routes/index.tsx", "Route", { "@/integrations/supabase/client": {} });
  assert.match(ui.text(), /Keep each other moving/);
  assert.match(ui.text(), /if you want/);
  const links = ui.find("Link");
  assert.deepEqual(
    links.map((link) => [link.props.to, link.props.search.mode]),
    [
      ["/auth", "signup"],
      ["/auth", "signin"],
    ],
  );
});

test("Phase 7 welcome -> username -> optional intro saves the existing account boundary only", async () => {
  const saved = [],
    navigation = [];
  const ui = onboarding({
    save: async (value) => saved.push(value),
    navigate: async (value) => navigation.push(value),
  });
  ui.button("Continue").props.onClick();
  ui.find("input")[0].props.onChange(event("@Alice_1"));
  await ui.timers();
  assert.match(ui.text(), /@alice_1 is available/);
  ui.find("form")[0].props.onSubmit(event());
  await ui.flush();
  assert.match(ui.text(), /Enter Tempo/);
  assert.deepEqual(plain(saved), []);
  ui.button("Enter Tempo").props.onClick();
  await ui.flush();
  assert.deepEqual(plain(saved), [{ data: { username: "alice_1", completeOnboarding: true } }]);
  assert.deepEqual(plain(navigation), [{ to: "/today", replace: true }]);
});

test("Phase 7 username Back retains the typed answer and does not save prematurely", async () => {
  const ui = onboarding();
  ui.button("Continue").props.onClick();
  ui.find("input")[0].props.onChange(event("alice"));
  await ui.timers();
  ui.find("form")[0].props.onSubmit(event());
  await ui.flush();
  ui.find("BackButton")[0].props.onClick();
  assert.equal(ui.find("input")[0].props.value, "alice");
});

test("Phase 7 reserved/invalid/taken usernames cannot continue", async () => {
  const ui = onboarding({ check: async () => false });
  ui.button("Continue").props.onClick();
  for (const value of ["x", "admin", "has space"]) {
    ui.find("input")[0].props.onChange(event(value));
    assert.equal(ui.button("Continue").props.disabled, true);
    assert.equal(ui.find("input")[0].props["aria-invalid"], true);
  }
  ui.find("input")[0].props.onChange(event("alice"));
  await ui.timers();
  assert.match(ui.text(), /already taken/);
  assert.equal(ui.button("Continue").props.disabled, true);
});

test("Phase 7 username availability failure is recoverable, not perpetual checking", async () => {
  let fail = true;
  const ui = onboarding({
    check: async () => {
      if (fail) throw new Error("offline");
      return true;
    },
  });
  ui.button("Continue").props.onClick();
  ui.find("input")[0].props.onChange(event("alice"));
  await ui.timers();
  assert.match(ui.text(), /Continue to retry/);
  fail = false;
  ui.find("form")[0].props.onSubmit(event());
  await ui.flush();
  assert.match(ui.text(), /Enter Tempo/);
});

test("Phase 7 superseded username availability cannot override the current input", async () => {
  const old = deferred();
  const ui = onboarding({
    check: ({ data }) => (data.username === "alice" ? old.promise : Promise.resolve(true)),
  });
  ui.button("Continue").props.onClick();
  ui.find("input")[0].props.onChange(event("alice"));
  await ui.timers();
  ui.find("input")[0].props.onChange(event("bob"));
  await ui.timers();
  old.resolve(false);
  await ui.flush();
  assert.match(ui.text(), /@bob is available/);
});

test("Phase 7 established accounts bypass the intro and active account completion stays unchanged", async () => {
  const nav = [],
    saved = [];
  const ui = onboarding({
    profile: { username: null, account_onboarded_at: "2026-01-01" },
    save: async (v) => saved.push(v),
    navigate: async (v) => nav.push(v),
  });
  assert.match(ui.text(), /Your profile/);
  assert.equal(ui.find("BackButton").length, 0);
  ui.find("input")[0].props.onChange(event("alice"));
  ui.find("form")[0].props.onSubmit(event());
  await ui.flush();
  assert.equal(saved.length, 1);
  assert.equal(nav[0].to, "/today");
  const existing = [];
  onboarding({
    profile: { username: "alice", account_onboarded_at: "2026-01-01" },
    navigate: async (v) => existing.push(v),
  }).render();
  assert.equal(existing[0].to, "/today");
});

test("Phase 7 nutrition editor starts clean, validates, and updates only existing target fields", async () => {
  const saved = [];
  const { ui, data, dirty } = editor("NutritionTargetsEditor", async (value) => saved.push(value));
  assert.equal(ui.button("Save targets").props.disabled, true);
  assert.equal(dirty.at(-1), false);
  ui.find("input")[0].props.onChange(event("100"));
  ui.button("Save targets").props.onClick();
  await ui.flush();
  assert.equal(saved.length, 0);
  assert.match(ui.text(), /Calories must be between/);
  ui.find("input")[0].props.onChange(event("3000"));
  assert.equal(dirty.at(-1), true);
  ui.button("Save targets").props.onClick();
  await ui.flush();
  assert.deepEqual(plain(saved), [{ ...targets(), calories: 3000 }]);
  assert.equal(data.targets.targetWeight, 75);
  assert.equal(ui.button("Targets saved").props.disabled, true);
  assert.equal(dirty.at(-1), false);
});

test("Phase 7 nutrition save failure retains the draft and unsaved guard state", async () => {
  const { ui, dirty } = editor("NutritionTargetsEditor", async () => {
    throw new Error("offline");
  });
  ui.find("input")[0].props.onChange(event("3000"));
  ui.button("Save targets").props.onClick();
  await ui.flush();
  assert.match(ui.text(), /Targets were not saved/);
  assert.equal(ui.find("input")[0].props.value, "3000");
  assert.equal(dirty.at(-1), true);
  assert.equal(ui.button("Save targets").props.disabled, false);
});

test("Phase 7 weekly workout goal remains 5 independently of the three-day plan", async () => {
  const saved = [];
  const { ui } = editor("WeeklyWorkoutGoalEditor", async (value) => saved.push(value));
  assert.equal(ui.find("input")[0].props.value, "5");
  assert.equal(ui.button("Save goal").props.disabled, true);
  ui.find("input")[0].props.onChange(event("2.5"));
  ui.button("Save goal").props.onClick();
  await ui.flush();
  assert.equal(saved.length, 0);
  assert.match(ui.text(), /whole number between 1 and 14/);
  ui.find("input")[0].props.onChange(event("4"));
  ui.button("Save goal").props.onClick();
  await ui.flush();
  assert.deepEqual(plain(saved), [{ ...targets(), weeklyWorkoutGoal: 4 }]);
  assert.equal(saved[0].trainingDaysPerWeek, 3);
});

test("Phase 7 viewers still cannot modify nutrition or weekly targets", () => {
  for (const name of ["NutritionTargetsEditor", "WeeklyWorkoutGoalEditor"]) {
    const { ui, dirty } = editor(name, async () => assert.fail("viewer write"), "viewer");
    assert.ok(ui.find("input").every((node) => node.props.disabled));
    assert.equal(dirty.at(-1), false);
  }
});

test("Phase 7 unsaved settings use the existing router/history blocker with explicit leave/keep choices", () => {
  let options,
    kept = 0,
    left = 0;
  const ui = accountUI(
    "src/components/UnsavedSettingsDialog.tsx",
    "UnsavedSettingsDialog",
    {
      "@tanstack/react-router": {
        useBlocker: (value) => {
          options = value;
          return { status: "blocked", reset: () => kept++, proceed: () => left++ };
        },
      },
    },
    { dirty: true },
  );
  assert.equal(ui.find("Dialog.Root")[0].props.open, true);
  assert.equal(options.withResolver, true);
  assert.equal(options.enableBeforeUnload, true);
  assert.equal(options.shouldBlockFn(), true);
  ui.button("Keep editing").props.onClick();
  ui.button("Leave").props.onClick();
  ui.find("Dialog.Root")[0].props.onOpenChange(false);
  assert.equal(kept, 2);
  assert.equal(left, 1);
});

test("Phase 7 account deletion requires exact DELETE and Keep does not delete", () => {
  const ui = deletion(async () => assert.fail("unexpected deletion"));
  for (const value of ["", "delete", "DELETE "]) {
    enterConfirmation(ui, value);
    assert.equal(ui.button("Delete my account").props.disabled, true);
  }
  enterConfirmation(ui);
  assert.equal(ui.button("Delete my account").props.disabled, false);
  ui.find("Dialog.Root")[0].props.onOpenChange(false);
  assert.equal(ui.find("input")[0].props.value, "");
  assert.equal(ui.find("Dialog.Root")[0].props.open, false);
});

test("Phase 7 deletion pending blocks repeated submit, Escape and outside dismissal; success uses the verified server flow", async () => {
  const pending = deferred(),
    calls = [];
  let finished = 0;
  const ui = deletion(
    (value) => {
      calls.push(value);
      return pending.promise;
    },
    async () => finished++,
  );
  enterConfirmation(ui);
  const submit = ui.find("form")[0].props.onSubmit;
  submit(event());
  submit(event());
  assert.equal(calls.length, 1);
  assert.match(ui.text(), /Deleting account/);
  ui.find("Dialog.Root")[0].props.onOpenChange(false);
  assert.equal(ui.find("Dialog.Root")[0].props.open, true);
  for (const name of ["onEscapeKeyDown", "onPointerDownOutside"]) {
    let prevented = false;
    ui.find("Dialog.Content")[0].props[name]({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
  }
  pending.resolve();
  await ui.flush();
  assert.equal(finished, 1);
  assert.deepEqual(plain(calls), [{ data: { confirmation: "Delete my account" } }]);
});

test("Phase 7 partial Storage cleanup failure stays visible with account-preserved explanation and retry", async () => {
  let attempts = 0,
    finished = 0;
  const ui = deletion(
    async () => {
      if (++attempts === 1) throw new Error("account_deletion_photo_cleanup_failed");
    },
    async () => finished++,
  );
  enterConfirmation(ui);
  ui.find("form")[0].props.onSubmit(event());
  await ui.flush();
  assert.match(ui.text(), /account and database records were kept/);
  assert.match(ui.text(), /photos may already have been removed/);
  assert.equal(ui.find("Dialog.Root")[0].props.open, true);
  assert.equal(finished, 0);
  ui.find("form")[0].props.onSubmit(event());
  await ui.flush();
  assert.equal(attempts, 2);
  assert.equal(finished, 1);
});

test("Phase 7 local sign-out retry after deletion does not call account deletion twice", async () => {
  let removed = 0,
    completion = 0;
  const ui = deletion(
    async () => removed++,
    async () => {
      if (++completion === 1) throw new Error("local failure");
    },
  );
  enterConfirmation(ui);
  ui.find("form")[0].props.onSubmit(event());
  await ui.flush();
  assert.match(ui.text(), /account was deleted/);
  assert.equal(ui.button("Finish signing out").props.disabled, false);
  ui.find("form")[0].props.onSubmit(event());
  await ui.flush();
  assert.equal(removed, 1);
  assert.equal(completion, 2);
});

function profileFixture({
  owned = true,
  admin = false,
  loading = false,
  failed = false,
  logout = async () => true,
  navigate = async () => {},
} = {}) {
  return accountUI("src/routes/_authenticated/profile.tsx", "Route", {
    "@tanstack/react-router": router(navigate),
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/auth": {
      useAuth: () => ({ user: { id: "owner", email: "owner@tempo.test" } }),
      signOut: logout,
    },
    "@/lib/account-profile": {
      ...username,
      useAccountProfile: () => ({ data: { username: "alice" } }),
    },
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: [], isLoading: loading, isError: failed }),
      preferredBulkMembership: () =>
        owned && !loading && !failed ? { bulk_profile_id: "owned" } : null,
      useBulkAdmin: () => ({ data: admin }),
    },
    "@/lib/goal-discovery": {
      useGoalDiscovery: () => ({ data: { goal_seen_at: "2026-01-01" } }),
      useAcknowledgeGoal: () => async () => {},
    },
    "@/lib/privileged-rpcs.functions": { checkUsernameAvailability: async () => true },
    "@/components/NavRows": presentationComponent("src/components/NavRows.tsx", {
      "@tanstack/react-router": { Link: "Link" },
      "lucide-react": { ChevronRight: "ChevronRight" },
    }),
    "@/components/ChallengeInvitations": { ChallengeInvitations: "ChallengeInvitations" },
    "@/components/ChallengeDataExport": { ChallengeDataExport: "ChallengeDataExport" },
    "@/components/DeleteAccountDialog": { DeleteAccountDialog: "DeleteAccountDialog" },
    "@/components/PageSkeleton": { PageSkeleton: "PageSkeleton" },
  });
}

test("Phase 7 Profile is owner-aware, with direct Goal/Training/Notifications and admin access but no legacy daily-log tool", () => {
  const ui = profileFixture({ admin: true });
  assert.match(ui.text(), /@alice/);
  assert.deepEqual(
    ui.find("Link").map((node) => node.props.to),
    ["/bulk/more", "/bulk/training", "/profile/notifications", "/bulk/diagnostics"],
  );
  assert.doesNotMatch(ui.text(), /Compatibility tools|Daily log|Legacy Today/);
  assert.equal(ui.find("ChallengeInvitations").length, 0);
  assert.match(ui.text(), /Notification settings/);
  const owner = profileFixture();
  assert.doesNotMatch(owner.text(), /Compatibility tools|Daily log|Production diagnostics/);
  const core = profileFixture({ owned: false });
  assert.deepEqual(
    core.find("Link").map((node) => node.props.to),
    ["/bulk-onboarding", "/profile/notifications"],
  );
  assert.doesNotMatch(core.text(), /Production diagnostics/);
});

test("Phase 7 Profile doesn't flash plan links during loading or hide a data-check failure", () => {
  const loading = profileFixture({ loading: true });
  assert.equal(loading.find("PageSkeleton").length, 1);
  assert.equal(loading.find("Link").length, 0);
  assert.match(profileFixture({ failed: true }).text(), /Retry/);
});

test("Phase 7 logout navigates only after successful sign-out and surfaces failure inside Profile", async () => {
  const navigated = [];
  let success = false;
  const ui = profileFixture({
    logout: async () => success,
    navigate: async (value) => navigated.push(value),
  });
  ui.button("Sign out").props.onClick();
  await ui.flush();
  assert.match(ui.text(), /Could not sign out/);
  assert.deepEqual(navigated, []);
  success = true;
  ui.button("Sign out").props.onClick();
  await ui.flush();
  assert.equal(navigated[0].to, "/auth");
});

function notifications({
  permission = "default",
  availability = { kind: "supported", reason: null },
  reconcile = async () => ({
    sdk: { User: { PushSubscription: { addEventListener() {}, removeEventListener() {} } } },
    enabled: false,
  }),
} = {}) {
  return accountUI(
    "src/components/ChallengeNotifications.tsx",
    "ChallengeNotifications",
    {
      "@/lib/challenge-push": {
        pushAvailability: () => availability,
        reconcileChallengePush: reconcile,
      },
    },
    { userId: "owner", expanded: true },
    { Notification: { permission } },
  );
}

test("Phase 7 Notifications shows not-requested/off separately from unsupported and never prompts on render", async () => {
  let reads = 0;
  const ui = notifications({
    reconcile: async () => {
      reads++;
      return { enabled: false, sdk: { User: { PushSubscription: { addEventListener() {} } } } };
    },
  });
  await ui.flush();
  assert.match(ui.text(), /Not requested/);
  assert.match(ui.text(), /Off/);
  assert.match(ui.text(), /Enable notifications/);
  assert.doesNotMatch(ui.text(), /Unsupported/);
  assert.equal(reads, 1);
  assert.equal(ui.find("details")[0].props.open, true);
});

for (const [kind, header, explanation] of [
  ["unsupported", "Unsupported", "This browser does not support push"],
  ["home-screen-required", "Open from Home Screen", "Open Tempo from Home Screen"],
  ["configuration-unavailable", "Not configured", "Notifications are not configured"],
])
  test(`Phase 7 Notifications ${kind} has truthful dedicated status`, () => {
    const ui = notifications({
      availability: { kind, reason: explanation },
      reconcile: async () => assert.fail("unavailable SDK init"),
    });
    assert.match(ui.text(), new RegExp(header));
    assert.match(ui.text(), new RegExp(explanation));
    assert.doesNotMatch(ui.text(), /permission has not been granted/);
  });

test("Phase 7 Notifications denied and temporary SDK failure remain distinct and retryable", async () => {
  const denied = notifications({ permission: "denied" });
  await denied.flush();
  assert.match(denied.text(), /Permission denied/);
  assert.doesNotMatch(denied.text(), /Unsupported/);
  const failed = notifications({
    reconcile: async () => {
      throw new Error("Temporary SDK failure");
    },
  });
  await failed.flush();
  assert.match(failed.text(), /Temporarily unavailable/);
  assert.match(failed.text(), /Retry notifications/);
});

test("Phase 7 subpage and Goal settings Back fallbacks are You; focus screens retain existing chrome rules", () => {
  const route = read("src/routes/_authenticated/profile_.notifications.tsx");
  assert.match(route, /backTo="\/profile"/);
  assert.match(route, /backLabel="You"/);
  assert.match(route, /useAuth/);
  assert.match(
    read("src/routes/_authenticated/bulk/more.tsx"),
    /dirty=\{\(nutritionDirty \|\| weeklyDirty\) && !switching\}/,
  );
  assert.match(read("src/components/AppShell.tsx"), /\/onboarding|\/bulk-onboarding/);
  assert.match(read("src/components/AppShell.tsx"), /HistoryBackLink/);
});

test("Phase 7 scoped controls retain 44+ targets, 16px inputs, safe areas, focus and reduced motion", () => {
  const styles = read("src/styles.css");
  assert.match(styles, /\.account-primary[\s\S]*min-h-13/);
  assert.match(styles, /\.account-secondary[\s\S]*min-h-12/);
  assert.match(styles, /\.account-input[\s\S]*text-base/);
  assert.match(styles, /prefers-reduced-motion/);
  for (const file of [
    "src/routes/index.tsx",
    "src/routes/auth.tsx",
    "src/components/DeleteAccountDialog.tsx",
  ])
    assert.match(read(file), /safe-area-inset-bottom/);
});

function goalSetup() {
  const calls = [],
    navigation = [];
  const ui = accountUI("src/routes/_authenticated/bulk-onboarding.tsx", "Route", {
    "@tanstack/react-router": router(async (value) => navigation.push(value)),
    "@tanstack/react-query": {
      useQueryClient: () => ({
        ...queryClient,
        fetchQuery: async () => [{ bulk_profile_id: "new-plan" }],
      }),
    },
    "@/lib/bulk-access": {
      activeBulkMemberships: (value) => value,
      bulkOwnerQueryOptions: () => ({}),
    },
    "@/lib/bulk-onboarding": recommendation,
    "@/lib/network-errors": { userFacingError: () => "Please retry" },
    "@/lib/goal-discovery": { useAcknowledgeGoal: () => async () => {} },
    "@/integrations/supabase/client": {
      supabase: {
        rpc: async (...args) => {
          calls.push(plain(args));
          return { data: "new-plan", error: null };
        },
      },
    },
  });
  return { ui, calls, navigation };
}
function setupGoal(ui, experience = "Beginner") {
  ui.button("Bulk").props.onClick();
  ui.find("input")[0].props.onChange(event("70"));
  ui.find("input")[1].props.onChange(event("75"));
  ui.button("Continue").props.onClick();
  ui.button(experience).props.onClick();
  ui.button("3").props.onClick();
  ui.button("Full/commercial gym").props.onClick();
  ui.button("Continue").props.onClick();
}

test("Phase 7 Goal setup keeps five steps, real answers on Back, and AI disabled", () => {
  const { ui, calls } = goalSetup();
  setupGoal(ui);
  assert.match(ui.text(), /3 of 5/);
  const ai = ui.find("button").find((node) => textOf(node).includes("Generate with AI"));
  assert.equal(ai.props.disabled, true);
  ui.button("Choose a Tempo program").props.onClick();
  ui.find("BackButton")[0].props.onClick();
  assert.equal(ui.button("3").props["aria-pressed"], true);
  ui.find("BackButton")[0].props.onClick();
  assert.equal(ui.find("input")[0].props.value, "70");
  assert.equal(ui.find("input")[1].props.value, "75");
  assert.equal(ui.button("Bulk").props["aria-pressed"], true);
  assert.equal(calls.length, 0);
  assert.equal(
    ui.find("div").find((node) => node.props.role === "progressbar").props["aria-valuemax"],
    5,
  );
});

test("Phase 7 beginner uses the unchanged recommendation and submits the same atomic onboarding fields", async () => {
  const { ui, calls, navigation } = goalSetup();
  setupGoal(ui);
  ui.button("Choose a Tempo program").props.onClick();
  ui.button("Continue").props.onClick();
  assert.match(ui.text(), /4 of 5/);
  assert.match(ui.text(), /starting targets/);
  ui.button("Use these targets").props.onClick();
  assert.match(ui.text(), /5 of 5/);
  ui.button("Create my goal plan").props.onClick();
  await ui.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "complete_goal_onboarding");
  const output = recommendation.recommendInitialNutritionTargets({
    goal: "gain",
    currentWeightKg: 70,
    targetWeightKg: 75,
    targetWeeklyGainKg: 0.25,
    trainingDaysPerWeek: 3,
  });
  assert.deepEqual(calls[0][1], {
    _goal: "gain",
    _current_weight_kg: 70,
    _target_weight_kg: 75,
    _target_weekly_gain_kg: 0.25,
    _experience_level: "beginner",
    _training_days_per_week: 3,
    _available_equipment: ["full_gym"],
    _training_setup_preference: "tempo_preset",
    _calories: output.calories,
    _protein: output.protein,
    _carbs: output.carbs,
    _fat: output.fat,
  });
  assert.equal(calls[0][1]._weekly_workout_goal, undefined); // Existing server default remains 5.
  assert.deepEqual(plain(navigation), [{ to: "/bulk", replace: true }]);
});

test("Phase 7 advanced/manual nutrition and custom program remain independent existing choices", async () => {
  const { ui, calls } = goalSetup();
  setupGoal(ui, "Advanced");
  ui.button("Create my own program").props.onClick();
  ui.button("Continue").props.onClick();
  const inputs = ui.find("input");
  assert.equal(inputs.length, 4);
  inputs[0].props.onChange(event("3000"));
  ui.button("Continue").props.onClick();
  ui.find("BackButton")[0].props.onClick();
  assert.equal(ui.find("input")[0].props.value, "3000");
  ui.button("Continue").props.onClick();
  ui.button("Create my goal plan").props.onClick();
  await ui.flush();
  assert.equal(calls[0][1]._training_setup_preference, "custom");
  assert.equal(calls[0][1]._calories, 3000);
});

test("Phase 7 auth still exposes labelled credentials and Google provider with real pending/error state", async () => {
  const pending = deferred();
  const calls = [];
  const ui = accountUI("src/routes/auth.tsx", "Route", {
    "@tanstack/react-router": router(),
    "@/integrations/supabase/client": {
      supabase: {
        auth: {
          getSession: async () => ({ data: {} }),
          signInWithPassword: (value) => {
            calls.push(value);
            return pending.promise;
          },
        },
      },
    },
    "@/integrations/lovable": { lovable: {} },
    "@/lib/auth": { syncProfile: async () => {} },
    "@/lib/network-errors": { userFacingError: () => "Unable to sign in. Try again." },
    "@/lib/pending-destination": {
      takeDestination: () => null,
      sanitizeDestination: (value) => value,
      rememberDestination() {},
    },
  });
  assert.match(ui.text(), /Welcome back/);
  assert.match(ui.text(), /Continue with Google/);
  assert.deepEqual(
    ui.find("input").map((node) => node.props.id),
    ["auth-email", "auth-password"],
  );
  ui.find("input")[0].props.onChange(event("someone@tempo.test"));
  ui.find("input")[1].props.onChange(event("test-password"));
  ui.find("form")[0].props.onSubmit(event());
  assert.match(ui.text(), /Signing in/);
  assert.equal(ui.button("Signing in…").props.disabled, true);
  assert.equal(ui.button("Continue with Google").props.disabled, true);
  pending.resolve({ data: {}, error: new Error("invalid") });
  await ui.flush();
  assert.match(ui.text(), /Unable to sign in/);
  assert.equal(ui.button("Sign in").props.disabled, false);
  assert.deepEqual(plain(calls), [{ email: "someone@tempo.test", password: "test-password" }]);
});

for (const flow of ["restored session", "password", "Google"]) {
  test(`auth ${flow} redirects once after profile sync and preserves its pending destination`, async () => {
    const storage = new Map();
    const localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    const destinations = presentationComponent(
      "src/lib/pending-destination.ts",
      {},
      {
        localStorage,
        URL,
      },
    );
    const search = flow === "restored session" ? { redirect: "/bulk/prs?period=all#records" } : {};
    if (flow === "password") destinations.rememberDestination("/bulk/meals/history");
    const profile = deferred();
    const user = { id: "owner" };
    const session = { user };
    let sessionReads = 0;
    let profileSyncs = 0;
    const navigation = [];
    const ui = accountUI(
      "src/routes/auth.tsx",
      "Route",
      {
        "@tanstack/react-router": router((value) => navigation.push(value), search),
        "@/integrations/supabase/client": {
          supabase: {
            auth: {
              getSession: async () => {
                sessionReads++;
                return { data: { session: flow === "restored session" ? session : null } };
              },
              signInWithPassword: async () => ({ data: { user, session }, error: null }),
              getUser: async () => ({ data: { user }, error: null }),
            },
          },
        },
        "@/integrations/lovable": {
          lovable: { auth: { signInWithOAuth: async () => ({ error: null }) } },
        },
        "@/lib/auth": {
          syncProfile: async () => {
            profileSyncs++;
            await profile.promise;
          },
        },
        "@/lib/network-errors": { userFacingError: () => "Unable to sign in" },
        "@/lib/pending-destination": destinations,
      },
      {},
      { localStorage },
    );
    await ui.flush();
    ui.find("input")[0].props.onChange(event("someone@tempo.test"));
    ui.find("input")[1].props.onChange(event("test-password"));
    if (flow === "password") ui.find("form")[0].props.onSubmit(event());
    if (flow === "Google") ui.button("Continue with Google").props.onClick();
    await ui.flush();
    assert.equal(sessionReads, 1, "form/pending state does not rerun session restoration");
    assert.equal(profileSyncs, 1);
    assert.deepEqual(navigation, [], "redirect still waits for profile synchronization");
    profile.resolve();
    await ui.flush();
    await ui.flush();
    const expected =
      flow === "restored session"
        ? { href: search.redirect, replace: true }
        : flow === "password"
          ? { href: "/bulk/meals/history", replace: true }
          : { to: "/today", replace: true };
    assert.deepEqual(plain(navigation), [expected]);
    assert.equal(destinations.readDestination(), null, "pending destination is consumed once");
    assert.equal(sessionReads, 1);
    assert.equal(profileSyncs, 1);
    ui.dispose();
  });
}

for (const name of ["NutritionTargetsEditor", "WeeklyWorkoutGoalEditor"]) {
  test(`Phase 7 ${name} preserves the retry draft during the real store's optimistic rollback sequence`, async () => {
    const pending = deferred();
    const { ui, data, dirty } = editor(name, () => pending.promise);
    const old = data.targets;
    const field = name === "NutritionTargetsEditor" ? "calories" : "weeklyWorkoutGoal";
    const entered = field === "calories" ? "3000" : "4";
    ui.find("input")[0].props.onChange(event(entered));
    ui.button(field === "calories" ? "Save targets" : "Save goal").props.onClick();
    data.targets = { ...old, [field]: Number(entered) };
    ui.render();
    data.targets = old;
    pending.reject(new Error("write rejected"));
    await ui.flush();
    assert.equal(ui.find("input")[0].props.value, entered);
    assert.equal(dirty.at(-1), true);
    assert.equal(
      ui.button(field === "calories" ? "Save targets" : "Save goal").props.disabled,
      false,
    );
    assert.equal(data.targets, old);
  });
}

test("Phase 7 unsaved dialog restores focus to the still-mounted origin after Keep/Escape", () => {
  const origin = {
    isConnected: true,
    focus() {
      this.focused = true;
    },
  };
  const ui = accountUI(
    "src/components/UnsavedSettingsDialog.tsx",
    "UnsavedSettingsDialog",
    {
      "@tanstack/react-router": { useBlocker: () => ({ status: "blocked", reset() {} }) },
    },
    { dirty: true },
    {
      document: { activeElement: origin },
      HTMLElement: class {
        static [Symbol.hasInstance](value) {
          return value === origin;
        }
      },
    },
  );
  const content = ui.find("Dialog.Content")[0];
  content.props.onOpenAutoFocus();
  let prevented = false;
  content.props.onCloseAutoFocus({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(origin.focused, true);
});

test("Phase 7 explicitly confirmed Goal change bypasses the unsaved guard only for that existing reset flow", async () => {
  const pending = deferred(),
    navigated = [];
  let resets = 0;
  const ui = accountUI("src/routes/_authenticated/bulk/more.tsx", "Route", {
    "@tanstack/react-router": router(async (value) => navigated.push(value)),
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/bulk-access": {
      useMemberships: () => ({ data: [{ bulk_profile_id: "owned" }] }),
      bulkPlanModeFor: () => "public",
      deactivatePublicGoal: () => {
        resets++;
        return pending.promise;
      },
    },
    "@/lib/store": {
      useAppData: () => ({ targets: targets() }),
      useBulkMeta: () => ({ bulkId: "owned" }),
      clearBulk() {},
    },
    "@/lib/network-errors": { userFacingError: () => "Please retry" },
    "@/components/NutritionTargetsEditor": { NutritionTargetsEditor: "NutritionTargetsEditor" },
    "@/components/WeeklyWorkoutGoalEditor": { WeeklyWorkoutGoalEditor: "WeeklyWorkoutGoalEditor" },
    "@/components/UnsavedSettingsDialog": { UnsavedSettingsDialog: "UnsavedSettingsDialog" },
  });
  ui.find("NutritionTargetsEditor")[0].props.onDirtyChange(true);
  assert.equal(ui.find("UnsavedSettingsDialog")[0].props.dirty, true);
  ui.find("button")
    .find((node) => textOf(node).includes("Change goal"))
    .props.onClick();
  assert.match(ui.text(), /Unsaved target changes will be lost/);
  assert.equal(resets, 0);
  ui.button("Reset and change").props.onClick();
  assert.equal(resets, 1);
  assert.equal(ui.find("UnsavedSettingsDialog")[0].props.dirty, false);
  pending.resolve();
  await ui.flush();
  assert.deepEqual(plain(navigated), [{ to: "/bulk-onboarding", replace: true }]);
});
