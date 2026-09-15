-- Per-product cafeteria coin discount policies.
ALTER TABLE public.token_items
  ADD COLUMN IF NOT EXISTS discount_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discount_coins_required integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_max_percent integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS discount_max_coins_per_order integer NOT NULL DEFAULT 0;

ALTER TABLE public.token_items
  DROP CONSTRAINT IF EXISTS token_items_discount_values_check;
ALTER TABLE public.token_items
  ADD CONSTRAINT token_items_discount_values_check CHECK (
    discount_coins_required >= 0 AND
    discount_amount >= 0 AND
    discount_max_percent BETWEEN 0 AND 100 AND
    discount_max_coins_per_order >= 0
  );

CREATE OR REPLACE FUNCTION public.snackify_price_line(
  p_name text,
  p_qty integer,
  p_apply_discount boolean DEFAULT false,
  p_discount_budget integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_item public.token_items;
  v_qty integer := GREATEST(COALESCE(p_qty, 1), 1);
  v_base integer;
  v_discount integer := 0;
  v_allowed integer;
BEGIN
  v_item := public.snackify_find_item(p_name);
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_TOKEN_ITEM: %', COALESCE(p_name, 'Item') USING ERRCODE = 'P0001';
  END IF;
  v_base := v_item.tokens * v_qty;
  IF p_apply_discount AND v_item.discount_enabled
     AND v_item.discount_coins_required > 0
     AND COALESCE(p_discount_budget, 0) >= v_item.discount_coins_required THEN
    v_allowed := LEAST(v_item.discount_amount * v_qty,
      FLOOR(v_base * v_item.discount_max_percent / 100.0)::integer);
    IF v_item.discount_max_coins_per_order > 0 THEN
      v_allowed := LEAST(v_allowed, v_item.discount_max_coins_per_order);
    END IF;
    v_discount := GREATEST(v_allowed, 0);
  END IF;
  RETURN jsonb_build_object(
    'name', COALESCE(p_name, v_item.display_name), 'sku_code', v_item.sku_code,
    'token_item_id', v_item.id, 'qty', v_qty, 'unit_tokens', v_item.tokens,
    'tokens_before_discount', v_base, 'discount_tokens', v_discount,
    'tokens', v_base - v_discount, 'discount_applied', v_discount > 0
  );
END;
$$;

DROP FUNCTION IF EXISTS public.snackify_spend(uuid, text, text, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.snackify_spend(
  p_user_id uuid, p_idempotency_key text, p_ref_type text, p_ref_id uuid, p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_existing public.token_usage;
  v_grant jsonb;
  v_line jsonb;
  v_priced jsonb := '[]'::jsonb;
  v_one jsonb;
  v_total integer := 0;
  v_discount_budget integer := 0;
  v_bal integer;
  v_usage_id uuid;
  v_first_item uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.token_usage WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('usage_id', v_existing.id, 'tokens_charged', ABS(v_existing.tokens_delta),
        'balance_after', v_existing.balance_after, 'lines', v_existing.lines, 'idempotent', true);
    END IF;
  END IF;
  v_grant := public.snackify_ensure_month_grant(p_user_id);
  v_bal := (v_grant->>'balance')::integer;
  v_discount_budget := v_bal;
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_one := public.snackify_price_line(COALESCE(v_line->>'name', v_line->>'item_name'),
      COALESCE((v_line->>'qty')::integer, 1),
      COALESCE((v_line->>'apply_discount')::boolean, false), v_discount_budget);
    v_priced := v_priced || jsonb_build_array(v_one);
    v_total := v_total + COALESCE((v_one->>'tokens')::integer, 0);
    IF v_first_item IS NULL THEN v_first_item := (v_one->>'token_item_id')::uuid; END IF;
  END LOOP;
  IF v_total <= 0 THEN RAISE EXCEPTION 'EMPTY_CART' USING ERRCODE = 'P0001'; END IF;
  IF v_bal < v_total THEN
    RAISE EXCEPTION 'INSUFFICIENT_TOKENS: need %, have %', v_total, v_bal USING ERRCODE = 'P0001';
  END IF;
  v_bal := v_bal - v_total;
  INSERT INTO public.token_usage (
    user_id, token_item_id, qty, tokens_delta, balance_after, reason,
    ref_type, ref_id, idempotency_key, lines, print_status
  ) VALUES (
    p_user_id, v_first_item, 1, -v_total, v_bal, 'spend', p_ref_type, p_ref_id,
    COALESCE(p_idempotency_key, 'spend:' || p_ref_type || ':' || p_ref_id::text), v_priced, 'none'
  ) RETURNING id INTO v_usage_id;
  UPDATE public.profiles SET token_balance = v_bal WHERE id = p_user_id;
  IF p_ref_type = 'request' AND p_ref_id IS NOT NULL THEN
    UPDATE public.requests SET tokens_charged = v_total, token_usage_id = v_usage_id WHERE id = p_ref_id;
  ELSIF p_ref_type = 'meal_booking' AND p_ref_id IS NOT NULL THEN
    UPDATE public.meal_bookings SET tokens_charged = v_total, token_usage_id = v_usage_id WHERE id = p_ref_id;
  END IF;
  RETURN jsonb_build_object('usage_id', v_usage_id, 'tokens_charged', v_total,
    'balance_after', v_bal, 'lines', v_priced, 'idempotent', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.snackify_price_line(text, integer, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.snackify_spend(uuid, text, text, uuid, jsonb) TO service_role;