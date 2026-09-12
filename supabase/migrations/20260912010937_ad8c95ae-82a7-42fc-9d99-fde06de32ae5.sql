-- PostgREST includes the submitted primary key in merge-duplicate updates.
-- The existing self-only UPDATE policy prevents changing it to any value other
-- than auth.uid(), while this column grant lets the profile bootstrap upsert
-- reach that policy.
GRANT UPDATE (id) ON public.profiles TO authenticated;