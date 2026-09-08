-- =====================================================================
-- 0042_token_items_and_usage.sql
-- Snackify Coins: two new tables only. Reuse profiles, requests,
-- meal_bookings, meal_print_jobs for wallet / orders / cabin prints.
-- =====================================================================

-- ── 1. ALTER existing tables ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS token_balance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_month text;

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS tokens_charged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_usage_id uuid,
  ADD COLUMN IF NOT EXISTS client_order_id text;

ALTER TABLE public.meal_bookings
  ADD COLUMN IF NOT EXISTS tokens_charged integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS token_usage_id uuid;

ALTER TABLE public.meal_print_jobs
  ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_client_order_id
  ON public.requests (submitted_by, client_order_id)
  WHERE client_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meal_print_jobs_retry
  ON public.meal_print_jobs (status, retryable, scheduled_for);

-- ── 2. token_items — price master (one row per sellable SKU) ─────────
CREATE TABLE IF NOT EXISTS public.token_items (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku_code           text NOT NULL UNIQUE,
  display_name       text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('beverage', 'snack', 'meal')),
  tokens             integer NOT NULL CHECK (tokens >= 0),
  aliases            text[] NOT NULL DEFAULT '{}',
  weekday            smallint CHECK (weekday IS NULL OR (weekday >= 1 AND weekday <= 5)),
  cafeteria_item_id  uuid,
  active             boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_items_kind ON public.token_items (kind, active);
CREATE INDEX IF NOT EXISTS idx_token_items_weekday ON public.token_items (weekday) WHERE weekday IS NOT NULL;

DROP TRIGGER IF EXISTS trg_token_items_updated_at ON public.token_items;
CREATE TRIGGER trg_token_items_updated_at
  BEFORE UPDATE ON public.token_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── 3. token_usage — ledger + cafeteria print queue ──────────────────
CREATE TABLE IF NOT EXISTS public.token_usage (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_item_id      uuid REFERENCES public.token_items(id) ON DELETE SET NULL,
  qty                integer NOT NULL DEFAULT 1,
  tokens_delta       integer NOT NULL,
  balance_after      integer NOT NULL,
  reason             text NOT NULL CHECK (reason IN (
                       'spend', 'refund', 'monthly_grant', 'month_reset', 'admin_adjust'
                     )),
  ref_type           text,
  ref_id             uuid,
  idempotency_key    text NOT NULL UNIQUE,
  lines              jsonb NOT NULL DEFAULT '[]'::jsonb,
  print_status       text NOT NULL DEFAULT 'none' CHECK (print_status IN (
                       'none', 'pending', 'printing', 'printed', 'failed', 'cancelled'
                     )),
  print_error        text,
  print_attempts     integer NOT NULL DEFAULT 0,
  print_retryable    boolean NOT NULL DEFAULT true,
  print_claimed_at   timestamptz,
  printed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_user_created
  ON public.token_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_ref
  ON public.token_usage (ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_print_queue
  ON public.token_usage (print_status, print_retryable, created_at)
  WHERE print_status IN ('pending', 'failed', 'printing');

ALTER TABLE public.requests
  DROP CONSTRAINT IF EXISTS requests_token_usage_id_fkey;
ALTER TABLE public.requests
  ADD CONSTRAINT requests_token_usage_id_fkey
  FOREIGN KEY (token_usage_id) REFERENCES public.token_usage(id) ON DELETE SET NULL;

ALTER TABLE public.meal_bookings
  DROP CONSTRAINT IF EXISTS meal_bookings_token_usage_id_fkey;
ALTER TABLE public.meal_bookings
  ADD CONSTRAINT meal_bookings_token_usage_id_fkey
  FOREIGN KEY (token_usage_id) REFERENCES public.token_usage(id) ON DELETE SET NULL;

-- ── 4. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.token_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS token_items_read_all ON public.token_items;
CREATE POLICY token_items_read_all
  ON public.token_items FOR SELECT
  USING (true);

DROP POLICY IF EXISTS token_usage_own_read ON public.token_usage;
CREATE POLICY token_usage_own_read
  ON public.token_usage FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.current_user_role() IN ('office_boy', 'facility_manager', 'leadership', 'finance')
  );

-- ── 5. Seed prices (Bread + Peanut Butter = 30) ──────────────────────
INSERT INTO public.token_items (sku_code, display_name, kind, tokens, aliases, weekday) VALUES
  ('COFFEE_REGULAR', 'Regular Coffee', 'beverage', 10,
    ARRAY['regular coffee','coffee','espresso','americano','filter coffee'], NULL),
  ('CAPPUCCINO', 'Cappuccino', 'beverage', 20,
    ARRAY['cappuccino','cappucino'], NULL),
  ('LATTE', 'Latte', 'beverage', 20,
    ARRAY['latte','cafe latte','café latte'], NULL),
  ('MILK', 'Milk', 'beverage', 10,
    ARRAY['milk'], NULL),
  ('GINGER_TEA', 'Ginger Tea', 'beverage', 10,
    ARRAY['ginger tea','ginger'], NULL),
  ('ASSAM_TEA', 'Assam Tea', 'beverage', 10,
    ARRAY['assam tea','assam'], NULL),
  ('LEMON_TEA', 'Lemon Tea', 'beverage', 10,
    ARRAY['lemon tea'], NULL),
  ('BADAM_MILK', 'Badam Milk', 'beverage', 20,
    ARRAY['badam milk','badam','badam sachet'], NULL),
  ('HOT_CHOCOLATE', 'Hot Chocolate', 'beverage', 25,
    ARRAY['hot chocolate','hot chocolate'], NULL),
  ('ELAICHI_TEA', 'Elaichi Tea', 'beverage', 10,
    ARRAY['elaichi tea','elaichi','cardamom tea'], NULL),
  ('MASALA_CHAI', 'Masala Chai', 'beverage', 10,
    ARRAY['masala chai','masala tea','chai'], NULL),
  ('GREEN_TEA', 'Green Tea', 'beverage', 10,
    ARRAY['green tea'], NULL),
  ('BREAD_PB', 'Bread + Peanut Butter', 'snack', 30,
    ARRAY['peanut butter sandwich','bread + peanut butter','bread + peanut','peanut butter','peanut butter sandwich'], NULL),
  ('BREAD_JAM', 'Bread + Jam', 'snack', 15,
    ARRAY['mix fruit jam sandwich','pineapple jam sandwich','jam sandwich','bread + jam','jam'], NULL),
  ('MEAL_MON', 'Monday Veg Thali + Dessert', 'meal', 110,
    ARRAY['monday meal','veg thali'], 1),
  ('MEAL_TUE', 'Tuesday Veg Thali + Egg + Dessert', 'meal', 120,
    ARRAY['tuesday meal'], 2),
  ('MEAL_WED', 'Wednesday Paneer / Chicken Curry + Rice + Dessert', 'meal', 140,
    ARRAY['wednesday meal'], 3),
  ('MEAL_THU', 'Thursday Egg-based Meal + Dessert', 'meal', 120,
    ARRAY['thursday meal'], 4),
  ('MEAL_FRI', 'Friday Veg / Chicken Biryani + Dessert', 'meal', 140,
    ARRAY['friday meal'], 5)
ON CONFLICT (sku_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    tokens = EXCLUDED.tokens,
    aliases = EXCLUDED.aliases,
    weekday = EXCLUDED.weekday,
    kind = EXCLUDED.kind,
    active = true,
    updated_at = now();

-- ── 6. Helpers + ACID RPCs ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.snackify_norm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(trim(coalesce(p, ''))), '\s+', ' ', 'g');
$$;

CREATE OR REPLACE FUNCTION public.snackify_ist_month()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata'), 'YYYYMM');
$$;

CREATE OR REPLACE FUNCTION public.snackify_find_item(p_name text)
RETURNS public.token_items
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_n text := public.snackify_norm(p_name);
  v_row public.token_items;
BEGIN
  IF v_n = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row
  FROM public.token_items
  WHERE active AND public.snackify_norm(display_name) = v_n
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  SELECT * INTO v_row
  FROM public.token_items
  WHERE active AND public.snackify_norm(sku_code) = v_n
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  SELECT t.* INTO v_row
  FROM public.token_items t
  WHERE t.active
    AND EXISTS (
      SELECT 1 FROM unnest(t.aliases) a
      WHERE public.snackify_norm(a) = v_n
    )
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  SELECT t.* INTO v_row
  FROM public.token_items t
  WHERE t.active
    AND EXISTS (
      SELECT 1 FROM unnest(t.aliases) a
      WHERE length(public.snackify_norm(a)) >= 4
        AND v_n LIKE '%' || public.snackify_norm(a) || '%'
    )
  ORDER BY tokens DESC
  LIMIT 1;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.snackify_price_line(p_name text, p_qty integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_item public.token_items;
  v_qty integer := GREATEST(COALESCE(p_qty, 1), 1);
  v_n text := public.snackify_norm(p_name);
  v_unit integer;
BEGIN
  v_item := public.snackify_find_item(p_name);
  IF v_item.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'name', COALESCE(p_name, v_item.display_name),
      'sku_code', v_item.sku_code,
      'token_item_id', v_item.id,
      'qty', v_qty,
      'unit_tokens', v_item.tokens,
      'tokens', v_item.tokens * v_qty
    );
  END IF;

  v_unit := CASE
    WHEN v_n ~ '(tea|coffee|latte|capp|milk|chai|chocolate|badam|espresso|americano)' THEN 10
    ELSE 15
  END;

  RETURN jsonb_build_object(
    'name', COALESCE(p_name, 'Item'),
    'sku_code', NULL,
    'token_item_id', NULL,
    'qty', v_qty,
    'unit_tokens', v_unit,
    'tokens', v_unit * v_qty
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.snackify_ensure_month_grant(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_month text := public.snackify_ist_month();
  v_bal integer;
  v_cur_month text;
  v_granted boolean := false;
BEGIN
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(token_balance, 0), token_month
    INTO v_bal, v_cur_month
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_cur_month IS DISTINCT FROM v_month THEN
    IF v_bal > 0 THEN
      INSERT INTO public.token_usage (
        user_id, qty, tokens_delta, balance_after, reason,
        ref_type, idempotency_key, print_status
      ) VALUES (
        p_user_id, 1, -v_bal, 0, 'month_reset',
        'grant', 'reset:' || p_user_id::text || ':' || v_month, 'none'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_bal := 0;
    END IF;

    INSERT INTO public.token_usage (
      user_id, qty, tokens_delta, balance_after, reason,
      ref_type, idempotency_key, print_status
    ) VALUES (
      p_user_id, 1, 3500, 3500, 'monthly_grant',
      'grant', 'grant:' || p_user_id::text || ':' || v_month, 'none'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    v_bal := 3500;
    UPDATE public.profiles
    SET token_balance = 3500, token_month = v_month
    WHERE id = p_user_id;
    v_granted := true;
  END IF;

  RETURN jsonb_build_object(
    'balance', v_bal,
    'month', v_month,
    'granted', v_granted,
    'monthly_grant', 3500
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.snackify_spend(
  p_user_id uuid,
  p_idempotency_key text,
  p_ref_type text,
  p_ref_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing public.token_usage;
  v_grant jsonb;
  v_line jsonb;
  v_priced jsonb := '[]'::jsonb;
  v_one jsonb;
  v_total integer := 0;
  v_bal integer;
  v_usage_id uuid;
  v_first_item uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.token_usage
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'usage_id', v_existing.id,
        'tokens_charged', ABS(v_existing.tokens_delta),
        'balance_after', v_existing.balance_after,
        'lines', v_existing.lines,
        'idempotent', true
      );
    END IF;
  END IF;

  v_grant := public.snackify_ensure_month_grant(p_user_id);
  v_bal := (v_grant->>'balance')::integer;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_one := public.snackify_price_line(
      COALESCE(v_line->>'name', v_line->>'item_name'),
      COALESCE((v_line->>'qty')::integer, 1)
    );
    v_priced := v_priced || jsonb_build_array(v_one);
    v_total := v_total + COALESCE((v_one->>'tokens')::integer, 0);
    IF v_first_item IS NULL AND v_one ? 'token_item_id' AND v_one->>'token_item_id' IS NOT NULL THEN
      v_first_item := (v_one->>'token_item_id')::uuid;
    END IF;
  END LOOP;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'EMPTY_CART' USING ERRCODE = 'P0001';
  END IF;

  IF v_bal < v_total THEN
    RAISE EXCEPTION 'INSUFFICIENT_TOKENS: need %, have %', v_total, v_bal
      USING ERRCODE = 'P0001';
  END IF;

  v_bal := v_bal - v_total;

  INSERT INTO public.token_usage (
    user_id, token_item_id, qty, tokens_delta, balance_after, reason,
    ref_type, ref_id, idempotency_key, lines, print_status
  ) VALUES (
    p_user_id,
    v_first_item,
    1,
    -v_total,
    v_bal,
    'spend',
    p_ref_type,
    p_ref_id,
    COALESCE(p_idempotency_key, 'spend:' || p_ref_type || ':' || p_ref_id::text),
    v_priced,
    'none'
  )
  RETURNING id INTO v_usage_id;

  UPDATE public.profiles SET token_balance = v_bal WHERE id = p_user_id;

  IF p_ref_type = 'request' AND p_ref_id IS NOT NULL THEN
    UPDATE public.requests
    SET tokens_charged = v_total, token_usage_id = v_usage_id
    WHERE id = p_ref_id;
  ELSIF p_ref_type = 'meal_booking' AND p_ref_id IS NOT NULL THEN
    UPDATE public.meal_bookings
    SET tokens_charged = v_total, token_usage_id = v_usage_id
    WHERE id = p_ref_id;
  END IF;

  RETURN jsonb_build_object(
    'usage_id', v_usage_id,
    'tokens_charged', v_total,
    'balance_after', v_bal,
    'lines', v_priced,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.snackify_refund(
  p_user_id uuid,
  p_ref_type text,
  p_ref_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_spend public.token_usage;
  v_key text;
  v_existing public.token_usage;
  v_grant jsonb;
  v_bal integer;
  v_usage_id uuid;
  v_credit integer;
BEGIN
  v_key := 'refund:' || p_ref_type || ':' || p_ref_id::text;

  SELECT * INTO v_existing FROM public.token_usage WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'usage_id', v_existing.id,
      'tokens_refunded', v_existing.tokens_delta,
      'balance_after', v_existing.balance_after,
      'idempotent', true
    );
  END IF;

  SELECT * INTO v_spend
  FROM public.token_usage
  WHERE user_id = p_user_id
    AND ref_type = p_ref_type
    AND ref_id = p_ref_id
    AND reason = 'spend'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('tokens_refunded', 0, 'skipped', true);
  END IF;

  v_grant := public.snackify_ensure_month_grant(p_user_id);
  SELECT token_balance INTO v_bal FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  v_credit := ABS(v_spend.tokens_delta);
  v_bal := v_bal + v_credit;

  INSERT INTO public.token_usage (
    user_id, token_item_id, qty, tokens_delta, balance_after, reason,
    ref_type, ref_id, idempotency_key, lines, print_status
  ) VALUES (
    p_user_id, v_spend.token_item_id, 1, v_credit, v_bal, 'refund',
    p_ref_type, p_ref_id, v_key, v_spend.lines, 'cancelled'
  )
  RETURNING id INTO v_usage_id;

  UPDATE public.profiles SET token_balance = v_bal WHERE id = p_user_id;

  UPDATE public.token_usage
  SET print_status = 'cancelled', print_retryable = false
  WHERE id = v_spend.id
    AND print_status IN ('none', 'pending', 'failed');

  IF p_ref_type = 'request' THEN
    UPDATE public.requests SET tokens_charged = 0 WHERE id = p_ref_id;
  ELSIF p_ref_type = 'meal_booking' THEN
    UPDATE public.meal_bookings SET tokens_charged = 0 WHERE id = p_ref_id;
  END IF;

  RETURN jsonb_build_object(
    'usage_id', v_usage_id,
    'tokens_refunded', v_credit,
    'balance_after', v_bal,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.snackify_apply_meal_tokens(
  p_user_id uuid,
  p_booking_id uuid,
  p_meal_date date,
  p_choice text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_dow integer;
  v_item public.token_items;
  v_name text;
BEGIN
  IF p_choice IS NULL OR lower(p_choice) = 'skip' THEN
    RETURN public.snackify_refund(p_user_id, 'meal_booking', p_booking_id);
  END IF;

  PERFORM public.snackify_refund(p_user_id, 'meal_booking', p_booking_id);

  v_dow := EXTRACT(DOW FROM p_meal_date)::integer;
  SELECT * INTO v_item
  FROM public.token_items
  WHERE kind = 'meal' AND weekday = v_dow AND active
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_MEAL_PRICE: weekday %', v_dow USING ERRCODE = 'P0001';
  END IF;

  v_name := v_item.display_name;
  RETURN public.snackify_spend(
    p_user_id,
    'meal:' || p_booking_id::text || ':' || p_choice || ':' || p_meal_date::text,
    'meal_booking',
    p_booking_id,
    jsonb_build_array(jsonb_build_object('name', v_name, 'qty', 1))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.snackify_norm(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.snackify_ist_month() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.snackify_find_item(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.snackify_price_line(text, integer) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.snackify_ensure_month_grant(uuid) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.snackify_spend(uuid, text, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.snackify_refund(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.snackify_apply_meal_tokens(uuid, uuid, date, text) TO service_role;

DROP VIEW IF EXISTS public.v_request_queue CASCADE;
CREATE VIEW public.v_request_queue AS
SELECT
  r.*,
  p.full_name AS submitter_name,
  COALESCE(pref.notification_tone, 'Friendly') AS notification_tone
FROM public.requests r
LEFT JOIN public.profiles p ON p.id = r.submitted_by
LEFT JOIN public.employee_cafeteria_preferences pref ON pref.user_id = r.submitted_by;
