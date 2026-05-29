ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;