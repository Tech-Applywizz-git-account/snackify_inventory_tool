-- =====================================================================
-- 0017_enforce_unique_meal_booking.sql
-- Ensure one meal booking per user per meal date.
-- =====================================================================

-- Keep an audit trail before removing duplicate rows. This makes the
-- cleanup reversible from data if production already contains duplicates.
CREATE TABLE IF NOT EXISTS public.meal_booking_duplicate_cleanup_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cleaned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kept_booking_id UUID NOT NULL,
  removed_booking JSONB NOT NULL
);

ALTER TABLE public.meal_booking_duplicate_cleanup_audit ENABLE ROW LEVEL SECURITY;

WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, meal_date
      ORDER BY
        CASE WHEN token_number IS NOT NULL THEN 0 ELSE 1 END,
        booked_at DESC NULLS LAST,
        id DESC
    ) AS kept_booking_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, meal_date
      ORDER BY
        CASE WHEN token_number IS NOT NULL THEN 0 ELSE 1 END,
        booked_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM public.meal_bookings
)
INSERT INTO public.meal_booking_duplicate_cleanup_audit (
  kept_booking_id,
  removed_booking
)
SELECT
  ranked.kept_booking_id,
  to_jsonb(meal_bookings.*)
FROM public.meal_bookings
JOIN ranked ON ranked.id = meal_bookings.id
WHERE ranked.rn > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, meal_date
      ORDER BY
        CASE WHEN token_number IS NOT NULL THEN 0 ELSE 1 END,
        booked_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM public.meal_bookings
)
DELETE FROM public.meal_bookings
USING ranked
WHERE meal_bookings.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_bookings_user_date_unique
  ON public.meal_bookings (user_id, meal_date);
