-- =====================================================================
-- 0035_meal_booking_reminder_final_cron.sql
-- Schedule final meal booking reminder at 5:15 PM IST
-- =====================================================================

SELECT cron.schedule(
  'meal-booking-reminder-final-daily',
  '45 11 * * *',   -- 11:45 AM UTC = 5:15 PM IST, runs every day
  $$
    SELECT net.http_post(
      url := 'https://inventory-vgor.onrender.com/api/cron/meal-booking-reminder',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"secret":"app_wizz_cron_secret_change_in_production"}'::jsonb
    )
  $$
);
