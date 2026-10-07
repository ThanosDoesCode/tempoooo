-- Local meal categories and reliable, forward-only nutrition target history.
-- No existing meal or historical daily snapshot is backfilled or rewritten.
ALTER TABLE public.bulk_nutrition_entries ADD COLUMN meal_category text;
ALTER TABLE public.bulk_nutrition_entries ADD CONSTRAINT bulk_nutrition_entries_category_ck
  CHECK (meal_category IS NULL OR meal_category IN ('breakfast','lunch','dinner','snacks'));
ALTER TABLE public.bulk_nutrition_days
  ALTER COLUMN target_calories DROP NOT NULL,
  ALTER COLUMN target_protein_g DROP NOT NULL,
  ALTER COLUMN target_carbs_g DROP NOT NULL,
  ALTER COLUMN target_fat_g DROP NOT NULL;
ALTER TABLE public.bulk_nutrition_days ADD CONSTRAINT bulk_nutrition_days_target_known_ck
  CHECK (num_nonnulls(target_calories,target_protein_g,target_carbs_g,target_fat_g) IN (0,4));

CREATE TABLE public.bulk_nutrition_target_history (
  bulk_profile_id uuid NOT NULL REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  calories numeric(8,2) NOT NULL CHECK (calories BETWEEN 0 AND 20000),
  protein_g numeric(8,2) NOT NULL CHECK (protein_g BETWEEN 0 AND 2000),
  carbs_g numeric(8,2) NOT NULL CHECK (carbs_g BETWEEN 0 AND 3000),
  fat_g numeric(8,2) NOT NULL CHECK (fat_g BETWEEN 0 AND 2000),
  timezone text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bulk_profile_id, effective_from)
);
ALTER TABLE public.bulk_nutrition_target_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nutrition target history read owner" ON public.bulk_nutrition_target_history
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.bulk_profiles p WHERE p.id=bulk_profile_id AND p.owner_id=(SELECT auth.uid()))
);
REVOKE ALL ON public.bulk_nutrition_target_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bulk_nutrition_target_history TO authenticated;
GRANT ALL ON public.bulk_nutrition_target_history TO service_role;

CREATE FUNCTION private.record_bulk_nutrition_targets(_profile uuid, _timezone text, _local_day date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE targets jsonb; local_day date;
BEGIN
  IF (_timezone IS NULL AND (_local_day IS NULL OR _local_day NOT BETWEEN current_date-1 AND current_date+1)) OR (_timezone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=_timezone
  )) THEN RAISE EXCEPTION 'Invalid device timezone' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.bulk_profiles WHERE id=_profile FOR UPDATE;
  SELECT payload INTO targets FROM public.bulk_targets WHERE bulk_profile_id=_profile;
  IF targets IS NULL THEN RETURN; END IF;
  local_day := COALESCE(_local_day, (pg_catalog.now() AT TIME ZONE _timezone)::date);
  INSERT INTO public.bulk_nutrition_target_history(
    bulk_profile_id,effective_from,calories,protein_g,carbs_g,fat_g,timezone
  ) VALUES (_profile,local_day,(targets->>'calories')::numeric,
    (targets->>'protein')::numeric,(targets->>'carbs')::numeric,(targets->>'fat')::numeric,_timezone)
  ON CONFLICT (bulk_profile_id,effective_from) DO UPDATE SET
    calories=EXCLUDED.calories,protein_g=EXCLUDED.protein_g,carbs_g=EXCLUDED.carbs_g,
    fat_g=EXCLUDED.fat_g,timezone=COALESCE(EXCLUDED.timezone,bulk_nutrition_target_history.timezone),recorded_at=pg_catalog.now()
  WHERE (bulk_nutrition_target_history.calories,bulk_nutrition_target_history.protein_g,
         bulk_nutrition_target_history.carbs_g,bulk_nutrition_target_history.fat_g,
         bulk_nutrition_target_history.timezone)
    IS DISTINCT FROM (EXCLUDED.calories,EXCLUDED.protein_g,EXCLUDED.carbs_g,EXCLUDED.fat_g,COALESCE(EXCLUDED.timezone,bulk_nutrition_target_history.timezone));
END;
$function$;

-- Capture every subsequent target writer (including weekly recommendations) once
-- the owner's timezone is known. Never infer a timezone or manufacture older versions.
CREATE FUNCTION private.capture_bulk_nutrition_targets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE zone text;
BEGIN
  zone := nullif(pg_catalog.current_setting('tempo.nutrition_timezone', true),'');
  IF zone IS NULL THEN
    SELECT timezone INTO zone FROM public.bulk_nutrition_target_history
    WHERE bulk_profile_id=NEW.bulk_profile_id AND timezone IS NOT NULL
    ORDER BY effective_from DESC LIMIT 1;
  END IF;
  IF zone IS NOT NULL THEN PERFORM private.record_bulk_nutrition_targets(NEW.bulk_profile_id,zone); END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER capture_bulk_nutrition_targets AFTER INSERT OR UPDATE OF payload ON public.bulk_targets
FOR EACH ROW EXECUTE FUNCTION private.capture_bulk_nutrition_targets();

CREATE OR REPLACE FUNCTION private.ensure_bulk_nutrition_day(_profile uuid, _log_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE day_id uuid; target public.bulk_nutrition_target_history%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.bulk_profiles WHERE id=_profile FOR UPDATE;
  SELECT id INTO day_id FROM public.bulk_nutrition_days
  WHERE bulk_profile_id=_profile AND log_date=_log_date FOR UPDATE;
  IF day_id IS NOT NULL THEN RETURN day_id; END IF;
  SELECT * INTO target FROM public.bulk_nutrition_target_history
  WHERE bulk_profile_id=_profile AND effective_from<=_log_date ORDER BY effective_from DESC LIMIT 1;
  INSERT INTO public.bulk_nutrition_days(
    bulk_profile_id,log_date,target_calories,target_protein_g,target_carbs_g,target_fat_g
  ) VALUES (_profile,_log_date,target.calories,target.protein_g,target.carbs_g,target.fat_g)
  RETURNING id INTO day_id;
  RETURN day_id;
END;
$function$;

-- Read/initialize the reliable baseline for today's actual device calendar day.
-- Querying a past date does NOT seed that past date from current settings.
CREATE FUNCTION public.bulk_nutrition_targets_for_day(_profile uuid,_log_date date,_timezone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE caller uuid := (SELECT auth.uid()); result jsonb;
BEGIN
  IF caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.bulk_profiles p JOIN public.bulk_members m ON m.bulk_profile_id=p.id
    WHERE p.id=_profile AND p.owner_id=caller AND m.user_id=caller AND m.role='owner'
  ) THEN RAISE EXCEPTION 'Goal profile not found' USING ERRCODE='42501'; END IF;
  PERFORM private.validate_bulk_nutrition_date(_log_date);
  PERFORM private.record_bulk_nutrition_targets(_profile,_timezone);
  SELECT jsonb_build_object('calories',target_calories,'protein',target_protein_g,
    'carbs',target_carbs_g,'fat',target_fat_g) INTO result
  FROM public.bulk_nutrition_days WHERE bulk_profile_id=_profile AND log_date=_log_date;
  IF FOUND THEN RETURN result; END IF;
  SELECT jsonb_build_object('calories',calories,'protein',protein_g,'carbs',carbs_g,'fat',fat_g)
  INTO result FROM public.bulk_nutrition_target_history WHERE bulk_profile_id=_profile AND effective_from<=_log_date
  ORDER BY effective_from DESC LIMIT 1;
  RETURN result;
END;
$function$;

CREATE FUNCTION private.prepare_bulk_nutrition_write(_local_today date,_timezone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE profile_id uuid := private.current_bulk_profile(); caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.bulk_profiles p JOIN public.bulk_members m ON m.bulk_profile_id=p.id
    WHERE p.id=profile_id AND p.owner_id=caller AND m.user_id=caller AND m.role='owner'
  ) THEN RAISE EXCEPTION 'Goal profile not found' USING ERRCODE='42501'; END IF;
  IF _local_today IS NULL OR _local_today NOT BETWEEN current_date-1 AND current_date+1 THEN
    RAISE EXCEPTION 'Invalid local nutrition date';
  END IF;
  IF _timezone IS NOT NULL THEN
    PERFORM private.record_bulk_nutrition_targets(profile_id,_timezone);
    IF _local_today IS DISTINCT FROM (pg_catalog.now() AT TIME ZONE _timezone)::date THEN
      RAISE EXCEPTION 'Invalid local nutrition date' USING ERRCODE='22023';
    END IF;
  ELSE
    -- Compatibility callers already supply a bounded local day; record that day
    -- without guessing their timezone. New clients always supply an IANA zone.
    PERFORM private.record_bulk_nutrition_targets(profile_id,NULL,_local_today);
  END IF;
  RETURN profile_id;
END;
$function$;

CREATE FUNCTION private.validate_bulk_meal_category(_category text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
BEGIN
  IF _category IS NOT NULL AND _category NOT IN ('breakfast','lunch','dinner','snacks') THEN
    RAISE EXCEPTION 'Invalid meal category' USING ERRCODE='22023';
  END IF;
END;
$function$;
-- Save current Goal targets and today's existing nutrition snapshot together.
-- No history is backfilled; earlier days and logged meal snapshots stay untouched.
CREATE OR REPLACE FUNCTION public.save_bulk_targets_for_local_day(
  _profile uuid,
  _targets jsonb,
  _timezone text
)
RETURNS date
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller uuid := (SELECT auth.uid());
  local_day date;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = _timezone
  ) THEN
    RAISE EXCEPTION 'Invalid device timezone' USING ERRCODE = '22023';
  END IF;
  local_day := (pg_catalog.now() AT TIME ZONE _timezone)::date;

  PERFORM 1 FROM public.bulk_profiles profile
  JOIN public.bulk_members member ON member.bulk_profile_id = profile.id
  WHERE profile.id = _profile AND profile.owner_id = caller
    AND member.user_id = caller AND member.role = 'owner'
  FOR UPDATE OF profile, member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal profile not found' USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.jsonb_typeof(_targets) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(_targets->'calories') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(_targets->'protein') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(_targets->'carbs') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(_targets->'fat') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Goal nutrition targets are unavailable' USING ERRCODE = '22023';
  END IF;
  -- Preserve the existing nutrition snapshot ranges and bulk_targets constraints.
  IF (_targets->>'calories')::numeric NOT BETWEEN 0 AND 20000
    OR (_targets->>'protein')::numeric NOT BETWEEN 0 AND 2000
    OR (_targets->>'carbs')::numeric NOT BETWEEN 0 AND 3000
    OR (_targets->>'fat')::numeric NOT BETWEEN 0 AND 2000 THEN
    RAISE EXCEPTION 'Goal nutrition targets are outside the allowed range' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('tempo.nutrition_timezone', _timezone, true);
  INSERT INTO public.bulk_targets(bulk_profile_id, payload)
  VALUES (_profile, _targets)
  ON CONFLICT (bulk_profile_id) DO UPDATE SET payload = EXCLUDED.payload;

  UPDATE public.bulk_nutrition_days
  SET target_calories = (_targets->>'calories')::numeric,
      target_protein_g = (_targets->>'protein')::numeric,
      target_carbs_g = (_targets->>'carbs')::numeric,
      target_fat_g = (_targets->>'fat')::numeric,
      updated_at = pg_catalog.now()
  WHERE bulk_profile_id = _profile AND log_date = local_day;
  RETURN local_day;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_bulk_targets_for_local_day(uuid,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_bulk_targets_for_local_day(uuid,jsonb,text)
  TO authenticated;


DROP FUNCTION public.log_bulk_meal_preset(uuid,date,uuid,date);
DROP FUNCTION public.create_bulk_nutrition_entry(date,uuid,text,numeric,numeric,numeric,numeric,date,text);
DROP FUNCTION public.update_bulk_nutrition_entry(uuid,timestamptz,text,numeric,numeric,numeric,numeric,date,text);

CREATE FUNCTION public.log_bulk_meal_preset(_preset uuid,_log_date date,_request_id uuid,_local_today date,_category text DEFAULT NULL,_timezone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE profile_id uuid; result uuid;
BEGIN
  profile_id := private.prepare_bulk_nutrition_write(_local_today,_timezone);
  PERFORM private.validate_bulk_nutrition_write_day(_log_date,_local_today);
  PERFORM private.validate_bulk_meal_category(_category);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_id::text || ':nutrition:' || _log_date::text,0));
  SELECT e.id INTO result FROM public.bulk_nutrition_entries e JOIN public.bulk_nutrition_days d ON d.id=e.nutrition_day_id
  WHERE d.bulk_profile_id=profile_id AND d.log_date=_log_date AND e.request_id=_request_id;
  IF result IS NOT NULL THEN RETURN result; END IF;
  result := public.log_bulk_meal_preset(_preset,_log_date,_request_id);
  UPDATE public.bulk_nutrition_entries SET meal_category=_category WHERE id=result;
  RETURN result;
END;
$function$;

CREATE FUNCTION public.create_bulk_nutrition_entry(_log_date date,_request_id uuid,_name text,_calories numeric,_protein numeric,_carbs numeric,_fat numeric,_local_today date,_note text DEFAULT NULL,_category text DEFAULT NULL,_timezone text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE profile_id uuid; result uuid;
BEGIN
  profile_id := private.prepare_bulk_nutrition_write(_local_today,_timezone);
  PERFORM private.validate_bulk_nutrition_write_day(_log_date,_local_today);
  PERFORM private.validate_bulk_meal_category(_category);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_id::text || ':nutrition:' || _log_date::text,0));
  SELECT e.id INTO result FROM public.bulk_nutrition_entries e JOIN public.bulk_nutrition_days d ON d.id=e.nutrition_day_id
  WHERE d.bulk_profile_id=profile_id AND d.log_date=_log_date AND e.request_id=_request_id;
  IF result IS NOT NULL THEN RETURN result; END IF;
  result := public.create_bulk_nutrition_entry(_log_date,_request_id,_name,_calories,_protein,_carbs,_fat,_note);
  UPDATE public.bulk_nutrition_entries SET meal_category=_category WHERE id=result;
  RETURN result;
END;
$function$;

CREATE FUNCTION public.update_bulk_nutrition_entry(
  _entry uuid,_expected_updated_at timestamptz,_name text,_calories numeric,_protein numeric,
  _carbs numeric,_fat numeric,_local_today date,_note text DEFAULT NULL,
  _category text DEFAULT NULL,_timezone text DEFAULT NULL
)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE profile_id uuid; selected_date date; result timestamptz;
BEGIN
  profile_id := private.prepare_bulk_nutrition_write(_local_today,_timezone);
  SELECT d.log_date INTO selected_date FROM public.bulk_nutrition_entries e
  JOIN public.bulk_nutrition_days d ON d.id=e.nutrition_day_id
  WHERE e.id=_entry AND d.bulk_profile_id=profile_id;
  IF selected_date IS NULL THEN RAISE EXCEPTION 'Nutrition entry not found'; END IF;
  PERFORM private.validate_bulk_nutrition_write_day(selected_date,_local_today);
  PERFORM private.validate_bulk_meal_category(_category);
  result := public.update_bulk_nutrition_entry(_entry,_expected_updated_at,_name,_calories,_protein,_carbs,_fat,_note);
  UPDATE public.bulk_nutrition_entries SET meal_category=_category WHERE id=_entry;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION private.record_bulk_nutrition_targets(uuid,text,date),
  private.capture_bulk_nutrition_targets(),private.prepare_bulk_nutrition_write(date,text),
  private.validate_bulk_meal_category(text),private.ensure_bulk_nutrition_day(uuid,date)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.bulk_nutrition_targets_for_day(uuid,date,text),
  public.log_bulk_meal_preset(uuid,date,uuid,date,text,text),
  public.create_bulk_nutrition_entry(date,uuid,text,numeric,numeric,numeric,numeric,date,text,text,text),
  public.update_bulk_nutrition_entry(uuid,timestamptz,text,numeric,numeric,numeric,numeric,date,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_nutrition_targets_for_day(uuid,date,text),
  public.log_bulk_meal_preset(uuid,date,uuid,date,text,text),
  public.create_bulk_nutrition_entry(date,uuid,text,numeric,numeric,numeric,numeric,date,text,text,text),
  public.update_bulk_nutrition_entry(uuid,timestamptz,text,numeric,numeric,numeric,numeric,date,text,text,text)
  TO authenticated,service_role;
