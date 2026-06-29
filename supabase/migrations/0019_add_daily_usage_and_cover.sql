-- =====================================================================
-- 0019_add_daily_usage_and_cover.sql
-- Phase 1: Days-of-Cover for perishables.
--
-- Adds an optional leadership-set `daily_usage` (units consumed per day)
-- to products, then extends v_inventory_status to compute:
--   days_of_cover  = current_stock / daily_usage      (when to reorder)
--   max_safe_order = daily_usage * shelf_life_days     (avoid over-ordering)
--   cover_status   = ok | order_soon | order_now | waste_risk
--
-- daily_usage is nullable: when unset, cover columns are NULL and the UI
-- simply shows no badge. No guessing happens in SQL.
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS daily_usage numeric(10, 2)
  CHECK (daily_usage IS NULL OR daily_usage >= 0);

COMMENT ON COLUMN public.products.daily_usage IS
  'Phase 1 days-of-cover: leadership estimate of units consumed per day. NULL = not set.';

-- Recreate the view with the original columns plus the cover calculations.
-- (Original definition lives in 0001_init_schema.sql.)
-- NOTE: CREATE OR REPLACE VIEW can only APPEND columns at the end and must
-- keep the original column order. The first 11 columns below are identical to
-- the 0001 definition; the 5 cover columns are appended after expiry_status.
CREATE OR REPLACE VIEW public.v_inventory_status AS
SELECT
  p.id                  AS product_id,
  p.name                AS product_name,
  p.category,
  p.unit,
  p.cost_per_unit,
  i.current_stock,
  i.min_threshold,
  i.expiry_date,
  i.last_updated,
  CASE
    WHEN i.current_stock <= 0 THEN 'out_of_stock'
    WHEN i.current_stock <= i.min_threshold THEN 'low'
    ELSE 'ok'
  END                   AS stock_status,
  CASE
    WHEN i.expiry_date IS NULL THEN NULL
    WHEN i.expiry_date < current_date THEN 'expired'
    WHEN i.expiry_date <= current_date + INTERVAL '2 days' THEN 'expiring_soon'
    ELSE 'fresh'
  END                   AS expiry_status,
  -- ---- appended columns (Phase 1 days-of-cover) ----
  p.shelf_life_days,
  p.daily_usage,
  -- Days of cover: how many days of stock remain at the estimated usage rate.
  CASE
    WHEN p.daily_usage IS NOT NULL AND p.daily_usage > 0
      THEN round(i.current_stock / p.daily_usage, 1)
    ELSE NULL
  END                   AS days_of_cover,
  -- Max safe order: never hold more than can be consumed before expiry.
  CASE
    WHEN p.daily_usage IS NOT NULL AND p.daily_usage > 0
         AND p.shelf_life_days IS NOT NULL
      THEN p.daily_usage * p.shelf_life_days
    ELSE NULL
  END                   AS max_safe_order,
  -- Cover status: drives badge colour and the daily digest.
  CASE
    WHEN p.daily_usage IS NULL OR p.daily_usage <= 0 THEN NULL
    WHEN p.shelf_life_days IS NOT NULL
         AND i.current_stock > (p.daily_usage * p.shelf_life_days) THEN 'waste_risk'
    WHEN i.current_stock <= 0 THEN 'order_now'
    WHEN (i.current_stock / p.daily_usage) <= 1 THEN 'order_now'
    WHEN (i.current_stock / p.daily_usage) <= 2 THEN 'order_soon'
    ELSE 'ok'
  END                   AS cover_status
FROM public.products p
LEFT JOIN public.inventory i ON i.product_id = p.id
WHERE p.active = true;
