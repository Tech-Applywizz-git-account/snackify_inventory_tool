-- =====================================================================
-- 0039_meal_booking_confirmation_cron.sql
-- Schedule daily meal booking confirmation at 8:20 PM IST (14:50 UTC)
-- =====================================================================

SELECT cron.schedule(
  'meal-booking-confirmation-daily',
  '50 14 * * *',   -- 2:50 PM UTC = 8:20 PM IST, runs every day
  $$
    SELECT net.http_post(
      url := 'https://snackify-inventory-tool.onrender.com/api/cron/meal-booking-confirmation',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"secret":"app_wizz_cron_secret_change_in_production"}'::jsonb
    )
  $$
);
