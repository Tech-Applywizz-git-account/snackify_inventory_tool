-- =====================================================================
-- 0041_guest_meal_columns.sql
-- Add is_guest and guest_name columns to meal_bookings table
-- for supporting guest meal bookings
-- =====================================================================

ALTER TABLE meal_bookings
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_name TEXT;
