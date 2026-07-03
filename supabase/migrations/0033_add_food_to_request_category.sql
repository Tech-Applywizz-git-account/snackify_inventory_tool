-- =====================================================================
-- 0033_add_food_to_request_category.sql
-- Fixes: Add 'food' to request_category enum
-- =====================================================================

do $$ begin
  alter type request_category add value if not exists 'food';
exception when others then null; end $$;
