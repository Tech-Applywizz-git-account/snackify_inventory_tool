-- =====================================================================
-- rollback_0012_meal_box_system.sql
-- Rollback for ApplyWizz Meal Box System
-- =====================================================================
-- Run in: https://supabase.com/dashboard/project/twmadauhauuypioznpus/sql/new
--

-- ── 1. Remove pg_cron job ───────────────────────────────────────────
SELECT cron.unschedule('schedule-meal-prints-daily');

-- ── 2. Drop RLS policies ─────────────────────────────────────────────
DROP POLICY IF EXISTS "meal_print_jobs_read_privileged" ON public.meal_print_jobs;
DROP POLICY IF EXISTS "meal_print_jobs_insert_privileged" ON public.meal_print_jobs;
DROP POLICY IF EXISTS "meal_bookings_own_read" ON public.meal_bookings;
DROP POLICY IF EXISTS "meal_bookings_privileged_read" ON public.meal_bookings;

-- ── 3. Drop tables and indexes ───────────────────────────────────────
DROP TABLE IF EXISTS public.meal_print_jobs CASCADE;

-- ── 4. Remove columns from meal_bookings ────────────────────────────
ALTER TABLE public.meal_bookings
  DROP COLUMN IF EXISTS token_number,
  DROP COLUMN IF EXISTS cabin_name,
  DROP COLUMN IF EXISTS print_count,
  DROP COLUMN IF EXISTS last_printed_at,
  DROP COLUMN IF EXISTS last_printed_by;

-- ── 5. Remove column from employee_cafeteria_preferences ──────────────
ALTER TABLE public.employee_cafeteria_preferences
  DROP COLUMN IF EXISTS cabin;
