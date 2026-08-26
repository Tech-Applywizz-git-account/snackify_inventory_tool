-- Image catalog prices, 4000 monthly coins (reset 1st at 08:00 IST),
-- and a hard unique meal booking per user per day.

-- ── 1. Exact coin prices from the Snackify Coin Pricing sheet ─────────
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
    ARRAY['hot chocolate'], NULL),
  ('BREAD_PB', 'Bread + Peanut Butter', 'snack', 15,
    ARRAY['peanut butter sandwich','bread + peanut butter','bread + peanut','peanut butter'], NULL),
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

-- ── 2. Month key rolls over at 08:00 IST on the 1st ───────────────────
CREATE OR REPLACE FUNCTION public.snackify_ist_month()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(
    ((now() AT TIME ZONE 'Asia/Kolkata') - interval '8 hours'),
    'YYYYMM'
  );
$$;

-- ── 3. Monthly grant is 4000; leftover resets on month change ────────
CREATE OR REPLACE FUNCTION public.snackify_ensure_month_grant(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_month text := public.snackify_ist_month();
  v_bal integer;
  v_cur_month text;
  v_granted boolean := false;
  v_grant_amt integer := 0;
  v_add integer := 0;
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
      p_user_id, 1, 4000, 4000, 'monthly_grant',
      'grant', 'grant:' || p_user_id::text || ':' || v_month, 'none'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    v_bal := 4000;
    UPDATE public.profiles
    SET token_balance = 4000, token_month = v_month
    WHERE id = p_user_id;
    v_granted := true;
  ELSE
    SELECT COALESCE(SUM(tokens_delta), 0) INTO v_grant_amt
    FROM public.token_usage
    WHERE user_id = p_user_id
      AND reason = 'monthly_grant'
      AND idempotency_key LIKE 'grant:' || p_user_id::text || ':' || v_month || '%';

    IF v_grant_amt < 4000 THEN
      v_add := 4000 - v_grant_amt;
      INSERT INTO public.token_usage (
        user_id, qty, tokens_delta, balance_after, reason,
        ref_type, idempotency_key, print_status
      ) VALUES (
        p_user_id, 1, v_add, v_bal + v_add, 'monthly_grant',
        'grant', 'grant:' || p_user_id::text || ':' || v_month || ':to4000', 'none'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;

      v_bal := v_bal + v_add;
      UPDATE public.profiles
      SET token_balance = v_bal
      WHERE id = p_user_id;
      v_granted := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'balance', v_bal,
    'month', v_month,
    'granted', v_granted,
    'monthly_grant', 4000
  );
END;
$$;

-- ── 4. One meal booking per user per date (clean leftovers, then unique) ─
CREATE TABLE IF NOT EXISTS public.meal_booking_duplicate_cleanup_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cleaned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kept_booking_id UUID NOT NULL,
  removed_booking JSONB NOT NULL
);

ALTER TABLE public.meal_booking_duplicate_cleanup_audit ENABLE ROW LEVEL SECURITY;

WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, meal_date
      ORDER BY
        CASE WHEN token_number IS NOT NULL THEN 0 ELSE 1 END,
        booked_at DESC NULLS LAST,
        id DESC
    ) AS kept_booking_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, meal_date
      ORDER BY
        CASE WHEN token_number IS NOT NULL THEN 0 ELSE 1 END,
        booked_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM public.meal_bookings
)
INSERT INTO public.meal_booking_duplicate_cleanup_audit (kept_booking_id, removed_booking)
SELECT ranked.kept_booking_id, to_jsonb(meal_bookings.*)
FROM public.meal_bookings
JOIN ranked ON ranked.id = meal_bookings.id
WHERE ranked.rn > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, meal_date
      ORDER BY
        CASE WHEN token_number IS NOT NULL THEN 0 ELSE 1 END,
        booked_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM public.meal_bookings
)
DELETE FROM public.meal_bookings
USING ranked
WHERE meal_bookings.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_bookings_user_date_unique
  ON public.meal_bookings (user_id, meal_date);
