-- Immediate confirmation emails are sent by POST /api/meals/book.
-- The nightly job remains as a fallback for failed immediate sends.
ALTER TABLE public.meal_bookings
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;