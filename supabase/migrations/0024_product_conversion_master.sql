-- ─────────────────────────────────────────────────────────────────────────────
-- 0024 · Product Conversion Master + Safe AI Fallback
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Classification enum
DO $$ BEGIN
  CREATE TYPE item_classification AS ENUM (
    'direct_menu_stock',
    'ingredient_or_dependency',
    'recipe_stock',
    'internal_supply',
    'equipment_asset',
    'finance_expense',
    'unknown_pending_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Product Conversion Master
CREATE TABLE IF NOT EXISTS product_conversion_master (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name           text NOT NULL,
  vendor_name              text,
  aliases                  text[] NOT NULL DEFAULT '{}',
  classification           item_classification NOT NULL DEFAULT 'unknown_pending_review',
  purchase_unit            text NOT NULL DEFAULT 'unit',
  storage_unit             text NOT NULL DEFAULT 'unit',
  units_per_purchase_unit  numeric,                        -- e.g. 100 cups per box
  employee_serving_unit    text,                           -- 'cup', 'slice', etc.
  cafeteria_item_name      text,                           -- matches cafeteria_items.item_name
  visible_to_employees     boolean NOT NULL DEFAULT false,
  employee_orderable       boolean NOT NULL DEFAULT false,
  recipe_required          boolean NOT NULL DEFAULT false,
  approval_status          text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('approved', 'pending', 'rejected')),
  evidence_note            text,
  approved_by              text,
  approved_at              timestamptz,
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcm_aliases ON product_conversion_master USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_pcm_approval ON product_conversion_master (approval_status, active);

-- 3. Bill items: add conversion columns
ALTER TABLE bill_items
  ADD COLUMN IF NOT EXISTS conversion_master_id uuid REFERENCES product_conversion_master(id),
  ADD COLUMN IF NOT EXISTS normalized_item_name  text,
  ADD COLUMN IF NOT EXISTS converted_quantity    numeric,
  ADD COLUMN IF NOT EXISTS conversion_status     text NOT NULL DEFAULT 'pending_review'
    CHECK (conversion_status IN ('master_match','ai_suggestion','pending_review','manual_linked','applied','no_stock')),
  ADD COLUMN IF NOT EXISTS ai_suggestion         jsonb,
  ADD COLUMN IF NOT EXISTS conversion_error      text,
  ADD COLUMN IF NOT EXISTS processed_at          timestamptz;

-- 4. Bill uploads: add sync tracking columns
ALTER TABLE bill_uploads
  ADD COLUMN IF NOT EXISTS inventory_sync_status text NOT NULL DEFAULT 'not_started'
    CHECK (inventory_sync_status IN ('not_started','partial','complete','blocked')),
  ADD COLUMN IF NOT EXISTS inventory_synced_at   timestamptz;

-- 5. Immutable stock application ledger (unique per bill_item → prevents double-apply)
CREATE TABLE IF NOT EXISTS bill_stock_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_item_id          uuid NOT NULL UNIQUE REFERENCES bill_items(id),
  bill_id               uuid NOT NULL REFERENCES bill_uploads(id),
  conversion_master_id  uuid REFERENCES product_conversion_master(id),
  cafeteria_item_name   text,
  stock_added_quantity  numeric NOT NULL,
  stock_added_unit      text NOT NULL,
  servings_added        numeric,
  applied_by            uuid,
  applied_at            timestamptz NOT NULL DEFAULT now(),
  notes                 text
);

-- 6. Recipe ingredients (grams-per-cup etc. — must be approved before affecting stock)
CREATE TABLE IF NOT EXISTS cafeteria_recipe_ingredients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cafeteria_item_id    uuid NOT NULL REFERENCES cafeteria_items(id),
  master_id            uuid NOT NULL REFERENCES product_conversion_master(id),
  quantity_per_serving numeric NOT NULL,
  unit                 text NOT NULL,
  approved             boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cafeteria_item_id, master_id)
);

-- 7. Add visible_to_employees to cafeteria_items (default true = safe for existing rows)
ALTER TABLE cafeteria_items
  ADD COLUMN IF NOT EXISTS visible_to_employees boolean NOT NULL DEFAULT true;

-- 8. Transactional apply function (idempotent via UNIQUE on bill_stock_applications.bill_item_id)
CREATE OR REPLACE FUNCTION apply_bill_item_stock(
  p_bill_item_id         uuid,
  p_bill_id              uuid,
  p_conversion_master_id uuid,
  p_cafeteria_item_name  text,
  p_stock_quantity       numeric,
  p_stock_unit           text,
  p_servings             numeric,
  p_applied_by           uuid,
  p_notes                text
) RETURNS uuid AS $$
DECLARE
  v_app_id  uuid;
  v_cafe_id uuid;
BEGIN
  -- Idempotency guard
  IF EXISTS (SELECT 1 FROM bill_stock_applications WHERE bill_item_id = p_bill_item_id) THEN
    RAISE EXCEPTION 'ALREADY_APPLIED: bill item % has already been applied', p_bill_item_id;
  END IF;

  INSERT INTO bill_stock_applications (
    bill_item_id, bill_id, conversion_master_id, cafeteria_item_name,
    stock_added_quantity, stock_added_unit, servings_added, applied_by, notes
  ) VALUES (
    p_bill_item_id, p_bill_id, p_conversion_master_id, p_cafeteria_item_name,
    p_stock_quantity, p_stock_unit, p_servings, p_applied_by, p_notes
  ) RETURNING id INTO v_app_id;

  -- Update cafeteria stock when item name is known
  IF p_cafeteria_item_name IS NOT NULL THEN
    SELECT id INTO v_cafe_id
    FROM cafeteria_items
    WHERE item_name = p_cafeteria_item_name
    LIMIT 1;

    IF FOUND THEN
      UPDATE cafeteria_items SET
        stock_today    = COALESCE(stock_today, 0) + p_stock_quantity,
        stock_servings = CASE
          WHEN p_servings IS NOT NULL
          THEN COALESCE(stock_servings, 0) + p_servings
          ELSE stock_servings
        END,
        available = true
      WHERE id = v_cafe_id;
    END IF;
  END IF;

  -- Mark bill_item as applied
  UPDATE bill_items
  SET conversion_status = 'applied',
      processed_at      = now()
  WHERE id = p_bill_item_id;

  RETURN v_app_id;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Seed: approved conversion master records
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO product_conversion_master (
  canonical_name, aliases, classification,
  purchase_unit, storage_unit, units_per_purchase_unit,
  employee_serving_unit, cafeteria_item_name,
  visible_to_employees, employee_orderable, recipe_required,
  approval_status, evidence_note, approved_by, approved_at
) VALUES

-- Assam Tea: 1 box = 100 cups
('Assam Tea',
 ARRAY['assam tea','assam chai','assam tea bags','assam tea sachet','classic assam tea'],
 'direct_menu_stock',
 'box','cup',100,'cup','Assam tea',
 true,true,false,
 'approved','1 box = 100 tea-bag servings confirmed by stock audit','Leadership',now()),

-- Elaichi Tea: 1 box = 100 cups
('Elaichi Tea',
 ARRAY['elaichi tea','cardamom tea','elaichi chai','elaichi tea bags','elaichi tea sachet'],
 'direct_menu_stock',
 'box','cup',100,'cup','Elaichi tea',
 true,true,false,
 'approved','1 box = 100 tea-bag servings confirmed by stock audit','Leadership',now()),

-- Ginger Tea: 1 box = 100 cups
('Ginger Tea',
 ARRAY['ginger tea','adrak tea','ginger chai','ginger tea bags','ginger tea sachet'],
 'direct_menu_stock',
 'box','cup',100,'cup','Ginger tea',
 true,true,false,
 'approved','1 box = 100 tea-bag servings confirmed by stock audit','Leadership',now()),

-- Lemon Sachets: 1 pack = 20 cups → maps to Lemon Tea
('Lemon Sachets',
 ARRAY['lemon sachet','lemon sachets','lemon tea sachet','lemon tea sachets','lemon instant tea'],
 'direct_menu_stock',
 'pack','cup',20,'cup','Lemon sachets',
 true,true,false,
 'approved','1 pack of 20 sachets = 20 lemon tea servings','Leadership',now()),

-- Hot Chocolate: 1 pack = 20 cups
('Hot Chocolate',
 ARRAY['hot chocolate','hot choco','drinking chocolate','cocoa drink','hot cocoa'],
 'direct_menu_stock',
 'pack','cup',20,'cup','Hot chocolate',
 true,true,false,
 'approved','1 pack = 20 serving sachets per label count','Leadership',now()),

-- Badam Pista Mix: 1 pack = 25 cups
('Badam Pista Mix',
 ARRAY['badam pista mix','badam sachets','badam drink','badam mix','almond drink mix','badam pista','badam milk mix'],
 'direct_menu_stock',
 'pack','cup',25,'cup','Badam Sachets',
 true,true,false,
 'approved','1 pack = 25 sachets verified from packaging label','Leadership',now()),

-- Coffee Beans: 1 kg = 1000 grams (recipe_stock — no direct employee cups until recipe approved)
('Coffee Beans',
 ARRAY['coffee beans','coffee bean','arabica coffee beans','espresso beans','robusta beans','coffee powder'],
 'recipe_stock',
 'kg','gram',1000,'gram',null,
 false,false,true,
 'approved','1 kg = 1000 g, cups-per-gram recipe pending approval','Leadership',now()),

-- Stirrers: internal supply, no employee conversion
('Stirrers',
 ARRAY['stirrer','stirrers','coffee stirrer','tea stirrer','plastic stirrer','wooden stirrer','stir sticks'],
 'internal_supply',
 'pack','pcs',null,null,null,
 false,false,false,
 'approved','Internal supply — no employee serving conversion applicable','Leadership',now()),

-- Bread (white/milk/brown)
('Bread',
 ARRAY['bread','milk bread','white bread','brown bread','sandwich bread','white sandwich bread'],
 'direct_menu_stock',
 'pack','slice',16,'slice','Bread',
 true,false,false,
 'approved','Standard 400g loaf = 16 slices (25g per slice)','Leadership',now()),

-- Atta Bread
('Atta Bread',
 ARRAY['atta bread','wheat bread','brown atta bread','whole wheat bread','mdrn at shk brd','atta sandwich bread'],
 'direct_menu_stock',
 'pack','slice',16,'slice','MDRN AT SHK BRD400G',
 true,false,false,
 'approved','Standard 400g loaf = 16 slices (25g per slice)','Leadership',now()),

-- Peanut Butter
('Peanut Butter',
 ARRAY['peanut butter','peanut butter spread','pb spread','crunchy peanut butter','smooth peanut butter'],
 'direct_menu_stock',
 'jar','serving',37,'serving','Peanut Butter Sandwich',
 true,true,false,
 'approved','750g jar / 20g serving = ~37 servings','Leadership',now()),

-- Mix Fruit Jam
('Mix Fruit Jam',
 ARRAY['mix fruit jam','mixed fruit jam','fruit jam','jam mix fruit','strawberry jam','mango jam'],
 'direct_menu_stock',
 'jar','serving',null,'serving','Mix Fruit Jam Sandwich',
 true,true,false,
 'approved','Serving size varies by jar weight — approve quantity when known','Leadership',now()),

-- Pineapple Jam
('Pineapple Jam',
 ARRAY['pineapple jam','pineapple fruit jam','ananas jam'],
 'direct_menu_stock',
 'jar','serving',null,'serving','Pineapple Jam Sandwich',
 true,true,false,
 'approved','Serving size varies by jar weight — approve quantity when known','Leadership',now()),

-- Milk: ingredient/dependency, not directly orderable
('Milk',
 ARRAY['milk','full cream milk','toned milk','skimmed milk','milk tetra','amul milk','mother dairy milk'],
 'ingredient_or_dependency',
 'liter','liter',1,'ml',null,
 false,false,false,
 'approved','Ingredient — used in machine drinks; not directly orderable','Leadership',now()),

-- Sugar Sachets: internal supply
('Sugar Sachets',
 ARRAY['sugar sachet','dhampure sugar','trust sugar','white sugar sachet','sugar packet','refined sugar sachet'],
 'internal_supply',
 'pack','pcs',200,null,null,
 false,false,false,
 'approved','Internal supply — 200 sachets per pack','Leadership',now()),

-- Delivery / Shipping charges: finance expense
('Delivery Charges',
 ARRAY['delivery charge','delivery charges','delivery fee','shipping charge','shipping fee','freight','handling charge'],
 'finance_expense',
 'invoice','invoice',null,null,null,
 false,false,false,
 'approved','Finance/expense line — no stock conversion','Leadership',now()),

-- Rental / Service charges: finance expense
('Rental / Service',
 ARRAY['rental','rent','machine rental','dispenser rental','service charge','amc','annual maintenance','maintenance charge'],
 'finance_expense',
 'invoice','invoice',null,null,null,
 false,false,false,
 'approved','Finance/expense line — no stock conversion','Leadership',now()),

-- Water Bottles
('Water Bottle',
 ARRAY['water bottle','mineral water','packaged water','bisleri','kinley water bottle','1l water','500ml water'],
 'direct_menu_stock',
 'bottle','bottle',1,'bottle','Water Bottle',
 true,true,false,
 'approved','1 bottle = 1 serving','Leadership',now())

ON CONFLICT DO NOTHING;
