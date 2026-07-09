-- =====================================================================
-- rollback_0040_sync_cabin_cron.sql
-- Unschedule sync-missing-cabins cron job
-- =====================================================================

SELECT cron.unschedule('sync-missing-cabins-cron');
