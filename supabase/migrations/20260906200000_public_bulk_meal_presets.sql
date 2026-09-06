-- Segment 9: private, user-owned meal presets for public Bulk accounts.
-- Legacy meal plans and bulk_days snapshots are deliberately untouched.
CREATE TABLE public.bulk_meal_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_profile_id uuid NOT NULL REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL,
  calories numeric(8,2) NOT NULL,
  protein_g numeric(8,2) NOT NULL,
  carbs_g numeric(8,2) NOT NULL,
  fat_g numeric(8,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_meal_presets_name_ck CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT bulk_meal_presets_description_ck CHECK (description IS NULL OR char_length(description) <= 240),
  CONSTRAINT bulk_meal_presets_sort_order_ck CHECK (sort_order BETWEEN 1 AND 100),
  CONSTRAINT bulk_meal_presets_calories_ck CHECK (calories BETWEEN 0 AND 20000),
  CONSTRAINT bulk_meal_presets_protein_ck CHECK (protein_g BETWEEN 0 AND 2000),
  CONSTRAINT bulk_meal_presets_carbs_ck CHECK (carbs_g BETWEEN 0 AND 3000),
  CONSTRAINT bulk_meal_presets_fat_ck CHECK (fat_g BETWEEN 0 AND 2000),
  CONSTRAINT bulk_meal_presets_profile_order_uq UNIQUE (bulk_profile_id, sort_order)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE public.bulk_meal_preset_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_preset_id uuid NOT NULL REFERENCES public.bulk_meal_presets(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity numeric(10,3) NOT NULL,
  unit text NOT NULL,
  sort_order integer NOT NULL,
  CONSTRAINT bulk_meal_ingredients_name_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT bulk_meal_ingredients_quantity_ck CHECK (quantity > 0 AND quantity <= 100000),
  CONSTRAINT bulk_meal_ingredients_unit_ck CHECK (unit IN ('g','ml','piece','slice','tbsp','tsp','pack','serving')),
  CONSTRAINT bulk_meal_ingredients_sort_order_ck CHECK (sort_order BETWEEN 1 AND 30),
  CONSTRAINT bulk_meal_ingredients_meal_order_uq UNIQUE (meal_preset_id, sort_order)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX bulk_meal_presets_profile_order_idx
  ON public.bulk_meal_presets(bulk_profile_id, sort_order);
CREATE INDEX bulk_meal_ingredients_meal_order_idx
  ON public.bulk_meal_preset_ingredients(meal_preset_id, sort_order);

ALTER TABLE public.bulk_meal_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_meal_preset_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bulk meal presets read own" ON public.bulk_meal_presets
FOR SELECT TO authenticated
USING (private.can_read_bulk(bulk_profile_id));

CREATE POLICY "bulk meal ingredients read own" ON public.bulk_meal_preset_ingredients
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bulk_meal_presets meal
    WHERE meal.id = meal_preset_id
      AND private.can_read_bulk(meal.bulk_profile_id)
  )
);

REVOKE ALL ON public.bulk_meal_presets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.bulk_meal_preset_ingredients FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.bulk_meal_presets TO authenticated;
GRANT SELECT ON public.bulk_meal_preset_ingredients TO authenticated;
GRANT ALL ON public.bulk_meal_presets TO service_role;
GRANT ALL ON public.bulk_meal_preset_ingredients TO service_role;

CREATE FUNCTION private.current_bulk_profile()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT member.bulk_profile_id
  FROM public.bulk_members member
  JOIN public.bulk_profiles profile ON profile.id = member.bulk_profile_id
  WHERE member.user_id = (SELECT auth.uid())
    AND member.role = 'owner'
    AND profile.owner_id = (SELECT auth.uid())
  LIMIT 1
$function$;

CREATE FUNCTION private.validate_bulk_meal(
  _name text,
  _description text,
  _calories numeric,
  _protein numeric,
  _carbs numeric,
  _fat numeric,
  _ingredients jsonb
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
BEGIN
  IF _name IS NULL OR char_length(btrim(_name)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Meal name must be between 2 and 80 characters';
  END IF;
  IF _description IS NOT NULL AND char_length(_description) > 240 THEN
    RAISE EXCEPTION 'Meal description must be 240 characters or fewer';
  END IF;
  IF _calories IS NULL OR _calories < 0 OR _calories > 20000
    OR _protein IS NULL OR _protein < 0 OR _protein > 2000
    OR _carbs IS NULL OR _carbs < 0 OR _carbs > 3000
    OR _fat IS NULL OR _fat < 0 OR _fat > 2000 THEN
    RAISE EXCEPTION 'Meal macros are outside the allowed range';
  END IF;
  IF _ingredients IS NULL OR jsonb_typeof(_ingredients) <> 'array'
    OR jsonb_array_length(_ingredients) > 30 THEN
    RAISE EXCEPTION 'A meal may contain up to 30 ingredients';
  END IF;
END;
$function$;

CREATE FUNCTION private.insert_bulk_meal_ingredients(_meal uuid, _ingredients jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  ingredient jsonb;
  ingredient_index integer := 0;
  ingredient_name text;
  ingredient_quantity numeric;
  ingredient_unit text;
BEGIN
  FOR ingredient IN SELECT value FROM jsonb_array_elements(_ingredients)
  LOOP
    ingredient_index := ingredient_index + 1;
    IF jsonb_typeof(ingredient) <> 'object' THEN
      RAISE EXCEPTION 'Invalid ingredient';
    END IF;
    ingredient_name := btrim(ingredient->>'name');
    ingredient_unit := ingredient->>'unit';
    BEGIN
      ingredient_quantity := (ingredient->>'quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid ingredient quantity';
    END;
    INSERT INTO public.bulk_meal_preset_ingredients(
      meal_preset_id, name, quantity, unit, sort_order
    ) VALUES (
      _meal, ingredient_name, ingredient_quantity, ingredient_unit, ingredient_index
    );
  END LOOP;
END;
$function$;

CREATE FUNCTION public.create_bulk_meal_preset(
  _name text,
  _description text,
  _calories numeric,
  _protein numeric,
  _carbs numeric,
  _fat numeric,
  _ingredients jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  meal_id uuid;
  next_order integer;
BEGIN
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Bulk profile unavailable'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_id::text || ':meals', 0));
  PERFORM private.validate_bulk_meal(_name, _description, _calories, _protein, _carbs, _fat, _ingredients);
  SELECT count(*) + 1 INTO next_order
  FROM public.bulk_meal_presets WHERE bulk_profile_id = profile_id;
  IF next_order > 100 THEN RAISE EXCEPTION 'Meal preset limit reached'; END IF;
  INSERT INTO public.bulk_meal_presets(
    bulk_profile_id, name, description, sort_order, calories, protein_g, carbs_g, fat_g
  ) VALUES (
    profile_id, btrim(_name), nullif(btrim(_description), ''), next_order,
    _calories, _protein, _carbs, _fat
  ) RETURNING id INTO meal_id;
  PERFORM private.insert_bulk_meal_ingredients(meal_id, _ingredients);
  RETURN meal_id;
END;
$function$;

CREATE FUNCTION public.update_bulk_meal_preset(
  _meal uuid,
  _expected_updated_at timestamptz,
  _name text,
  _description text,
  _calories numeric,
  _protein numeric,
  _carbs numeric,
  _fat numeric,
  _ingredients jsonb DEFAULT '[]'::jsonb
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
  IF profile_id IS NULL OR _meal IS NULL OR _expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Meal update is invalid';
  END IF;
  PERFORM private.validate_bulk_meal(_name, _description, _calories, _protein, _carbs, _fat, _ingredients);
  SELECT updated_at INTO current_updated_at
  FROM public.bulk_meal_presets
  WHERE id = _meal AND bulk_profile_id = profile_id
  FOR UPDATE;
  IF current_updated_at IS NULL THEN RAISE EXCEPTION 'Meal not found'; END IF;
  IF current_updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'Meal changed on another device. Reload it before saving';
  END IF;
  next_updated_at := pg_catalog.clock_timestamp();
  UPDATE public.bulk_meal_presets SET
    name = btrim(_name), description = nullif(btrim(_description), ''),
    calories = _calories, protein_g = _protein, carbs_g = _carbs, fat_g = _fat,
    updated_at = next_updated_at
  WHERE id = _meal;
  DELETE FROM public.bulk_meal_preset_ingredients WHERE meal_preset_id = _meal;
  PERFORM private.insert_bulk_meal_ingredients(_meal, _ingredients);
  RETURN next_updated_at;
END;
$function$;

CREATE FUNCTION public.duplicate_bulk_meal_preset(_meal uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  source public.bulk_meal_presets%ROWTYPE;
  copied_id uuid;
  next_order integer;
BEGIN
  IF profile_id IS NULL THEN RAISE EXCEPTION 'Bulk profile unavailable'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_id::text || ':meals', 0));
  SELECT * INTO source FROM public.bulk_meal_presets
  WHERE id = _meal AND bulk_profile_id = profile_id FOR UPDATE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'Meal not found'; END IF;
  SELECT count(*) + 1 INTO next_order FROM public.bulk_meal_presets WHERE bulk_profile_id = profile_id;
  IF next_order > 100 THEN RAISE EXCEPTION 'Meal preset limit reached'; END IF;
  INSERT INTO public.bulk_meal_presets(
    bulk_profile_id, name, description, sort_order, calories, protein_g, carbs_g, fat_g
  ) VALUES (
    profile_id, left(source.name, 75) || ' Copy', source.description, next_order,
    source.calories, source.protein_g, source.carbs_g, source.fat_g
  ) RETURNING id INTO copied_id;
  INSERT INTO public.bulk_meal_preset_ingredients(meal_preset_id, name, quantity, unit, sort_order)
  SELECT copied_id, name, quantity, unit, sort_order
  FROM public.bulk_meal_preset_ingredients
  WHERE meal_preset_id = source.id ORDER BY sort_order;
  RETURN copied_id;
END;
$function$;

CREATE FUNCTION public.delete_bulk_meal_preset(_meal uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  removed_order integer;
BEGIN
  IF profile_id IS NULL THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_id::text || ':meals', 0));
  DELETE FROM public.bulk_meal_presets
  WHERE id = _meal AND bulk_profile_id = profile_id
  RETURNING sort_order INTO removed_order;
  IF removed_order IS NULL THEN RETURN false; END IF;
  UPDATE public.bulk_meal_presets SET sort_order = sort_order - 1
  WHERE bulk_profile_id = profile_id AND sort_order > removed_order;
  RETURN true;
END;
$function$;

CREATE FUNCTION public.move_bulk_meal_preset(_meal uuid, _direction integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  profile_id uuid := private.current_bulk_profile();
  current_order integer;
  other_id uuid;
BEGIN
  IF profile_id IS NULL OR _direction NOT IN (-1, 1) THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_id::text || ':meals', 0));
  SELECT sort_order INTO current_order FROM public.bulk_meal_presets
  WHERE id = _meal AND bulk_profile_id = profile_id FOR UPDATE;
  IF current_order IS NULL THEN RETURN false; END IF;
  SELECT id INTO other_id FROM public.bulk_meal_presets
  WHERE bulk_profile_id = profile_id AND sort_order = current_order + _direction FOR UPDATE;
  IF other_id IS NULL THEN RETURN false; END IF;
  UPDATE public.bulk_meal_presets
  SET sort_order = CASE WHEN id = _meal THEN current_order + _direction ELSE current_order END
  WHERE id IN (_meal, other_id);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION private.current_bulk_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.validate_bulk_meal(text,text,numeric,numeric,numeric,numeric,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.insert_bulk_meal_ingredients(uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_bulk_meal_preset(text,text,numeric,numeric,numeric,numeric,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_bulk_meal_preset(uuid,timestamptz,text,text,numeric,numeric,numeric,numeric,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.duplicate_bulk_meal_preset(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_bulk_meal_preset(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.move_bulk_meal_preset(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_bulk_meal_preset(text,text,numeric,numeric,numeric,numeric,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_bulk_meal_preset(uuid,timestamptz,text,text,numeric,numeric,numeric,numeric,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.duplicate_bulk_meal_preset(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bulk_meal_preset(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_bulk_meal_preset(uuid,integer) TO authenticated, service_role;
