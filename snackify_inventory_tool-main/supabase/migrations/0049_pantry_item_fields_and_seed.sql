-- Add admin-created cafeteria item fields and seed the new pantry products.
ALTER TABLE public.cafeteria_items
  ADD COLUMN IF NOT EXISTS visible_to_employees boolean NOT NULL DEFAULT true;

UPDATE public.cafeteria_items
SET frontend_name = COALESCE(frontend_name, display_name, item_name)
WHERE frontend_name IS NULL;

INSERT INTO public.token_items (sku_code, display_name, kind, tokens, aliases, active)
VALUES
  ('CAF_CHILLI_CHEESE_BLEND', 'Chilli cheese blend', 'snack', 15, ARRAY['Chilli cheese blend'], true),
  ('CAF_JALAPENO_DIP', 'Jalapeno dip', 'snack', 15, ARRAY['Jalapeno dip'], true),
  ('CAF_AVOCADO_SALSA_DRESSING', 'Avocado salsa dressing', 'snack', 15, ARRAY['Avocado salsa dressing'], true)
ON CONFLICT (sku_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    kind = EXCLUDED.kind,
    tokens = EXCLUDED.tokens,
    aliases = EXCLUDED.aliases,
    active = true;

INSERT INTO public.cafeteria_items (
  item_name, display_name, frontend_name, category, emoji,
  description, available, orderable, stock_today, stock_servings,
  sandwich_type, visible_to_employees
)
SELECT 'Chilli cheese blend', 'Chilli cheese blend', 'Chilli cheese blend', 'food', '🧀', 'Food / Pantry item', true, true, 100, 100, 'regular', true
WHERE NOT EXISTS (SELECT 1 FROM public.cafeteria_items WHERE item_name = 'Chilli cheese blend');

INSERT INTO public.cafeteria_items (
  item_name, display_name, frontend_name, category, emoji,
  description, available, orderable, stock_today, stock_servings,
  sandwich_type, visible_to_employees
)
SELECT 'Jalapeno dip', 'Jalapeno dip', 'Jalapeno dip', 'food', '🌶️', 'Food / Pantry item', true, true, 100, 100, 'regular', true
WHERE NOT EXISTS (SELECT 1 FROM public.cafeteria_items WHERE item_name = 'Jalapeno dip');

INSERT INTO public.cafeteria_items (
  item_name, display_name, frontend_name, category, emoji,
  description, available, orderable, stock_today, stock_servings,
  sandwich_type, visible_to_employees
)
SELECT 'Avocado salsa dressing', 'Avocado salsa dressing', 'Avocado salsa dressing', 'food', '🥑', 'Food / Pantry item', true, true, 100, 100, 'regular', true
WHERE NOT EXISTS (SELECT 1 FROM public.cafeteria_items WHERE item_name = 'Avocado salsa dressing');

-- Repair an existing row when the product was added before this seed ran.
UPDATE public.cafeteria_items
SET display_name = 'Chilli cheese blend',
    frontend_name = 'Chilli cheese blend',
    category = 'food',
    emoji = '🧀',
    description = COALESCE(NULLIF(description, ''), 'Food / Pantry item'),
    available = true,
    orderable = true,
    stock_today = CASE WHEN stock_today IS NULL OR stock_today <= 0 THEN 100 ELSE stock_today END,
    stock_servings = CASE WHEN stock_servings IS NULL OR stock_servings <= 0 THEN 100 ELSE stock_servings END,
    sandwich_type = 'regular',
    visible_to_employees = true
WHERE item_name = 'Chilli cheese blend';

UPDATE public.token_items t
SET cafeteria_item_id = c.id
FROM public.cafeteria_items c
WHERE t.sku_code = 'CAF_' || upper(regexp_replace(c.item_name, '[^A-Za-z0-9]+', '_', 'g'))
  AND c.item_name IN ('Chilli cheese blend', 'Jalapeno dip', 'Avocado salsa dressing');