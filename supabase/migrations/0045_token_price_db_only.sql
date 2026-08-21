-- Coin prices come only from token_items. Unknown names no longer invent 10/15.

CREATE OR REPLACE FUNCTION public.snackify_price_line(p_name text, p_qty integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_item public.token_items;
  v_qty integer := GREATEST(COALESCE(p_qty, 1), 1);
BEGIN
  v_item := public.snackify_find_item(p_name);
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_TOKEN_ITEM:%', COALESCE(p_name, '')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'name', COALESCE(p_name, v_item.display_name),
    'sku_code', v_item.sku_code,
    'token_item_id', v_item.id,
    'qty', v_qty,
    'unit_tokens', v_item.tokens,
    'tokens', v_item.tokens * v_qty
  );
END;
$$;
