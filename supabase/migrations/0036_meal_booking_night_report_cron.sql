-- =====================================================================
-- 0036_meal_booking_night_report_cron.sql
-- Schedule daily meal booking night report at 8:30 PM IST
-- =====================================================================

SELECT cron.schedule(
  'meal-booking-night-report-daily',
  '0 15 * * *',   -- 3:00 PM UTC = 8:30 PM IST, runs every day
  $$
    SELECT net.http_post(
      url := 'https://snackify-inventory-tool.onrender.com/api/cron/meal-booking-night-report',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"secret":"app_wizz_cron_secret_change_in_production"}'::jsonb
    )
  $$
);
