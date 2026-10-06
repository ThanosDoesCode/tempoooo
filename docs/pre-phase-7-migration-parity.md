# Pre-Phase-7 production migration parity

This checklist is read-only. The completeness fixes require **no new migration**. Do not reconnect infrastructure, apply pending migrations, change secrets or publish while verifying parity.

The latest repository migration is `20261005140000_owner_workout_history_actions.sql`. The current app expects the accumulated schema from all 66 migrations listed below. A latest-version match alone does not prove that earlier migrations or their required definitions are present.

## Required feature dependencies

| App feature                        | Important migrations (on top of the full baseline)                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private Goal ownership             | `20260902222312_bulk_owner_only.sql`, security hardening migrations                                                                                                                                                                                                                                                                                                                                                       |
| Public Goal activation/setup       | `20260905120000_public_bulk_activation.sql`, `20260905150000_complete_bulk_onboarding.sql`, `20260907130000_public_goal_modes.sql`                                                                                                                                                                                                                                                                                        |
| Unified Goal/legacy compatibility  | `20260912130000_distinguish_legacy_goal_profiles.sql`, `20260919130000_unify_goal_and_migrate_legacy_meals.sql`, `20260922120000_unified_goal_legacy_nutrition_compatibility.sql`                                                                                                                                                                                                                                         |
| Meal presets and logging snapshots | `20260906200000_public_bulk_meal_presets.sql`, `20260906210000_public_bulk_nutrition_logs.sql`, `20261005130000_meal_preset_quick_add_visibility.sql`                                                                                                                                                                                                                                                                     |
| Weight/photo/weekly progress       | `20260906220000_public_bulk_progress.sql`, `20260906230000_apply_bulk_calorie_recommendation.sql`, `20261005120000_save_goal_weight_local_day.sql`                                                                                                                                                                                                                                                                        |
| Training and historical actions    | `20260905180000_bulk_training_plans.sql`, `20260906120000_edit_bulk_training_plans.sql`, `20260906180000_public_bulk_workout_sessions.sql`, `20260915120000_workout_set_metadata.sql`, `20260922130000_owner_completed_workout_deletion.sql`, `20260923120000_snapshot_public_workout_bodyweight.sql`, `20260927120000_perf_completed_session_workout_date_index.sql`, `20261005140000_owner_workout_history_actions.sql` |
| Challenge summaries/pending flow   | `20261002120000_challenge_activity_summaries.sql`, `20261003220000_variable_challenge_lengths.sql`, earlier Challenge terms/invitation/target/evidence/push migrations                                                                                                                                                                                                                                                    |
| Identity/account security          | Username/onboarding, profile bootstrap and server-only RPC migrations, including the two `20260906203135`/`20260906203157` Lovable migrations                                                                                                                                                                                                                                                                             |

## Manual verification steps

1. Open the existing Tempo project in Lovable. Confirm its connected repository/branch and published revision. Use that project's existing Cloud database administration/read-only inspection mechanism; do not create or link another Supabase project.
2. Ask Lovable to inspect the production migration journal **without applying anything**, and return every applied version and name in ascending order. If its existing SQL inspector is available, the following queries are read-only. First confirm the journal exists:

   ```sql
   SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS migration_journal;
   ```

   If present:

   ```sql
   SELECT version, name
   FROM supabase_migrations.schema_migrations
   ORDER BY version;
   ```

   If Lovable uses another journal or denies access, ask it for its equivalent applied-migration inventory. Do not infer parity from a missing/inaccessible journal, and do not change permissions to access it.

3. Compare **all versions** with the inventory below. Record missing/extra versions and whether each missing file's effects were applied through a documented equivalent. Version names alone are insufficient if an old file changed after application; confirm the relevant definitions too. Do not apply a repair until discrepancies have been reviewed.
4. Inspect the public columns the app reads. Confirm Goal profiles/membership, legacy tables, normalized weights/photos/nutrition/presets/session snapshots, `source_key`, `show_in_quick_add`, `workout_date`, `bodyweight_kg`, `set_type` and `rpe` are present with the expected types. One read-only inventory query:

   ```sql
   SELECT table_name, column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN (
       'bulk_profiles', 'bulk_members', 'bulk_days', 'bulk_workouts',
       'bulk_week_notes', 'bulk_photos', 'bulk_weight_entries',
       'bulk_progress_photos', 'bulk_nutrition_days', 'bulk_nutrition_entries',
       'bulk_meal_presets', 'bulk_meal_preset_ingredients',
       'bulk_training_sessions', 'bulk_training_session_exercises',
       'bulk_training_session_sets', 'challenge_activities', 'challenge_weeks'
     )
   ORDER BY table_name, ordinal_position;
   ```

5. Confirm runtime RPC definitions/signatures and grants against their repository migration files. In particular: local-day weight save; preset CRUD/order/visibility; nutrition entry CRUD; session start-for-date/bodyweight refresh; completed/legacy workout correction/repeat/delete; Challenge summary and server-only creation/invitation/disable/registration. Lovable's existing inspector can show these without calling the mutations:

   ```sql
   SELECT n.nspname AS schema_name, p.proname,
          pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
          p.prosecdef AS security_definer, p.proconfig,
          pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
          pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
          pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private')
   ORDER BY n.nspname, p.proname, arguments;
   ```

   Inspect definitions through the admin UI or `pg_get_functiondef` where needed. Do not execute write RPCs for this check. Sensitive server-only RPCs must stay unavailable to anon/authenticated; ordinary owner RPCs must retain their intended owner checks. Local-day save and visibility stay INVOKER. DEFINER functions keep a locked search path.

6. Confirm RLS remains enabled and policy definitions match the owner/member expectations. Check `bulk-progress-photos`, `challenge-evidence` and `payment-evidence` remain private in Storage. Read-only metadata checks:

   ```sql
   SELECT c.relname, c.relrowsecurity
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname;

   SELECT tablename, policyname, roles, cmd, qual, with_check
   FROM pg_catalog.pg_policies
   WHERE schemaname IN ('public', 'storage')
   ORDER BY schemaname, tablename, policyname;

   SELECT id, public FROM storage.buckets
   WHERE id IN ('bulk-progress-photos', 'challenge-evidence', 'payment-evidence');
   ```

7. Record the project, deployed revision, applied inventory and discrepancies. Mark parity **confirmed**, **mismatch**, or **unknown**. Run the previously supplied physical-iPhone smoke checklist only after the schema is confirmed; use disposable data for write/destructive tests.

No production inspection was performed by this task. Local migration/security tests validate the repository's accumulated schema, not its deployment status.

## Full repository migration inventory

- `20260814022015_2e6c5c26-4d84-4ec5-a74b-36c614623b97.sql`
- `20260814022039_a4508108-1cc7-479d-949a-b9c26467ac2d.sql`
- `20260814143430_2c909928-8ccd-4784-9d54-bbd086828faa.sql`
- `20260814145032_ea45b464-4b54-4add-82ee-9ebd9d79ae9f.sql`
- `20260814150619_c50d55bd-134d-4fb0-b510-f3bed3293d95.sql`
- `20260814150642_0be606ac-f06c-444b-b561-66425b8ce143.sql`
- `20260814150955_9ea42df0-7e62-4727-8aa2-9d1bf14d02b6.sql`
- `20260814151634_9178a2ab-a909-4b68-9047-53f298932be0.sql`
- `20260814151705_2365cca5-6280-4960-8bc4-80d866a551b7.sql`
- `20260814152404_100eff0c-b0f9-4c78-9028-b2af4a3d7d40.sql`
- `20260814163331_27296569-7af2-424e-95d5-3b3b82d6736c.sql`
- `20260814163529_1528d60b-66e3-4803-ba8e-984d8a2dcf8a.sql`
- `20260814163932_46a61986-270e-4059-a1b0-652f294633ca.sql`
- `20260814165736_9b1b1cf3-5f82-46bf-9283-2ba650fb053b.sql`
- `20260818140640_66811616-7c9b-4c6a-9d9f-3c7318e4c325.sql`
- `20260819233321_0dad5a03-1363-41f0-90e7-c5e5fba1cd8e.sql`
- `20260831120000_challenge_push_notifications.sql`
- `20260831130000_fix_challenge_activity_audit_rls.sql`
- `20260901071913_7a34c06c-41c4-494a-b9b4-04a5c4180404.sql`
- `20260902090025_283abf6d-2281-44d4-a57d-3b7e461b03f9.sql`
- `20260902120000_challenge_rules_qualification_travel_stats.sql`
- `20260902222312_bulk_owner_only.sql`
- `20260903120000_create_challenge_atomic.sql`
- `20260903170000_challenge_evidence_lifecycle.sql`
- `20260903180000_evidence_cleanup_worker.sql`
- `20260904120000_configurable_challenge_terms.sql`
- `20260904170000_add_custom_challenge_penalties.sql`
- `20260904180000_configurable_travel_pause_terms.sql`
- `20260904190000_restore_push_device_after_login.sql`
- `20260905120000_public_bulk_activation.sql`
- `20260905150000_complete_bulk_onboarding.sql`
- `20260905170000_bulk_exercise_library.sql`
- `20260905180000_bulk_training_plans.sql`
- `20260906120000_edit_bulk_training_plans.sql`
- `20260906180000_public_bulk_workout_sessions.sql`
- `20260906190000_security_audit_hardening.sql`
- `20260906200000_public_bulk_meal_presets.sql`
- `20260906203135_29222c8c-372a-43b8-acaa-6b8731640d9b.sql`
- `20260906203157_29dffced-45c0-45df-ba84-79daadddd328.sql`
- `20260906210000_public_bulk_nutrition_logs.sql`
- `20260906220000_public_bulk_progress.sql`
- `20260906230000_apply_bulk_calorie_recommendation.sql`
- `20260906235900_release_validation_hardening.sql`
- `20260907120000_secure_future_challenge_targets.sql`
- `20260907130000_public_goal_modes.sql`
- `20260907140000_goal_discoverability.sql`
- `20260908120000_public_goal_mobile_flow_hardening.sql`
- `20260909120000_account_onboarding_usernames.sql`
- `20260911005525_69ba1439-bb8d-44c9-940f-a12a5fdd6fa4.sql`
- `20260912010937_ad8c95ae-82a7-42fc-9d99-fde06de32ae5.sql`
- `20260912120000_restore_profile_bootstrap_upsert.sql`
- `20260912130000_distinguish_legacy_goal_profiles.sql`
- `20260914215259_df3f4ee5-b88f-477a-a9c2-b8d874702948.sql`
- `20260915120000_workout_set_metadata.sql`
- `20260919120000_account_deletion_and_in_app_challenge_invites.sql`
- `20260919130000_unify_goal_and_migrate_legacy_meals.sql`
- `20260922120000_unified_goal_legacy_nutrition_compatibility.sql`
- `20260922130000_owner_completed_workout_deletion.sql`
- `20260923120000_snapshot_public_workout_bodyweight.sql`
- `20260927120000_perf_completed_session_workout_date_index.sql`
- `20261001120000_harden_private_image_uploads.sql`
- `20261002120000_challenge_activity_summaries.sql`
- `20261003220000_variable_challenge_lengths.sql`
- `20261005120000_save_goal_weight_local_day.sql`
- `20261005130000_meal_preset_quick_add_visibility.sql`
- `20261005140000_owner_workout_history_actions.sql`
