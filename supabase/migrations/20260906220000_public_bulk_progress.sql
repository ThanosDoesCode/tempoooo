-- Segment 11: structured weight and progress-photo history for public Bulk profiles.
-- Legacy bulk_days weights and bulk_photos remain separate and unchanged.
CREATE TABLE public.bulk_weight_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_profile_id uuid NOT NULL REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  weight_kg numeric(6,2) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_weight_entries_profile_date_uq UNIQUE (bulk_profile_id, log_date),
  CONSTRAINT bulk_weight_entries_date_ck CHECK (
    log_date BETWEEN DATE '2000-01-01' AND CURRENT_DATE
  ),
  CONSTRAINT bulk_weight_entries_weight_ck CHECK (weight_kg BETWEEN 20 AND 400),
  CONSTRAINT bulk_weight_entries_note_ck CHECK (note IS NULL OR char_length(note) <= 240)
);

CREATE INDEX bulk_weight_entries_profile_date_idx
  ON public.bulk_weight_entries(bulk_profile_id, log_date DESC);

CREATE TABLE public.bulk_progress_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_profile_id uuid NOT NULL REFERENCES public.bulk_profiles(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  storage_path text NOT NULL,
  view_type text NOT NULL DEFAULT 'other',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulk_progress_photos_date_ck CHECK (
    log_date BETWEEN DATE '2000-01-01' AND CURRENT_DATE
  ),
  CONSTRAINT bulk_progress_photos_view_ck CHECK (view_type IN ('front','side','back','other')),
  CONSTRAINT bulk_progress_photos_note_ck CHECK (note IS NULL OR char_length(note) <= 240),
  CONSTRAINT bulk_progress_photos_path_ck CHECK (
    storage_path = btrim(storage_path)
    AND char_length(storage_path) BETWEEN 10 AND 500
    AND storage_path LIKE bulk_profile_id::text || '/public/%'
    AND storage_path !~ '(^|/)\.\.(/|$)'
  ),
  CONSTRAINT bulk_progress_photos_path_uq UNIQUE (storage_path)
);

CREATE INDEX bulk_progress_photos_profile_date_idx
  ON public.bulk_progress_photos(bulk_profile_id, log_date DESC, created_at DESC);

CREATE TRIGGER bulk_weight_entries_touch BEFORE UPDATE ON public.bulk_weight_entries
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER bulk_progress_photos_touch BEFORE UPDATE ON public.bulk_progress_photos
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.bulk_weight_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_progress_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bulk weight own read" ON public.bulk_weight_entries FOR SELECT TO authenticated
USING (private.can_read_bulk(bulk_profile_id));
CREATE POLICY "bulk weight own insert" ON public.bulk_weight_entries FOR INSERT TO authenticated
WITH CHECK (private.can_write_bulk(bulk_profile_id));
CREATE POLICY "bulk weight own update" ON public.bulk_weight_entries FOR UPDATE TO authenticated
USING (private.can_write_bulk(bulk_profile_id)) WITH CHECK (private.can_write_bulk(bulk_profile_id));
CREATE POLICY "bulk weight own delete" ON public.bulk_weight_entries FOR DELETE TO authenticated
USING (private.can_write_bulk(bulk_profile_id));

CREATE POLICY "bulk progress photos own read" ON public.bulk_progress_photos FOR SELECT TO authenticated
USING (private.can_read_bulk(bulk_profile_id));
CREATE POLICY "bulk progress photos own insert" ON public.bulk_progress_photos FOR INSERT TO authenticated
WITH CHECK (private.can_write_bulk(bulk_profile_id));
CREATE POLICY "bulk progress photos own update" ON public.bulk_progress_photos FOR UPDATE TO authenticated
USING (private.can_write_bulk(bulk_profile_id)) WITH CHECK (private.can_write_bulk(bulk_profile_id));
CREATE POLICY "bulk progress photos own delete" ON public.bulk_progress_photos FOR DELETE TO authenticated
USING (private.can_write_bulk(bulk_profile_id));

REVOKE ALL ON public.bulk_weight_entries, public.bulk_progress_photos FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_weight_entries, public.bulk_progress_photos TO authenticated;
GRANT ALL ON public.bulk_weight_entries, public.bulk_progress_photos TO service_role;
