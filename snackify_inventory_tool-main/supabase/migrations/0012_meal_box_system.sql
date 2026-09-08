-- =====================================================================
-- 0012_meal_box_system.sql
-- ApplyWizz Meal Box System
-- =====================================================================
-- Run in: https://supabase.com/dashboard/project/twmadauhauuypioznpus/sql/new
--
-- Changes:
--   1. Add 'cabin' column to employee_cafeteria_preferences
--   2. Add token + print-tracking columns to meal_bookings
--   3. Create meal_print_jobs table
--   4. RLS policies for new table
--   5. pg_cron schedule for daily print-job creation at 10:59 AM IST
-- =====================================================================


-- ── 1. Add cabin to employee_cafeteria_preferences ──────────────────
-- Cabin is where the employee sits. Office boy puts their token in that
-- cabin's meal box. Employee picks it up themselves.
ALTER TABLE public.employee_cafeteria_preferences
  ADD COLUMN IF NOT EXISTS cabin TEXT DEFAULT NULL;


-- ── 2. Add token + print-tracking columns to meal_bookings ──────────
-- token_number   : unique readable token like "28MAY-TECH-012"
-- cabin_name     : denormalized copy of cabin at time of print (fast lookup)
-- print_count    : 0 = not printed yet, 1 = printed once, 2+ = reprinted
-- last_printed_at: timestamp of most recent print job
-- last_printed_by: who triggered the (re)print (UUID of user or NULL for auto)
ALTER TABLE public.meal_bookings
  ADD COLUMN IF NOT EXISTS token_number     TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cabin_name       TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS print_count      INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_printed_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_printed_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Index to speed up cabin-wise token lookups
CREATE INDEX IF NOT EXISTS idx_meal_bookings_cabin_date
  ON public.meal_bookings (cabin_name, meal_date);

CREATE INDEX IF NOT EXISTS idx_meal_bookings_token
  ON public.meal_bookings (token_number);


-- ── 3. Create meal_print_jobs ────────────────────────────────────────
-- One row per cabin per meal_date. Print agent listens to this table
-- and prints all tokens for that cabin when scheduled_for time arrives.
CREATE TABLE IF NOT EXISTS public.meal_print_jobs (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  meal_date      DATE        NOT NULL,
  cabin_name     TEXT        NOT NULL,
  print_type     TEXT        NOT NULL DEFAULT 'cabin_batch',
                             -- 'cabin_batch' | 'manual_cabin' | 'reprint'
  scheduled_for  TIMESTAMPTZ NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending',
                             -- 'pending' | 'printing' | 'completed' | 'failed' | 'cancelled'
  started_at     TIMESTAMPTZ DEFAULT NULL,
  completed_at   TIMESTAMPTZ DEFAULT NULL,
  token_count    INT         DEFAULT 0,
  requested_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- For reprint jobs: which booking to reprint
  booking_user_id UUID       REFERENCES public.profiles(id) ON DELETE SET NULL,
  error_message  TEXT        DEFAULT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_meal_print_jobs_date
  ON public.meal_print_jobs (meal_date, status);

CREATE INDEX IF NOT EXISTS idx_meal_print_jobs_status
  ON public.meal_print_jobs (status, scheduled_for);


-- ── 4. RLS for meal_print_jobs ───────────────────────────────────────
ALTER TABLE public.meal_print_jobs ENABLE ROW LEVEL SECURITY;

-- Office boy + FM + leadership can read print job status
DROP POLICY IF EXISTS "meal_print_jobs_read_privileged" ON public.meal_print_jobs;
CREATE POLICY "meal_print_jobs_read_privileged"
  ON public.meal_print_jobs FOR SELECT
  USING (public.current_user_role() IN ('office_boy', 'facility_manager', 'leadership', 'finance'));

-- Only privileged roles can create manual/reprint jobs from frontend
DROP POLICY IF EXISTS "meal_print_jobs_insert_privileged" ON public.meal_print_jobs;
CREATE POLICY "meal_print_jobs_insert_privileged"
  ON public.meal_print_jobs FOR INSERT
  WITH CHECK (public.current_user_role() IN ('office_boy', 'facility_manager', 'leadership'));

-- Update (status changes) handled by backend service role — no RLS needed for that
-- The service role bypasses RLS entirely. Print agent uses service role key.


-- ── 5. RLS: staff can read their own meal_bookings row (for My Meal Box) ──
-- meal_bookings likely already has RLS. Add policy if missing.
DROP POLICY IF EXISTS "meal_bookings_own_read" ON public.meal_bookings;
CREATE POLICY "meal_bookings_own_read"
  ON public.meal_bookings FOR SELECT
  USING (auth.uid() = user_id);

-- FM + leadership + office_boy can read all bookings (for dashboard)
DROP POLICY IF EXISTS "meal_bookings_privileged_read" ON public.meal_bookings;
CREATE POLICY "meal_bookings_privileged_read"
  ON public.meal_bookings FOR SELECT
  USING (public.current_user_role() IN ('facility_manager', 'leadership', 'office_boy', 'finance'));


-- ── 6. Schedule daily print-job creation at 10:59 AM IST ─────────────
-- IST = UTC+5:30  →  10:59 AM IST = 05:29 AM UTC
-- This calls the backend endpoint which generates all cabin print jobs.
-- Requires pg_cron + pg_net extensions enabled in Supabase dashboard.
SELECT cron.schedule(
  'schedule-meal-prints-daily',
  '29 5 * * 1-5',   -- 05:29 UTC = 10:59 AM IST, Monday to Friday
  $$
    SELECT net.http_post(
      url := 'https://inventory-vgor.onrender.com/api/cron/schedule-meal-print',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"secret":"app_wizz_cron_secret_change_in_production"}'::jsonb
    )
  $$
);
