-- =====================================================================
-- 0041_meal_booking_night_shift_report_cron.sql
-- Schedule same-day night-shift meal count at 10:15 PM IST (16:45 UTC)
-- =====================================================================

SELECT cron.schedule(
  'meal-booking-night-shift-report-daily',
  '45 16 * * *',   -- 4:45 PM UTC = 10:15 PM IST, runs every day
  $$
    SELECT net.http_post(
      url := 'https://snackify-inventory-tool.onrender.com/api/cron/meal-booking-night-shift-report',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"secret":"app_wizz_cron_secret_change_in_production"}'::jsonb
    )
  $$
);