-- =====================================================================
-- 0010_fix_cafeteria_prefs_and_status_enum.sql
-- Run this in: https://supabase.com/dashboard/project/twmadauhauuypioznpus/sql/new
--
-- Fixes:
--   1. Add missing 'preferred_drink' column to employee_cafeteria_preferences
--   2. Add missing 'item_prefs' column to employee_cafeteria_preferences
--   3. Add 'confirming' value to request_status enum
-- =====================================================================

-- Fix 1 & 2: Add missing columns to employee_cafeteria_preferences
alter table public.employee_cafeteria_preferences
  add column if not exists preferred_drink text default 'Tea',
  add column if not exists item_prefs jsonb default '{}';

-- Fix 3: Add 'confirming' to request_status enum
-- (required because the backend uses status='confirming' for the 30s cancel window)
do $$ begin
  alter type request_status add value if not exists 'confirming';
exception when others then null; end $$;
