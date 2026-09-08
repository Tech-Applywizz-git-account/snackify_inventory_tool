-- =====================================================================
-- 0018_configure_sandwich_spread_items.sql
-- Configure Peanut Butter / Jam as sandwich spread items.
-- Rule: one sandwich always uses 2 bread slices; one/both slice choice
-- only changes the spread serving count.
-- =====================================================================

ALTER TABLE IF EXISTS public.cafeteria_items
  ADD COLUMN IF NOT EXISTS frontend_name text;

ALTER TABLE IF EXISTS public.cafeteria_items
  ADD COLUMN IF NOT EXISTS sandwich_type text DEFAULT 'regular';

ALTER TABLE IF EXISTS public.cafeteria_items
  ADD COLUMN IF NOT EXISTS sides_option boolean DEFAULT false;

ALTER TABLE IF EXISTS public.cafeteria_items
  ADD COLUMN IF NOT EXISTS dependencies jsonb DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS public.cafeteria_items
  ADD COLUMN IF NOT EXISTS stock_servings integer;

ALTER TABLE IF EXISTS public.cafeteria_items
  ADD COLUMN IF NOT EXISTS stock_today integer;

DO $$
DECLARE
  keep_id uuid;
  total_stock integer;
  total_servings integer;
BEGIN
  IF to_regclass('public.cafeteria_items') IS NULL THEN
    RETURN;
  END IF;

  -- Keep bread as hidden backing stock rows. They are not ordered directly.
  IF NOT EXISTS (
    SELECT 1 FROM public.cafeteria_items
    WHERE lower(item_name) = 'bread'
  ) THEN
    INSERT INTO public.cafeteria_items (
      item_name, display_name, frontend_name, category, emoji, description,
      tags, available, orderable, stock_today, stock_servings, sides_option,
      dependencies, sandwich_type
    )
    VALUES (
      'Bread', 'Milk Bread', 'Milk Bread', 'food', '🍞', 'Backing stock for sandwiches',
      ARRAY['bread'], true, false, 0, 0, false, '[]'::jsonb, 'regular'
    );
  ELSE
    UPDATE public.cafeteria_items
    SET display_name = COALESCE(display_name, 'Milk Bread'),
        frontend_name = COALESCE(frontend_name, 'Milk Bread'),
        tags = CASE WHEN 'bread' = ANY(COALESCE(tags, ARRAY[]::text[])) THEN tags ELSE COALESCE(tags, ARRAY[]::text[]) || ARRAY['bread'] END,
        orderable = false,
        available = true
    WHERE lower(item_name) = 'bread';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cafeteria_items
    WHERE lower(item_name) = 'mdrn at shk brd400g'
  ) THEN
    INSERT INTO public.cafeteria_items (
      item_name, display_name, frontend_name, category, emoji, description,
      tags, available, orderable, stock_today, stock_servings, sides_option,
      dependencies, sandwich_type
    )
    VALUES (
      'MDRN AT SHK BRD400G', 'Atta Bread', 'Atta Bread', 'food', '🍞', 'Backing stock for sandwiches',
      ARRAY['bread'], true, false, 0, 0, false, '[]'::jsonb, 'regular'
    );
  ELSE
    UPDATE public.cafeteria_items
    SET display_name = COALESCE(display_name, 'Atta Bread'),
        frontend_name = COALESCE(frontend_name, 'Atta Bread'),
        tags = CASE WHEN 'bread' = ANY(COALESCE(tags, ARRAY[]::text[])) THEN tags ELSE COALESCE(tags, ARRAY[]::text[]) || ARRAY['bread'] END,
        orderable = false,
        available = true
    WHERE lower(item_name) = 'mdrn at shk brd400g';
  END IF;

  -- Peanut Butter Sandwich: consolidate any existing peanut butter SKU row.
  SELECT id INTO keep_id
  FROM public.cafeteria_items
  WHERE item_name ILIKE '%peanut butter%'
     OR display_name ILIKE '%peanut butter%'
     OR frontend_name ILIKE '%peanut butter%'
  ORDER BY created_at NULLS LAST, id
  LIMIT 1;

  SELECT
    COALESCE(SUM(COALESCE(stock_today, 0)), 0)::integer,
    COALESCE(SUM(COALESCE(stock_servings, 0)), 0)::integer
  INTO total_stock, total_servings
  FROM public.cafeteria_items
  WHERE item_name ILIKE '%peanut butter%'
     OR display_name ILIKE '%peanut butter%'
     OR frontend_name ILIKE '%peanut butter%';

  IF keep_id IS NULL THEN
    INSERT INTO public.cafeteria_items (
      item_name, display_name, frontend_name, category, emoji, description,
      tags, available, orderable, stock_today, stock_servings, sides_option,
      dependencies, sandwich_type
    )
    VALUES (
      'Peanut Butter Sandwich', 'Peanut Butter Sandwich', 'Peanut Butter Sandwich',
      'food', '🥜', 'Choose bread and spread on one or both slices',
      ARRAY['sandwich','spread'], true, true, 0, 0, true, '["Bread"]'::jsonb, 'peanut_butter'
    );
  ELSE
    UPDATE public.cafeteria_items
    SET item_name = 'Peanut Butter Sandwich',
        display_name = 'Peanut Butter Sandwich',
        frontend_name = 'Peanut Butter Sandwich',
        category = 'food',
        emoji = '🥜',
        description = 'Choose bread and spread on one or both slices',
        tags = ARRAY['sandwich','spread'],
        available = true,
        orderable = true,
        stock_today = total_stock,
        stock_servings = total_servings,
        sides_option = true,
        dependencies = '["Bread"]'::jsonb,
        sandwich_type = 'peanut_butter'
    WHERE id = keep_id;

    UPDATE public.cafeteria_items
    SET available = false,
        orderable = false
    WHERE id <> keep_id
      AND (
        item_name ILIKE '%peanut butter%'
        OR display_name ILIKE '%peanut butter%'
        OR frontend_name ILIKE '%peanut butter%'
      );
  END IF;

  -- Mix Fruit Jam Sandwich: create if missing.
  IF NOT EXISTS (
    SELECT 1 FROM public.cafeteria_items
    WHERE item_name ILIKE '%mix fruit%jam%'
       OR item_name ILIKE '%mixed fruit%jam%'
       OR frontend_name ILIKE 'Mix Fruit Jam Sandwich'
  ) THEN
    INSERT INTO public.cafeteria_items (
      item_name, display_name, frontend_name, category, emoji, description,
      tags, available, orderable, stock_today, stock_servings, sides_option,
      dependencies, sandwich_type
    )
    VALUES (
      'Mix Fruit Jam Sandwich', 'Mix Fruit Jam Sandwich', 'Mix Fruit Jam Sandwich',
      'food', '🍓', 'Choose bread and spread on one or both slices',
      ARRAY['sandwich','spread'], true, true, 0, 0, true, '["Bread"]'::jsonb, 'mix_fruit_jam'
    );
  ELSE
    UPDATE public.cafeteria_items
    SET item_name = 'Mix Fruit Jam Sandwich',
        display_name = 'Mix Fruit Jam Sandwich',
        frontend_name = 'Mix Fruit Jam Sandwich',
        category = 'food',
        emoji = '🍓',
        description = 'Choose bread and spread on one or both slices',
        tags = ARRAY['sandwich','spread'],
        available = true,
        orderable = true,
        sides_option = true,
        dependencies = '["Bread"]'::jsonb,
        sandwich_type = 'mix_fruit_jam'
    WHERE item_name ILIKE '%mix fruit%jam%'
       OR item_name ILIKE '%mixed fruit%jam%'
       OR frontend_name ILIKE 'Mix Fruit Jam Sandwich';
  END IF;

  -- Pineapple Jam Sandwich: create if missing.
  IF NOT EXISTS (
    SELECT 1 FROM public.cafeteria_items
    WHERE item_name ILIKE '%pineapple%jam%'
       OR frontend_name ILIKE 'Pineapple Jam Sandwich'
  ) THEN
    INSERT INTO public.cafeteria_items (
      item_name, display_name, frontend_name, category, emoji, description,
      tags, available, orderable, stock_today, stock_servings, sides_option,
      dependencies, sandwich_type
    )
    VALUES (
      'Pineapple Jam Sandwich', 'Pineapple Jam Sandwich', 'Pineapple Jam Sandwich',
      'food', '🍍', 'Choose bread and spread on one or both slices',
      ARRAY['sandwich','spread'], true, true, 0, 0, true, '["Bread"]'::jsonb, 'pineapple_jam'
    );
  ELSE
    UPDATE public.cafeteria_items
    SET item_name = 'Pineapple Jam Sandwich',
        display_name = 'Pineapple Jam Sandwich',
        frontend_name = 'Pineapple Jam Sandwich',
        category = 'food',
        emoji = '🍍',
        description = 'Choose bread and spread on one or both slices',
        tags = ARRAY['sandwich','spread'],
        available = true,
        orderable = true,
        sides_option = true,
        dependencies = '["Bread"]'::jsonb,
        sandwich_type = 'pineapple_jam'
    WHERE item_name ILIKE '%pineapple%jam%'
       OR frontend_name ILIKE 'Pineapple Jam Sandwich';
  END IF;
END $$;
