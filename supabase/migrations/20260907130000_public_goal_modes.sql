-- Public plans use the existing bulk_targets JSON payload. Legacy private plans
-- have no trainingSetupPreference and are intentionally left unchanged.
UPDATE public.bulk_targets
SET payload = pg_catalog.jsonb_set(payload, '{goal}', '"gain"'::jsonb, true)
WHERE payload ? 'trainingSetupPreference' AND NOT payload ? 'goal';

ALTER TABLE public.bulk_targets DROP CONSTRAINT bulk_targets_onboarding_payload_ck;
ALTER TABLE public.bulk_targets
  ADD CONSTRAINT bulk_targets_onboarding_payload_ck CHECK (
    CASE WHEN payload ? 'trainingSetupPreference'
      THEN payload->>'goal' IN ('gain', 'cut', 'maintain')
      ELSE true END
    AND CASE WHEN payload ? 'startWeight'
      THEN jsonb_typeof(payload->'startWeight') = 'number'
        AND (payload->>'startWeight')::numeric BETWEEN 20 AND 400
      ELSE true END
    AND CASE WHEN payload ? 'targetWeight'
      THEN jsonb_typeof(payload->'targetWeight') = 'number'
        AND (payload->>'targetWeight')::numeric BETWEEN 20 AND 450
      ELSE true END
    AND CASE WHEN payload ? 'startWeight' AND payload ? 'targetWeight'
      AND jsonb_typeof(payload->'startWeight') = 'number'
      AND jsonb_typeof(payload->'targetWeight') = 'number'
      THEN CASE
        WHEN payload->>'goal' = 'cut'
          THEN (payload->>'targetWeight')::numeric < (payload->>'startWeight')::numeric
        WHEN payload->>'goal' = 'maintain'
          THEN abs((payload->>'targetWeight')::numeric - (payload->>'startWeight')::numeric)
            <= greatest(2, (payload->>'startWeight')::numeric * 0.05)
        ELSE (payload->>'targetWeight')::numeric > (payload->>'startWeight')::numeric
      END
      ELSE true END
    AND CASE WHEN payload ? 'targetWeeklyGainKg'
      THEN jsonb_typeof(payload->'targetWeeklyGainKg') = 'number'
        AND CASE
          WHEN payload->>'goal' = 'cut'
            THEN (payload->>'targetWeeklyGainKg')::numeric BETWEEN 0.05 AND 1.5
          WHEN payload->>'goal' = 'maintain'
            THEN (payload->>'targetWeeklyGainKg')::numeric = 0
          ELSE (payload->>'targetWeeklyGainKg')::numeric BETWEEN 0.05 AND 1.5
        END
      ELSE true END
    AND CASE WHEN payload ? 'experienceLevel'
      THEN payload->>'experienceLevel' IN ('beginner', 'intermediate', 'advanced')
      ELSE true END
    AND CASE WHEN payload ? 'trainingDaysPerWeek'
      THEN jsonb_typeof(payload->'trainingDaysPerWeek') = 'number'
        AND (payload->>'trainingDaysPerWeek')::numeric IN (2, 3, 4, 5, 6)
      ELSE true END
    AND CASE WHEN payload ? 'availableEquipment'
      THEN jsonb_typeof(payload->'availableEquipment') = 'array'
        AND jsonb_array_length(payload->'availableEquipment') > 0
        AND payload->'availableEquipment' <@ '["full_gym","barbell","dumbbells","cables","machines","bench","pull_up_bar","bodyweight_only"]'::jsonb
        AND NOT (payload->'availableEquipment' ? 'bodyweight_only'
          AND jsonb_array_length(payload->'availableEquipment') > 1)
      ELSE true END
    AND CASE WHEN payload ? 'trainingSetupPreference'
      THEN payload->>'trainingSetupPreference' IN ('generated', 'tempo_preset', 'custom')
      ELSE true END
    AND CASE WHEN payload ? 'calories'
      THEN jsonb_typeof(payload->'calories') = 'number'
        AND (payload->>'calories')::numeric BETWEEN 800 AND 10000
      ELSE true END
    AND CASE WHEN payload ? 'protein'
      THEN jsonb_typeof(payload->'protein') = 'number'
        AND (payload->>'protein')::numeric BETWEEN 1 AND 1000
      ELSE true END
    AND CASE WHEN payload ? 'carbs'
      THEN jsonb_typeof(payload->'carbs') = 'number'
        AND (payload->>'carbs')::numeric BETWEEN 1 AND 1000
      ELSE true END
    AND CASE WHEN payload ? 'fat'
      THEN jsonb_typeof(payload->'fat') = 'number'
        AND (payload->>'fat')::numeric BETWEEN 1 AND 1000
      ELSE true END
    AND CASE WHEN payload ? 'onboardingCompletedAt'
      THEN jsonb_typeof(payload->'onboardingCompletedAt') = 'string'
      ELSE true END
  ) NOT VALID;

DROP FUNCTION public.complete_bulk_onboarding(
  numeric,numeric,numeric,text,integer,text[],text,integer,integer,integer,integer
);

CREATE FUNCTION public.complete_bulk_onboarding(
  _goal text,
  _current_weight_kg numeric,
  _target_weight_kg numeric,
  _target_weekly_gain_kg numeric,
  _experience_level text,
  _training_days_per_week integer,
  _available_equipment text[],
  _training_setup_preference text,
  _calories integer,
  _protein integer,
  _carbs integer,
  _fat integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller uuid := (SELECT auth.uid());
  plan_id uuid;
  normalized_equipment text[];
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text, 0));
  IF _goal IS NULL OR _goal NOT IN ('gain', 'cut', 'maintain')
    THEN RAISE EXCEPTION 'Invalid goal'; END IF;
  IF _current_weight_kg IS NULL OR _current_weight_kg < 20 OR _current_weight_kg > 400
    THEN RAISE EXCEPTION 'Invalid current weight'; END IF;
  IF _target_weight_kg IS NULL OR _target_weight_kg < 20 OR _target_weight_kg > 450
    THEN RAISE EXCEPTION 'Invalid target weight'; END IF;
  IF (_goal = 'gain' AND _target_weight_kg <= _current_weight_kg)
    OR (_goal = 'cut' AND _target_weight_kg >= _current_weight_kg)
    OR (_goal = 'maintain' AND abs(_target_weight_kg - _current_weight_kg)
      > greatest(2, _current_weight_kg * 0.05))
    THEN RAISE EXCEPTION 'Invalid target weight for the selected goal'; END IF;
  IF (_goal = 'gain' AND _target_weekly_gain_kg NOT BETWEEN 0.05 AND 1.5)
    OR (_goal = 'cut' AND _target_weekly_gain_kg NOT BETWEEN 0.05 AND 1.5)
    OR (_goal = 'maintain' AND _target_weekly_gain_kg <> 0)
    OR _target_weekly_gain_kg IS NULL
    THEN RAISE EXCEPTION 'Invalid weekly weight change'; END IF;
  IF _experience_level NOT IN ('beginner', 'intermediate', 'advanced')
    THEN RAISE EXCEPTION 'Invalid experience level'; END IF;
  IF _training_days_per_week NOT IN (2, 3, 4, 5, 6)
    THEN RAISE EXCEPTION 'Invalid training days'; END IF;
  IF _training_setup_preference NOT IN ('generated', 'tempo_preset', 'custom')
    THEN RAISE EXCEPTION 'Invalid training setup preference'; END IF;
  IF _calories IS NULL OR _calories < 800 OR _calories > 10000
    THEN RAISE EXCEPTION 'Invalid calorie target'; END IF;
  IF _protein IS NULL OR _protein < 1 OR _protein > 1000
    OR _carbs IS NULL OR _carbs < 1 OR _carbs > 1000
    OR _fat IS NULL OR _fat < 1 OR _fat > 1000
    THEN RAISE EXCEPTION 'Invalid macro target'; END IF;
  IF _available_equipment IS NULL OR pg_catalog.cardinality(_available_equipment) = 0
    OR ('bodyweight_only' = ANY(_available_equipment) AND pg_catalog.cardinality(_available_equipment) > 1)
    OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(_available_equipment) AS equipment(value)
      WHERE value IS NULL OR value NOT IN (
        'full_gym', 'barbell', 'dumbbells', 'cables', 'machines', 'bench',
        'pull_up_bar', 'bodyweight_only'
      )
    ) THEN RAISE EXCEPTION 'Invalid available equipment'; END IF;

  SELECT id INTO plan_id FROM public.bulk_profiles WHERE owner_id = caller;
  IF plan_id IS NOT NULL THEN RETURN plan_id; END IF;
  SELECT pg_catalog.array_agg(DISTINCT value ORDER BY value)
  INTO normalized_equipment
  FROM pg_catalog.unnest(_available_equipment) AS equipment(value);

  INSERT INTO public.bulk_profiles(owner_id) VALUES (caller) RETURNING id INTO plan_id;
  INSERT INTO public.bulk_members(bulk_profile_id, user_id, role, invited_by)
  VALUES (plan_id, caller, 'owner', caller);
  INSERT INTO public.bulk_targets(bulk_profile_id, payload)
  VALUES (plan_id, pg_catalog.jsonb_build_object(
    'goal', _goal,
    'calories', _calories,
    'protein', _protein,
    'carbs', _carbs,
    'fat', _fat,
    'water', 3,
    'startWeight', _current_weight_kg,
    'targetWeight', _target_weight_kg,
    'targetWeeklyGainKg', _target_weekly_gain_kg,
    'experienceLevel', _experience_level,
    'trainingDaysPerWeek', _training_days_per_week,
    'availableEquipment', normalized_equipment,
    'trainingSetupPreference', _training_setup_preference,
    'onboardingCompletedAt', pg_catalog.now()
  ));
  RETURN plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_bulk_onboarding(
  text,numeric,numeric,numeric,text,integer,text[],text,integer,integer,integer,integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_bulk_onboarding(
  text,numeric,numeric,numeric,text,integer,text[],text,integer,integer,integer,integer
) TO authenticated, service_role;
