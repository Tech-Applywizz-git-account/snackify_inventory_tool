-- =====================================================================
-- Applyways Office Pantry — Starter Product Catalog (34 items)
-- Run AFTER 0001_init_schema.sql
-- Inserts products and creates a matching inventory row per product.
-- =====================================================================

insert into public.products (name, category, unit, cost_per_unit, shelf_life_days, active) values
  -- Consumables (bread, snacks, biscuits)
  ('Brown Bread Loaf',        'consumables',      'pieces', 45.00,   10, true),
  ('White Bread Loaf',        'consumables',      'pieces', 40.00,   10, true),
  ('Eggs (Tray of 30)',       'consumables',      'pieces', 210.00,  21, true),
  ('Butter (500g)',           'consumables',      'packs',  280.00,  60, true),
  ('Cheese Slices (200g)',    'consumables',      'packs',  185.00,  45, true),
  ('Marie Biscuits',          'consumables',      'packs',   35.00, 180, true),
  ('Mixed Fruit Jam (500g)',  'consumables',      'pieces', 165.00, 365, true),
  ('Honey (500g)',            'consumables',      'pieces', 320.00, 730, true),
  ('Peanut Butter (350g)',    'consumables',      'pieces', 240.00, 270, true),

  -- Coffee Materials
  ('Coffee Beans (1kg)',      'coffee_materials', 'kg',     950.00, 365, true),
  ('Filter Coffee Powder',    'coffee_materials', 'packs',  220.00, 180, true),
  ('Instant Coffee (200g)',   'coffee_materials', 'pieces', 480.00, 720, true),
  ('Tea Bags (100ct)',        'coffee_materials', 'boxes',  185.00, 540, true),
  ('Green Tea (25ct)',        'coffee_materials', 'boxes',  240.00, 540, true),
  ('Sugar (1kg)',             'coffee_materials', 'kg',      48.00, 540, true),
  ('Brown Sugar (500g)',      'coffee_materials', 'packs',   85.00, 540, true),
  ('Coffee Filters (100ct)',  'coffee_materials', 'packs',  110.00, 730, true),
  ('Coffee Stirrers (500ct)', 'coffee_materials', 'packs',   95.00, 730, true),

  -- Washroom & Cleaning
  ('Toilet Tissue Roll',      'washroom',         'pieces',  28.00,    null, true),
  ('Hand Soap Refill (1L)',   'washroom',         'liters', 175.00,  720, true),
  ('Hand Sanitizer (500ml)',  'washroom',         'pieces', 145.00,  730, true),
  ('Paper Hand Towels',       'washroom',         'packs',  120.00,    null, true),
  ('Toilet Cleaner (1L)',     'washroom',         'pieces',  95.00,  720, true),
  ('Air Freshener',           'washroom',         'pieces', 165.00,  365, true),
  ('Floor Cleaner (1L)',      'washroom',         'pieces', 110.00,  720, true),
  ('Garbage Bags (Large)',    'washroom',         'packs',   75.00,    null, true),

  -- Beverages
  ('Mineral Water (1L)',      'beverages',        'pieces',  20.00,  365, true),
  ('Mineral Water (20L)',     'beverages',        'pieces', 120.00,  365, true),
  ('Tetra Pack Milk (1L)',    'beverages',        'pieces',  72.00,  180, true),
  ('Fresh Milk (1L)',         'beverages',        'liters',  68.00,    3, true),
  ('Orange Juice (1L)',       'beverages',        'pieces', 145.00,    7, true),
  ('Apple Juice (1L)',        'beverages',        'pieces', 140.00,    7, true),
  ('Coconut Water (200ml)',   'beverages',        'pieces',  45.00,    5, true),
  ('Energy Drink',            'beverages',        'pieces',  95.00,  365, true)
on conflict (name) do nothing;

-- Create inventory rows for every product with sensible defaults.
insert into public.inventory (product_id, current_stock, min_threshold, date_added, expiry_date)
select
  p.id,
  case p.category
    when 'consumables'      then 8
    when 'coffee_materials' then 5
    when 'washroom'         then 12
    when 'beverages'        then 20
  end as current_stock,
  case p.category
    when 'consumables'      then 3
    when 'coffee_materials' then 2
    when 'washroom'         then 4
    when 'beverages'        then 6
  end as min_threshold,
  current_date as date_added,
  case
    when p.shelf_life_days is not null
      then current_date + (p.shelf_life_days || ' days')::interval
    else null
  end as expiry_date
from public.products p
on conflict (product_id) do nothing;
