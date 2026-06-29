-- =====================================================================
-- 0029_profiles_active_status.sql
--
-- Add active status flag to public.profiles
--
-- Apply via Supabase SQL Editor only.
-- DO NOT run with supabase db push against production.
-- =====================================================================


-- ---------------------------------------------------------------
-- Add active column to public.profiles
-- ---------------------------------------------------------------
-- Purpose:
--   Allows an employee profile to be disabled without deleting the
--   auth user, changing roles, changing the role enum, or touching
--   the leadership trigger.
--
-- Existing employees remain active by default.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
