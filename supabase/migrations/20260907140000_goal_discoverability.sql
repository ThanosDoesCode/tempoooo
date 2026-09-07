ALTER TABLE public.profiles
  ADD COLUMN goal_seen_at timestamptz;

-- Existing self-read/self-update profile policies remain authoritative. This column
-- is deliberately kept on the existing user-owned profile instead of a new table.
