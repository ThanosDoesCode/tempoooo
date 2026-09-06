-- Segment 10: structured daily nutrition history for public Bulk profiles.
-- Existing private bulk_days nutrition payloads remain separate and unchanged.
CREATE TABLE public.bulk_nutrition_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_profile_id uuid NOT NULL REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  target_calories numeric(8,2) NOT NULL,
  target_protein_g numeric(8,2) NOT NULL,
  target_carbs_g numeric(8,2) NOT NULL,
  target_fat_g numeric(8,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_nutrition_days_profile_date_uq UNIQUE (bulk_profile_id, log_date),
  CONSTRAINT bulk_nutrition_days_date_ck CHECK (log_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  CONSTRAINT bulk_nutrition_days_calories_ck CHECK (target_calories BETWEEN 0 AND 20000),
  CONSTRAINT bulk_nutrition_days_protein_ck CHECK (target_protein_g BETWEEN 0 AND 2000),
  CONSTRAINT bulk_nutrition_days_carbs_ck CHECK (target_carbs_g BETWEEN 0 AND 3000),
  CONSTRAINT bulk_nutrition_days_fat_ck CHECK (target_fat_g BETWEEN 0 AND 2000)
);

CREATE TABLE public.bulk_nutrition_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nutrition_day_id uuid NOT NULL REFERENCES public.bulk_nutrition_days(id) ON DELETE CASCADE,
  source_meal_preset_id uuid REFERENCES public.bulk_meal_presets(id) ON DELETE SET NULL,
  source_type text NOT NULL,
  name_snapshot text NOT NULL,
  calories numeric(8,2) NOT NULL,
  protein_g numeric(8,2) NOT NULL,
  carbs_g numeric(8,2) NOT NULL,
  fat_g numeric(8,2) NOT NULL,
  ingredient_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  sort_order integer NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_nutrition_entries_source_type_ck CHECK (source_type IN ('preset','custom')),
  CONSTRAINT bulk_nutrition_entries_name_ck CHECK (char_length(btrim(name_snapshot)) BETWEEN 1 AND 100),
  CONSTRAINT bulk_nutrition_entries_calories_ck CHECK (calories BETWEEN 0 AND 20000),
  CONSTRAINT bulk_nutrition_entries_protein_ck CHECK (protein_g BETWEEN 0 AND 2000),
  CONSTRAINT bulk_nutrition_entries_carbs_ck CHECK (carbs_g BETWEEN 0 AND 3000),
  CONSTRAINT bulk_nutrition_entries_fat_ck CHECK (fat_g BETWEEN 0 AND 2000),
  CONSTRAINT bulk_nutrition_entries_note_ck CHECK (note IS NULL OR char_length(note) <= 240),
  CONSTRAINT bulk_nutrition_entries_ingredients_ck CHECK (
    jsonb_typeof(ingredient_snapshot) = 'array' AND jsonb_array_length(ingredient_snapshot) <= 30
  ),
  CONSTRAINT bulk_nutrition_entries_sort_order_ck CHECK (sort_order BETWEEN 1 AND 500),
  CONSTRAINT bulk_nutrition_entries_day_order_uq UNIQUE (nutrition_day_id, sort_order)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT bulk_nutrition_entries_day_request_uq UNIQUE (nutrition_day_id, request_id)
);

CREATE INDEX bulk_nutrition_days_profile_date_idx
  ON public.bulk_nutrition_days(bulk_profile_id, log_date DESC);
CREATE INDEX bulk_nutrition_entries_day_order_idx
  ON public.bulk_nutrition_entries(nutrition_day_id, sort_order);
CREATE INDEX bulk_nutrition_entries_source_idx
  ON public.bulk_nutrition_entries(source_meal_preset_id)
  WHERE source_meal_preset_id IS NOT NULL;

ALTER TABLE public.bulk_nutrition_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_nutrition_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bulk nutrition days read own" ON public.bulk_nutrition_days
FOR SELECT TO authenticated
USING (private.can_read_bulk(bulk_profile_id));

CREATE POLICY "bulk nutrition entries read own" ON public.bulk_nutrition_entries
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bulk_nutrition_days day
    WHERE day.id = nutrition_day_id
      AND private.can_read_bulk(day.bulk_profile_id)
  )
);

REVOKE ALL ON public.bulk_nutrition_days FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bulk_nutrition_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bulk_nutrition_days TO authenticated;
GRANT SELECT ON public.bulk_nutrition_entries TO authenticated;
GRANT ALL ON public.bulk_nutrition_days TO service_role;
GRANT ALL ON public.bulk_nutrition_entries TO service_role;

CREATE FUNCTION private.validate_bulk_nutrition_date(_log_date date)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF _log_date IS NULL OR _log_date < DATE '2000-01-01' OR _log_date > DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Invalid nutrition date';
  END IF;
END;
$function$;

CREATE FUNCTION private.validate_bulk_nutrition_entry(
  _name text,
  _calories numeric,
  _protein numeric,
  _carbs numeric,
  _fat numeric,
  _note text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF _name IS NULL OR char_length(btrim(_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Entry name must be between 1 and 100 characters';
  END IF;
  IF _note IS NOT NULL AND char_length(_note) > 240 THEN
    RAISE EXCEPTION 'Entry note must be 240 characters or fewer';
  END IF;
  IF _calories IS NULL OR _calories < 0 OR _calories > 20000
    OR _protein IS NULL OR _protein < 0 OR _protein > 2000
    OR _carbs IS NULL OR _carbs < 0 OR _carbs > 3000
    OR _fat IS NULL OR _fat < 0 OR _fat > 2000 THEN
    RAISE EXCEPTION 'Entry macros are outside the allowed range';
  END IF;
END;
$function$;

CREATE FUNCTION private.ensure_bulk_nutrition_day(_profile uuid, _log_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  day_id uuid;
  targets jsonb;
  calories numeric;
  protein numeric;
  carbs numeric;
  fat numeric;
BEGIN
  SELECT id INTO day_id FROM public.bulk_nutrition_days
  WHERE bulk_profile_id = _profile AND log_date = _log_date FOR UPDATE;
  IF day_id IS NOT NULL THEN RETURN day_id; END IF;

  SELECT payload INTO targets FROM public.bulk_targets WHERE bulk_profile_id = _profile;
  IF targets IS NULL OR NOT targets ? 'trainingSetupPreference'
    OR jsonb_typeof(targets->'calories') <> 'number'
    OR jsonb_typeof(targets->'protein') <> 'number'
    OR jsonb_typeof(targets->'carbs') <> 'number'
    OR jsonb_typeof(targets->'fat') <> 'number' THEN
    RAISE EXCEPTION 'Public Bulk nutrition targets are unavailable';
  END IF;
  calories := (targets->>'calories')::numeric;
  protein := (targets->>'protein')::numeric;
  carbs := (targets->>'carbs')::numeric;
  fat := (targets->>'fat')::numeric;
  INSERT INTO public.bulk_nutrition_days(
    bulk_profile_id, log_date, target_calories, target_protein_g, target_carbs_g, target_fat_g
  ) VALUES (_profile, _log_date, calories, protein, carbs, fat)
  RETURNING id INTO day_id;
  RETURN day_id;
END;
$function$;

CREATE FUNCTION public.log_bulk_meal_preset(
  _preset uuid,
  _log_date date,
  _request_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  day_id uuid;
  existing_id uuid;
  meal public.bulk_meal_presets%ROWTYPE;
  ingredients jsonb;
  next_order integer;
BEGIN
  IF profile_id IS NULL OR _preset IS NULL OR _request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid meal log request';
  END IF;
  PERFORM private.validate_bulk_nutrition_date(_log_date);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':nutrition:' || _log_date::text, 0)
  );
  SELECT entry.id INTO existing_id
  FROM public.bulk_nutrition_entries entry
  JOIN public.bulk_nutrition_days day ON day.id = entry.nutrition_day_id
  WHERE day.bulk_profile_id = profile_id AND day.log_date = _log_date
    AND entry.request_id = _request_id;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;

  SELECT * INTO meal FROM public.bulk_meal_presets
  WHERE id = _preset AND bulk_profile_id = profile_id;
  IF meal.id IS NULL THEN RAISE EXCEPTION 'Meal preset not found'; END IF;
  SELECT coalesce(
    jsonb_agg(jsonb_build_object('name',name,'quantity',quantity,'unit',unit) ORDER BY sort_order),
    '[]'::jsonb
  ) INTO ingredients
  FROM public.bulk_meal_preset_ingredients WHERE meal_preset_id = meal.id;

  day_id := private.ensure_bulk_nutrition_day(profile_id, _log_date);
  SELECT count(*) + 1 INTO next_order
  FROM public.bulk_nutrition_entries WHERE nutrition_day_id = day_id;
  IF next_order > 500 THEN RAISE EXCEPTION 'Daily nutrition entry limit reached'; END IF;
  INSERT INTO public.bulk_nutrition_entries(
    nutrition_day_id, source_meal_preset_id, source_type, name_snapshot,
    calories, protein_g, carbs_g, fat_g, ingredient_snapshot, sort_order, request_id
  ) VALUES (
    day_id, meal.id, 'preset', meal.name, meal.calories, meal.protein_g, meal.carbs_g,
    meal.fat_g, ingredients, next_order, _request_id
  ) RETURNING id INTO existing_id;
  RETURN existing_id;
END;
$function$;

CREATE FUNCTION public.create_bulk_nutrition_entry(
  _log_date date,
  _request_id uuid,
  _name text,
  _calories numeric,
  _protein numeric,
  _carbs numeric,
  _fat numeric,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  day_id uuid;
  existing_id uuid;
  next_order integer;
BEGIN
  IF profile_id IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Invalid nutrition entry request'; END IF;
  PERFORM private.validate_bulk_nutrition_date(_log_date);
  PERFORM private.validate_bulk_nutrition_entry(_name, _calories, _protein, _carbs, _fat, _note);
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':nutrition:' || _log_date::text, 0)
  );
  SELECT entry.id INTO existing_id
  FROM public.bulk_nutrition_entries entry
  JOIN public.bulk_nutrition_days day ON day.id = entry.nutrition_day_id
  WHERE day.bulk_profile_id = profile_id AND day.log_date = _log_date
    AND entry.request_id = _request_id;
  IF existing_id IS NOT NULL THEN RETURN existing_id; END IF;
  day_id := private.ensure_bulk_nutrition_day(profile_id, _log_date);
  SELECT count(*) + 1 INTO next_order
  FROM public.bulk_nutrition_entries WHERE nutrition_day_id = day_id;
  IF next_order > 500 THEN RAISE EXCEPTION 'Daily nutrition entry limit reached'; END IF;
  INSERT INTO public.bulk_nutrition_entries(
    nutrition_day_id, source_type, name_snapshot, calories, protein_g, carbs_g, fat_g,
    note, sort_order, request_id
  ) VALUES (
    day_id, 'custom', btrim(_name), _calories, _protein, _carbs, _fat,
    nullif(btrim(_note), ''), next_order, _request_id
  ) RETURNING id INTO existing_id;
  RETURN existing_id;
END;
$function$;

CREATE FUNCTION public.update_bulk_nutrition_entry(
  _entry uuid,
  _expected_updated_at timestamptz,
  _name text,
  _calories numeric,
  _protein numeric,
  _carbs numeric,
  _fat numeric,
  _note text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  current_updated_at timestamptz;
  next_updated_at timestamptz;
BEGIN
  IF profile_id IS NULL OR _entry IS NULL OR _expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Invalid nutrition entry update';
  END IF;
  PERFORM private.validate_bulk_nutrition_entry(_name, _calories, _protein, _carbs, _fat, _note);
  SELECT entry.updated_at INTO current_updated_at
  FROM public.bulk_nutrition_entries entry
  JOIN public.bulk_nutrition_days day ON day.id = entry.nutrition_day_id
  WHERE entry.id = _entry AND day.bulk_profile_id = profile_id FOR UPDATE OF entry;
  IF current_updated_at IS NULL THEN RAISE EXCEPTION 'Nutrition entry not found'; END IF;
  IF current_updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Nutrition entry changed on another device. Reload it before saving';
  END IF;
  next_updated_at := pg_catalog.clock_timestamp();
  UPDATE public.bulk_nutrition_entries SET
    name_snapshot = btrim(_name), calories = _calories, protein_g = _protein,
    carbs_g = _carbs, fat_g = _fat, note = nullif(btrim(_note), ''),
    updated_at = next_updated_at
  WHERE id = _entry;
  RETURN next_updated_at;
END;
$function$;

CREATE FUNCTION public.delete_bulk_nutrition_entry(_entry uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  day_id uuid;
  selected_date date;
  removed_order integer;
BEGIN
  IF profile_id IS NULL OR _entry IS NULL THEN RETURN false; END IF;
  SELECT entry.nutrition_day_id, day.log_date INTO day_id, selected_date
  FROM public.bulk_nutrition_entries entry
  JOIN public.bulk_nutrition_days day ON day.id = entry.nutrition_day_id
  WHERE entry.id = _entry AND day.bulk_profile_id = profile_id;
  IF day_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(profile_id::text || ':nutrition:' || selected_date::text, 0)
  );
  DELETE FROM public.bulk_nutrition_entries WHERE id = _entry AND nutrition_day_id = day_id
  RETURNING sort_order INTO removed_order;
  IF removed_order IS NULL THEN RETURN false; END IF;
  UPDATE public.bulk_nutrition_entries SET sort_order = sort_order - 1
  WHERE nutrition_day_id = day_id AND sort_order > removed_order;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION private.validate_bulk_nutrition_date(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validate_bulk_nutrition_entry(text,numeric,numeric,numeric,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.ensure_bulk_nutrition_day(uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_bulk_meal_preset(uuid,date,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_bulk_nutrition_entry(date,uuid,text,numeric,numeric,numeric,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_bulk_nutrition_entry(uuid,timestamptz,text,numeric,numeric,numeric,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_bulk_nutrition_entry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_bulk_meal_preset(uuid,date,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_bulk_nutrition_entry(date,uuid,text,numeric,numeric,numeric,numeric,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_bulk_nutrition_entry(uuid,timestamptz,text,numeric,numeric,numeric,numeric,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bulk_nutrition_entry(uuid) TO authenticated, service_role;
