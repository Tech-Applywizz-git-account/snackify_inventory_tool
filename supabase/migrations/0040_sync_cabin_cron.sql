-- =====================================================================
-- 0040_sync_cabin_cron.sql
-- Schedule sync-missing-cabins cron job every day at 8:15 PM IST
-- =====================================================================

SELECT cron.schedule(
  'sync-missing-cabins-cron',
  '45 14 * * *',   -- 2:45 PM UTC = 8:15 PM IST, runs every day
  $$
    SELECT net.http_post(
      url := 'https://snackify-inventory-tool.onrender.com/api/cron/sync-missing-cabins',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"secret":"app_wizz_cron_secret_change_in_production"}'::jsonb
    )
  $$
);
