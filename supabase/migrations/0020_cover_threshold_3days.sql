-- =====================================================================
-- 0020_cover_threshold_3days.sql
-- Raise the "order_soon" alert threshold from 2 days to 3 days.
-- order_now  = out of stock OR <= 1 day cover
-- order_soon = <= 3 days cover  (was: <= 2)
-- =====================================================================

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
  p.shelf_life_days,
  p.daily_usage,
  CASE
    WHEN p.daily_usage IS NOT NULL AND p.daily_usage > 0
      THEN round(i.current_stock / p.daily_usage, 1)
    ELSE NULL
  END                   AS days_of_cover,
  CASE
    WHEN p.daily_usage IS NOT NULL AND p.daily_usage > 0
         AND p.shelf_life_days IS NOT NULL
      THEN p.daily_usage * p.shelf_life_days
    ELSE NULL
  END                   AS max_safe_order,
  CASE
    WHEN p.daily_usage IS NULL OR p.daily_usage <= 0 THEN NULL
    WHEN p.shelf_life_days IS NOT NULL
         AND i.current_stock > (p.daily_usage * p.shelf_life_days) THEN 'waste_risk'
    WHEN i.current_stock <= 0 THEN 'order_now'
    WHEN (i.current_stock / p.daily_usage) <= 1 THEN 'order_now'
    WHEN (i.current_stock / p.daily_usage) <= 3 THEN 'order_soon'
    ELSE 'ok'
  END                   AS cover_status
FROM public.products p
LEFT JOIN public.inventory i ON i.product_id = p.id
WHERE p.active = true;
