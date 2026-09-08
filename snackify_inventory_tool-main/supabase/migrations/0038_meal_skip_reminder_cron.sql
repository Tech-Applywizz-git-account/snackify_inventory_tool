-- =====================================================================
-- 0038_meal_skip_reminder_cron.sql
-- Schedule daily meal skip reminder at 7:00 PM IST (13:30 UTC)
-- =====================================================================

SELECT cron.schedule(
  'meal-skip-reminder-daily',
  '30 13 * * *',   -- 1:30 PM UTC = 7:00 PM IST, runs every day
  $$
    SELECT net.http_post(
      url := 'https://snackify-inventory-tool.onrender.com/api/cron/meal-skip-reminder',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"secret":"app_wizz_cron_secret_change_in_production"}'::jsonb
    )
  $$
);
