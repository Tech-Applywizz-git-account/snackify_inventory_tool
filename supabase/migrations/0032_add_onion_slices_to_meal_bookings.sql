-- ── Add onion_slices column to meal_bookings ──
ALTER TABLE public.meal_bookings
  ADD COLUMN IF NOT EXISTS onion_slices TEXT DEFAULT NULL;
