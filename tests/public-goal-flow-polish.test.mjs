import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("completed public workouts stay in Training history", async () => {
  const [session, trainingHistory, mealHistory, legacyHistory, navigation] = await Promise.all([
    read("src/components/BulkWorkoutSession.tsx"),
    read("src/routes/_authenticated/bulk/training_.history.tsx"),
    read("src/routes/_authenticated/bulk/meals_.history.tsx"),
    read("src/routes/_authenticated/bulk/history.tsx"),
    read("src/lib/product-navigation.ts"),
  ]);
  assert.match(
    session,
    /Workout completed[\s\S]*navigate\(\{ to: "\/bulk\/training\/history" \}\)/,
  );
  assert.doesNotMatch(session, /Workout completed[\s\S]{0,200}to: "\/bulk\/history"/);
  assert.match(trainingHistory, /fetchRecentCompletedBulkTrainingSessions/);
  assert.match(trainingHistory, /CompletedWorkout/);
  assert.doesNotMatch(trainingHistory, /useBulkNutritionDay|Logged meals and entries/);
  assert.match(mealHistory, /useBulkNutritionDay/);
  assert.doesNotMatch(mealHistory, /CompletedWorkout|fetchRecentCompletedBulkTrainingSessions/);
  assert.match(legacyHistory, /Navigate to="\/bulk\/training\/history" replace/);
  assert.match(navigation, /pathname\.startsWith\("\/bulk\/history"\)\) return "goal"/);
});

test("training plan switching is visible, transactional and preserves completed history", async () => {
  const [more, setup, query, migration] = await Promise.all([
    read("src/routes/_authenticated/bulk/training_.more.tsx"),
    read("src/components/TrainingPlanSetup.tsx"),
    read("src/lib/training-plans-query.ts"),
    read("supabase/migrations/20260908120000_public_goal_mobile_flow_hardening.sql"),
  ]);
  assert.match(more, /Change plan/);
  assert.match(more, /useActiveBulkTrainingSession/);
  assert.match(more, /Finish or discard your current workout before changing plans\./);
  assert.match(more, /<TrainingPlanSetup[\s\S]*replacingPlan/);
  assert.match(setup, /replacingPlan \? "Training plan changed" : "Training plan created"/);
  assert.match(query, /switch_bulk_training_plan/);
  assert.match(query, /switch_to_empty_bulk_training_plan/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /status = 'in_progress'/);
  assert.match(migration, /UPDATE public\.bulk_training_plans SET active = false/);
  assert.doesNotMatch(migration, /DELETE FROM public\.bulk_training_sessions/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.switch_bulk_training_plan/);
});

test("inactive public Goal access is hidden without changing legacy My Bulk", async () => {
  const [access, mode, guard, profile, onboarding, migration] = await Promise.all([
    read("src/lib/bulk-access.ts"),
    read("src/lib/bulk-mode.ts"),
    read("src/routes/_authenticated/bulk/route.tsx"),
    read("src/routes/_authenticated/profile.tsx"),
    read("src/routes/_authenticated/bulk-onboarding.tsx"),
    read("supabase/migrations/20260908120000_public_goal_mobile_flow_hardening.sql"),
  ]);
  assert.match(mode, /membership\.is_active !== false/);
  assert.match(access, /goal_status/);
  assert.match(access, /is_active: profile\?\.goal_status !== "inactive"/);
  assert.match(guard, /preferredBulkMembership/);
  assert.match(profile, /deactivatePublicGoal/);
  assert.match(profile, /clearBulk\(\)/);
  assert.match(profile, /is_active: false/);
  assert.match(profile, /startsWith\("bulk"\)/);
  assert.match(onboarding, /complete_goal_onboarding/);
  assert.match(migration, /goal_status IS NULL OR goal_status IN \('active', 'inactive'\)/);
  assert.match(
    migration,
    /WHERE targets\.bulk_profile_id = profile\.id[\s\S]*trainingSetupPreference/,
  );
  assert.match(migration, /Legacy My Bulk profiles cannot be converted/);
  assert.match(migration, /DELETE FROM public\.bulk_targets/);
  assert.match(migration, /SET goal_status = 'inactive'/);
  assert.doesNotMatch(migration, /DELETE FROM public\.bulk_training_sessions/);
});

test("public Meals never falls back to legacy presets and future dates are read-only", async () => {
  const [today, mealsRoute, goalToday, presetRoute, presets, legacy, query, migration, guard] =
    await Promise.all([
      read("src/components/BulkNutritionLog.tsx"),
      read("src/routes/_authenticated/bulk/meals.tsx"),
      read("src/routes/_authenticated/bulk/index.tsx"),
      read("src/routes/_authenticated/bulk/meals_.presets.tsx"),
      read("src/lib/bulk-meal-presets-query.ts"),
      read("src/lib/meals.ts"),
      read("src/lib/bulk-nutrition-query.ts"),
      read("supabase/migrations/20260908120000_public_goal_mobile_flow_hardening.sql"),
      read("src/routes/_authenticated/bulk/route.tsx"),
    ]);
  assert.match(today, /No meal presets yet/);
  assert.match(today, /Create meals you eat often so logging them later is fast\./);
  assert.match(today, /to="\/bulk\/meals\/presets"/);
  for (const legacyName of ["Beef day", "Lentil day", "Kebab day", "Salmon day"])
    assert.doesNotMatch(today, new RegExp(legacyName));
  assert.match(presets, /\.eq\("bulk_profile_id", bulkProfileId\)/);
  assert.match(presetRoute, /planMode === "legacy"[\s\S]*Navigate to="\/bulk"/);
  assert.match(presetRoute, /bulkId && planMode === "public"/);
  assert.match(guard, /bulkId !== preferred\.bulk_profile_id/);
  assert.match(legacy, /Beef day/);
  assert.match(mealsRoute, /bulkPlanModeFor\(memberships\.data, bulkId\)/);
  assert.match(mealsRoute, /publicNutrition = planMode === "public"/);
  assert.doesNotMatch(mealsRoute, /publicNutrition = !!data\?\.targets\.trainingSetupPreference/);
  assert.match(mealsRoute, /publicNutrition \? \([\s\S]*<BulkNutritionLog/);
  assert.match(goalToday, /const isPublicGoal = planMode === "public"/);
  assert.match(goalToday, /const plan = isPublicGoal \? undefined : mealPlan/);
  assert.match(
    goalToday,
    /isPublicGoal \? \([\s\S]*Open Meals Today[\s\S]*\) : \([\s\S]*MEAL_PLANS\.map/,
  );
  assert.match(today, /const isFuture = selectedDate > today/);
  assert.match(today, /Future days are view-only\. Come back on this date to log meals\./);
  assert.match(today, /isFuture \? null : editor/);
  assert.match(query, /_local_today: localToday\(\)/g);
  assert.match(migration, /IF _log_date > _local_today/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.delete_bulk_nutrition_entry\(uuid\)/);
});
