ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS consumer_report boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_consumer_report
  ON public.profiles (consumer_report)
  WHERE consumer_report = true;