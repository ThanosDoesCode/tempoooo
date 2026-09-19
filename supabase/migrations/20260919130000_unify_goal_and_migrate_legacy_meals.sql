-- Move pre-public owners onto the normal Goal lifecycle without replacing their
-- profile or rewriting any targets, logs, workouts, photos, notes, or history.

ALTER TABLE public.bulk_meal_presets ADD COLUMN IF NOT EXISTS source_key text;
DO $schema$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'bulk_meal_presets_source_key_ck'
      AND conrelid = 'public.bulk_meal_presets'::regclass
  ) THEN
    ALTER TABLE public.bulk_meal_presets
      ADD CONSTRAINT bulk_meal_presets_source_key_ck
      CHECK (source_key IS NULL OR source_key ~ '^legacy:[a-z0-9_-]{2,40}$');
  END IF;
END;
$schema$;
CREATE UNIQUE INDEX IF NOT EXISTS bulk_meal_presets_profile_source_uidx
  ON public.bulk_meal_presets(bulk_profile_id, source_key)
  WHERE source_key IS NOT NULL;

-- Capture the product cohort before changing its lifecycle state. bulk_admins is
-- retained for authorization, but it is not by itself a migration audience.
DROP TABLE IF EXISTS tempo_legacy_goal_profiles;
CREATE TEMP TABLE tempo_legacy_goal_profiles AS
SELECT profile.id, profile.owner_id
FROM public.bulk_profiles profile
JOIN public.bulk_admins admin ON admin.user_id = profile.owner_id
WHERE profile.goal_status IS NULL;

DO $cohort$
DECLARE cohort_size integer;
BEGIN
  SELECT count(*) INTO cohort_size FROM tempo_legacy_goal_profiles;
  IF cohort_size > 1 THEN
    RAISE EXCEPTION 'Legacy Goal migration expected at most one profile; found %', cohort_size;
  END IF;
  RAISE NOTICE 'Legacy Goal profiles selected for migration: %', cohort_size;
END;
$cohort$;

UPDATE public.bulk_profiles profile
SET goal_status = 'active'
WHERE profile.id IN (SELECT id FROM tempo_legacy_goal_profiles);

UPDATE public.bulk_targets targets
SET payload = CASE
  WHEN targets.payload ? 'goal' THEN targets.payload
  ELSE targets.payload || '{"goal":"gain"}'::jsonb
END
WHERE EXISTS (
  SELECT 1
  FROM tempo_legacy_goal_profiles profile
  WHERE profile.id = targets.bulk_profile_id
);

WITH legacy_profiles AS (
  SELECT profile.id,
    coalesce((SELECT max(meal.sort_order) FROM public.bulk_meal_presets meal
      WHERE meal.bulk_profile_id = profile.id), 0) AS last_order
  FROM tempo_legacy_goal_profiles profile
), presets(source_key, ordinal, name, description, calories, protein, carbs, fat) AS (
  VALUES
    ('legacy:beef', 1, 'Beef day',
      'Daily base: Milkshake; Grötbröd + cheese. Beef pasta ×2: 146 g dry ICA Spirali and 1/6 finished beef sauce batch each.',
      2900, 141, 375, 87),
    ('legacy:lentil', 2, 'Lentil day',
      'Daily base: Milkshake; Grötbröd + cheese. Lentils + rice ×2: 62.5 g dry Ben’s Original rice and 1/4 finished lentil batch each.',
      2800, 123, 362, 81),
    ('legacy:kebab', 3, 'Kebab day',
      'Daily base: Milkshake; Grötbröd + cheese. Chicken kebab ×2: 150 g chicken, 62.5 g dry rice, 2 slices Grötbröd and 10 g mayo each.',
      2835, 135, 343, 95),
    ('legacy:salmon', 4, 'Salmon day',
      'Daily base: Milkshake; Grötbröd + cheese. Salmon + rice ×2: 125 g raw salmon and 125 g dry Ben’s Original rice each. Nature Valley 42 g ×1.',
      2850, 120, 369, 96)
)
INSERT INTO public.bulk_meal_presets(
  bulk_profile_id, name, description, sort_order,
  calories, protein_g, carbs_g, fat_g, source_key
)
SELECT profile.id, preset.name, preset.description, profile.last_order + preset.ordinal,
  preset.calories, preset.protein, preset.carbs, preset.fat, preset.source_key
FROM legacy_profiles profile
CROSS JOIN presets preset
WHERE NOT EXISTS (
  SELECT 1 FROM public.bulk_meal_presets existing
  WHERE existing.bulk_profile_id = profile.id
    AND existing.source_key = preset.source_key
);

WITH ingredients(source_key, ordinal, name, quantity, unit) AS (
  VALUES
    ('legacy:beef',1,'Banana',100,'g'), ('legacy:beef',2,'Greek yoghurt 10%',200,'g'),
    ('legacy:beef',3,'Oats',100,'g'), ('legacy:beef',4,'Milk 3%',330,'ml'),
    ('legacy:beef',5,'Creatine',5,'g'), ('legacy:beef',6,'Grötbröd',2,'slice'),
    ('legacy:beef',7,'Prästost Mild 35%',40,'g'), ('legacy:beef',8,'ICA 5% minced beef',250,'g'),
    ('legacy:beef',9,'Passata',260,'g'), ('legacy:beef',10,'Olive oil',15,'g'),
    ('legacy:beef',11,'ICA Spirali dry pasta',292,'g'),
    ('legacy:lentil',1,'Banana',100,'g'), ('legacy:lentil',2,'Greek yoghurt 10%',200,'g'),
    ('legacy:lentil',3,'Oats',100,'g'), ('legacy:lentil',4,'Milk 3%',330,'ml'),
    ('legacy:lentil',5,'Creatine',5,'g'), ('legacy:lentil',6,'Grötbröd',2,'slice'),
    ('legacy:lentil',7,'Prästost Mild 35%',40,'g'), ('legacy:lentil',8,'Dry lentils',250,'g'),
    ('legacy:lentil',9,'Ben’s Original dry rice',125,'g'), ('legacy:lentil',10,'Passata',250,'g'),
    ('legacy:lentil',11,'Olive oil',20,'g'),
    ('legacy:kebab',1,'Banana',100,'g'), ('legacy:kebab',2,'Greek yoghurt 10%',200,'g'),
    ('legacy:kebab',3,'Oats',100,'g'), ('legacy:kebab',4,'Milk 3%',330,'ml'),
    ('legacy:kebab',5,'Creatine',5,'g'), ('legacy:kebab',6,'Grötbröd daily base',2,'slice'),
    ('legacy:kebab',7,'Prästost Mild 35%',40,'g'), ('legacy:kebab',8,'ICA Basic Kycklingkebab',300,'g'),
    ('legacy:kebab',9,'Ben’s Original dry rice',125,'g'), ('legacy:kebab',10,'Grötbröd main meals',4,'slice'),
    ('legacy:kebab',11,'Heinz mayo',20,'g'),
    ('legacy:salmon',1,'Banana',100,'g'), ('legacy:salmon',2,'Greek yoghurt 10%',200,'g'),
    ('legacy:salmon',3,'Oats',100,'g'), ('legacy:salmon',4,'Milk 3%',330,'ml'),
    ('legacy:salmon',5,'Creatine',5,'g'), ('legacy:salmon',6,'Grötbröd',2,'slice'),
    ('legacy:salmon',7,'Prästost Mild 35%',40,'g'), ('legacy:salmon',8,'Raw salmon',250,'g'),
    ('legacy:salmon',9,'Ben’s Original dry rice',250,'g'),
    ('legacy:salmon',10,'Nature Valley Oats & Honey 42 g',1,'pack')
)
INSERT INTO public.bulk_meal_preset_ingredients(meal_preset_id,name,quantity,unit,sort_order)
SELECT preset.id, ingredient.name, ingredient.quantity, ingredient.unit, ingredient.ordinal
FROM public.bulk_meal_presets preset
JOIN ingredients ingredient ON ingredient.source_key = preset.source_key
WHERE NOT EXISTS (
  SELECT 1 FROM public.bulk_meal_preset_ingredients existing
  WHERE existing.meal_preset_id = preset.id
);

-- Normalize the original program only when the selected legacy profile has no
-- active normalized plan. The defaults below are the exact legacy EXERCISES
-- definitions; stored legacyExerciseOrder and legacyExerciseDefinitions are
-- then applied so the persisted current plan, including additions and order,
-- wins over the defaults.
CREATE TEMP TABLE tempo_legacy_plan_import(profile_id uuid PRIMARY KEY, plan_id uuid NOT NULL);

WITH inserted AS (
  INSERT INTO public.bulk_training_plans(
    bulk_profile_id,plan_type,name,description,experience_level,training_days_per_week
  )
  SELECT profile.id,'custom','Original Tempo program',
    'The current preserved Chest & Back, Legs and Arms program from the original Goal plan.',
    'intermediate',3
  FROM tempo_legacy_goal_profiles profile
  WHERE NOT EXISTS (
    SELECT 1 FROM public.bulk_training_plans plan
    WHERE plan.bulk_profile_id = profile.id AND plan.active
  )
  RETURNING bulk_profile_id, id
)
INSERT INTO tempo_legacy_plan_import(profile_id,plan_id)
SELECT bulk_profile_id,id FROM inserted;

INSERT INTO public.bulk_training_plan_days(plan_id,day_order,name)
SELECT imported.plan_id, day.day_order, day.day_name
FROM tempo_legacy_plan_import imported
CROSS JOIN (VALUES
  (1,'Chest & Back'),(2,'Legs'),(3,'Arms')
) AS day(day_order,day_name);

CREATE TEMP TABLE tempo_legacy_exercise_seed(
  profile_id uuid NOT NULL,
  split_name text NOT NULL,
  canonical_order integer NOT NULL,
  legacy_name text NOT NULL,
  display_name text NOT NULL,
  system_exercise_id text,
  sets integer NOT NULL,
  rep_min integer NOT NULL,
  rep_max integer NOT NULL
);

INSERT INTO tempo_legacy_exercise_seed
SELECT imported.profile_id,seed.*
FROM tempo_legacy_plan_import imported
CROSS JOIN (VALUES
  ('Chest & Back',1,'Incline Dumbbell Press','Dumbbell Incline Press','system:incline-dumbbell-bench-press',3,6,10),
  ('Chest & Back',2,'Cable Low-to-High Fly','Cable Low-to-High','system:low-to-high-cable-fly',3,10,15),
  ('Chest & Back',3,'Pull-Ups','Pull-Ups','system:pull-up',3,5,10),
  ('Chest & Back',4,'Cable Rows','Cable Rows','system:seated-cable-row',3,8,12),
  ('Chest & Back',5,'Face Pulls','Face Pulls','system:face-pull',3,12,18),
  ('Legs',1,'Leg Extensions','Leg Extensions','system:leg-extension',3,10,15),
  ('Legs',2,'Declined Leg Press','Declined Leg Press','system:decline-leg-press',3,8,12),
  ('Legs',3,'Romanian Deadlifts','Romanian Deadlifts','system:barbell-romanian-deadlift',3,6,10),
  ('Legs',4,'Leg Curls','Leg Curls','system:seated-leg-curl',3,10,15),
  ('Legs',5,'Calf Raises','Calf Raises','system:standing-calf-raise',3,12,20),
  ('Legs',6,'Cable Crunches','Cable Crunches','system:cable-crunch',3,10,15),
  ('Legs',7,'Hanging Leg Raises','Hanging Leg Raises','system:hanging-leg-raise',3,8,15),
  ('Arms & Shoulders',1,'Chin-Ups','Chin-Ups','system:chin-up',3,5,10),
  ('Arms & Shoulders',2,'Incline Dumbbell Curls','Incline Bicep Curls','system:incline-dumbbell-curl',3,8,12),
  ('Arms & Shoulders',3,'Tricep Pushdowns','Tricep Pushdowns','system:cable-triceps-pushdown',3,10,15),
  ('Arms & Shoulders',4,'Overhead Tricep Extensions','Overhead Tricep Extensions','system:dumbbell-overhead-triceps-extension',3,10,15),
  ('Arms & Shoulders',5,'Lateral Raises','Lateral Raises','system:dumbbell-lateral-raise',3,12,18),
  ('Arms & Shoulders',6,'Cable Crunches','Cable Crunches','system:cable-crunch',3,10,15),
  ('Arms & Shoulders',7,'Hanging Leg Raises','Hanging Leg Raises','system:hanging-leg-raise',3,8,15)
) AS seed(
  split_name,canonical_order,legacy_name,display_name,system_exercise_id,
  sets,rep_min,rep_max
);

INSERT INTO tempo_legacy_exercise_seed(
  profile_id,split_name,canonical_order,legacy_name,display_name,
  system_exercise_id,sets,rep_min,rep_max
)
SELECT imported.profile_id, split.key, 100 + definition.ordinality,
  definition.value->>'name', definition.value->>'name', NULL, 3,
  CASE WHEN definition.value->>'min' ~ '^[0-9]+$'
    THEN greatest(1,least(100,(definition.value->>'min')::integer)) ELSE 8 END,
  CASE WHEN definition.value->>'max' ~ '^[0-9]+$'
    THEN greatest(1,least(100,(definition.value->>'max')::integer)) ELSE 12 END
FROM tempo_legacy_plan_import imported
JOIN public.bulk_targets targets ON targets.bulk_profile_id = imported.profile_id
CROSS JOIN LATERAL pg_catalog.jsonb_each(
  CASE WHEN pg_catalog.jsonb_typeof(targets.payload->'legacyExerciseDefinitions') = 'object'
    THEN targets.payload->'legacyExerciseDefinitions' ELSE '{}'::jsonb END
) split
CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
  CASE WHEN pg_catalog.jsonb_typeof(split.value) = 'array' THEN split.value ELSE '[]'::jsonb END
) WITH ORDINALITY definition(value,ordinality)
WHERE split.key IN ('Chest & Back','Legs','Arms & Shoulders')
  AND definition.value->>'name' IS NOT NULL
  AND char_length(btrim(definition.value->>'name')) BETWEEN 2 AND 80
  AND NOT EXISTS (
    SELECT 1 FROM tempo_legacy_exercise_seed base
    WHERE base.profile_id = imported.profile_id
      AND base.split_name = split.key
      AND base.legacy_name = definition.value->>'name'
  );

-- The existing validation trigger checks custom-exercise ownership through
-- auth.uid(). Set the one selected legacy owner only for this transactional
-- import, then clear it immediately afterward.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  coalesce((
    SELECT profile.owner_id::text
    FROM tempo_legacy_goal_profiles profile
    JOIN tempo_legacy_plan_import imported ON imported.profile_id = profile.id
  ),''),
  true
);

WITH ordered AS (
  SELECT seed.*,
    coalesce(saved.saved_order,1000 + seed.canonical_order) AS resolved_order,
    row_number() OVER (
      PARTITION BY seed.profile_id,seed.split_name
      ORDER BY coalesce(saved.saved_order,1000 + seed.canonical_order),seed.canonical_order
    ) AS exercise_order
  FROM tempo_legacy_exercise_seed seed
  JOIN public.bulk_targets targets ON targets.bulk_profile_id = seed.profile_id
  LEFT JOIN LATERAL (
    SELECT item.ordinality::integer AS saved_order
    FROM pg_catalog.jsonb_array_elements_text(
      CASE WHEN pg_catalog.jsonb_typeof(
        targets.payload->'legacyExerciseOrder'->seed.split_name
      ) = 'array'
      THEN targets.payload->'legacyExerciseOrder'->seed.split_name ELSE '[]'::jsonb END
    ) WITH ORDINALITY item(value,ordinality)
    WHERE item.value = seed.legacy_name
    LIMIT 1
  ) saved ON true
), resolved AS (
  SELECT ordered.*, matched.id AS matched_id, matched.owner_id AS matched_owner
  FROM ordered
  LEFT JOIN LATERAL (
    SELECT exercise.id,exercise.owner_id
    FROM public.bulk_exercises exercise
    JOIN tempo_legacy_goal_profiles profile ON profile.id = ordered.profile_id
    WHERE ordered.system_exercise_id IS NULL
      AND exercise.name IN (ordered.legacy_name,ordered.display_name)
      AND (exercise.owner_id IS NULL OR exercise.owner_id = profile.owner_id)
    ORDER BY (exercise.owner_id = profile.owner_id) DESC NULLS LAST, exercise.id
    LIMIT 1
  ) matched ON true
)
INSERT INTO public.bulk_training_plan_exercises(
  plan_day_id,exercise_id,source_system_exercise_id,exercise_name,
  exercise_order,sets,rep_min,rep_max
)
SELECT day.id,coalesce(resolved.system_exercise_id,resolved.matched_id),
  CASE WHEN resolved.system_exercise_id IS NOT NULL THEN resolved.system_exercise_id
    WHEN resolved.matched_owner IS NULL THEN resolved.matched_id ELSE NULL END,
  resolved.display_name,resolved.exercise_order,resolved.sets,resolved.rep_min,
  greatest(resolved.rep_min,resolved.rep_max)
FROM resolved
JOIN tempo_legacy_plan_import imported ON imported.profile_id = resolved.profile_id
JOIN public.bulk_training_plan_days day ON day.plan_id = imported.plan_id
  AND day.day_order = CASE resolved.split_name
    WHEN 'Chest & Back' THEN 1 WHEN 'Legs' THEN 2 ELSE 3 END;

SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);

DROP TABLE tempo_legacy_exercise_seed;
DROP TABLE tempo_legacy_plan_import;
DROP TABLE tempo_legacy_goal_profiles;

COMMENT ON COLUMN public.bulk_meal_presets.source_key IS
  'Server-managed idempotency key for one-time compatibility imports; null for user-created presets.';
