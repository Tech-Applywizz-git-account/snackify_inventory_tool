-- =====================================================================
-- 0034_meal_booking_reminder_cron.sql
-- Schedule daily meal booking reminder at 4:15 PM IST
-- =====================================================================

SELECT cron.schedule(
  'meal-booking-reminder-daily',
  '45 10 * * *',   -- 10:45 AM UTC = 4:15 PM IST, runs every day
  $$
    SELECT net.http_post(
      url := 'https://snackify-inventory-tool.onrender.com/api/cron/meal-booking-reminder',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"secret":"app_wizz_cron_secret_change_in_production"}'::jsonb
    )
  $$
);
