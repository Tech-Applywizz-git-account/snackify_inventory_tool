-- 0030_mix_fruit_jam_hide_raw_inventory.sql
-- "Mix Fruit Jam" is raw spread/inventory stock and must not appear in the
-- employee ordering catalog. "Mix Fruit Jam Sandwich" is the customer-orderable item.
--
-- Schema inspection (as of migration 0029):
--   cafeteria_items.visible_to_employees  — EXISTS (added in 0024, DEFAULT true)
--   cafeteria_items.employee_orderable    — DOES NOT EXIST (lives on
--                                           product_conversion_master only)
--
-- This migration:
--   1. Unconditionally sets visible_to_employees = false for exact item_name = 'Mix Fruit Jam'.
--   2. Sets employee_orderable = false via guarded dynamic SQL only when that column exists.
--   3. Does NOT touch stock_today, stock_servings, available, or any other stock field.
--   4. Does NOT touch "Mix Fruit Jam Sandwich".
--   5. Installs a BEFORE INSERT OR UPDATE trigger to enforce visible_to_employees going forward.
--      NOTE: The trigger enforces only columns that exist at function creation time.
--            If employee_orderable is ever added to cafeteria_items, run a follow-up migration
--            to add it to the trigger body and repeat step 2's DO block.

-- ── 1. Unconditional: hide raw inventory row from employee catalog ─────────────
UPDATE public.cafeteria_items
  SET visible_to_employees = false
WHERE item_name = 'Mix Fruit Jam';

-- ── 2. Conditional: set employee_orderable = false only if column exists ───────
--    Dynamic SQL via EXECUTE avoids a compile-time error on an absent column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'cafeteria_items'
      AND column_name  = 'employee_orderable'
  ) THEN
    EXECUTE
      'UPDATE public.cafeteria_items
         SET employee_orderable = false
       WHERE item_name = ''Mix Fruit Jam''';
  END IF;
END;
$$;

-- ── 3. Future-row guard trigger ────────────────────────────────────────────────
--    Enforces visible_to_employees = false on any INSERT or UPDATE for the exact
--    raw inventory name. Because PL/pgSQL trigger NEW-row assignment requires
--    static column references, employee_orderable is omitted here — it does not
--    exist on cafeteria_items as of this migration (see schema inspection above).
--    Add it to this function body in the migration that creates that column.
CREATE OR REPLACE FUNCTION public.cafeteria_enforce_raw_jam_invisible()
  RETURNS trigger LANGUAGE plpgsql AS
$$
BEGIN
  IF NEW.item_name = 'Mix Fruit Jam' THEN
    NEW.visible_to_employees := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raw_jam_invisible ON public.cafeteria_items;
CREATE TRIGGER trg_raw_jam_invisible
  BEFORE INSERT OR UPDATE ON public.cafeteria_items
  FOR EACH ROW EXECUTE FUNCTION public.cafeteria_enforce_raw_jam_invisible();
