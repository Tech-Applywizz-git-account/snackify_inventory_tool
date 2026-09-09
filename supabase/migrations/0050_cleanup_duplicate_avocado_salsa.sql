-- Keep the stocked Avocado Salsa item and remove a duplicate that is unavailable.
WITH avocado_rows AS (
  SELECT id, available, stock_today, stock_servings
  FROM public.cafeteria_items
    WHERE lower(trim(item_name)) IN ('avocado salsa', 'avocado salsa dressing')
      OR lower(trim(display_name)) IN ('avocado salsa', 'avocado salsa dressing')
      OR lower(trim(frontend_name)) IN ('avocado salsa', 'avocado salsa dressing')
), keeper AS (
  SELECT id
  FROM avocado_rows
  ORDER BY (available AND COALESCE(stock_today, 0) > 0 AND COALESCE(stock_servings, 0) > 0) DESC,
           COALESCE(stock_servings, 0) DESC,
           id
  LIMIT 1
), stale AS (
  SELECT avocado.id
  FROM avocado_rows avocado
  CROSS JOIN keeper
  WHERE avocado.id <> keeper.id
    AND COALESCE(avocado.stock_today, 0) <= 0
    AND COALESCE(avocado.stock_servings, 0) <= 0
)
UPDATE public.token_items
SET cafeteria_item_id = (SELECT id FROM keeper)
WHERE cafeteria_item_id IN (SELECT id FROM stale);

WITH avocado_rows AS (
  SELECT id, available, stock_today, stock_servings
  FROM public.cafeteria_items
    WHERE lower(trim(item_name)) IN ('avocado salsa', 'avocado salsa dressing')
      OR lower(trim(display_name)) IN ('avocado salsa', 'avocado salsa dressing')
      OR lower(trim(frontend_name)) IN ('avocado salsa', 'avocado salsa dressing')
), keeper AS (
  SELECT id
  FROM avocado_rows
  ORDER BY (available AND COALESCE(stock_today, 0) > 0 AND COALESCE(stock_servings, 0) > 0) DESC,
           COALESCE(stock_servings, 0) DESC,
           id
  LIMIT 1
)
DELETE FROM public.cafeteria_items item
WHERE item.id IN (
  SELECT avocado.id
  FROM avocado_rows avocado
  CROSS JOIN keeper
  WHERE avocado.id <> keeper.id
    AND COALESCE(avocado.stock_today, 0) <= 0
    AND COALESCE(avocado.stock_servings, 0) <= 0
);