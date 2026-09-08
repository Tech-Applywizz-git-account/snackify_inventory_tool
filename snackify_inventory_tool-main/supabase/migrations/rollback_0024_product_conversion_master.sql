-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback 0024 · Product Conversion Master
-- Run only after restoring the old backend version.
-- Preserves all bill_uploads, bill_items, transactions, products.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop new tables (order matters — FK deps)
DROP TABLE IF EXISTS cafeteria_recipe_ingredients;
DROP TABLE IF EXISTS bill_stock_applications;

-- 2. Remove columns added to bill_items
ALTER TABLE bill_items
  DROP COLUMN IF EXISTS conversion_master_id,
  DROP COLUMN IF EXISTS normalized_item_name,
  DROP COLUMN IF EXISTS converted_quantity,
  DROP COLUMN IF EXISTS conversion_status,
  DROP COLUMN IF EXISTS ai_suggestion,
  DROP COLUMN IF EXISTS conversion_error,
  DROP COLUMN IF EXISTS processed_at;

-- 3. Remove columns added to bill_uploads
ALTER TABLE bill_uploads
  DROP COLUMN IF EXISTS inventory_sync_status,
  DROP COLUMN IF EXISTS inventory_synced_at;

-- 4. Remove column added to cafeteria_items
ALTER TABLE cafeteria_items
  DROP COLUMN IF EXISTS visible_to_employees;

-- 5. Drop master table and apply function
DROP FUNCTION IF EXISTS apply_bill_item_stock(uuid,uuid,uuid,text,numeric,text,numeric,uuid,text);
DROP TABLE IF EXISTS product_conversion_master;

-- 6. Drop enum
DROP TYPE IF EXISTS item_classification;
