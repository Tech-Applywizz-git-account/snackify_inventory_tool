-- Durable meal QR check-ins. Daily serving reports are derived from these rows
-- and the corresponding meal_bookings; a separate daily totals table is not
-- required.
CREATE TABLE IF NOT EXISTS public.meal_checkins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  meal_booking_id uuid NOT NULL
    REFERENCES public.meal_bookings(id) ON DELETE RESTRICT,
  meal_date date NOT NULL,
  meal_choice text NOT NULL
    CHECK (meal_choice IN ('veg', 'non_veg', 'egg')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_checkins_one_per_booking UNIQUE (meal_booking_id)
);

CREATE INDEX IF NOT EXISTS idx_meal_checkins_date
  ON public.meal_checkins (meal_date, checked_in_at DESC);

ALTER TABLE public.meal_checkins ENABLE ROW LEVEL SECURITY;

-- Check-in reads and writes are handled by the trusted backend service role.
GRANT ALL ON public.meal_checkins TO service_role;

COMMENT ON TABLE public.meal_checkins IS
  'Successful meal QR check-ins. Daily reports are derived from meal_bookings and these records.';
