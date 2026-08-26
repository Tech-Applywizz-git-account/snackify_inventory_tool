-- Bottled mineral water was missing from token_items, so the menu showed 0 coins
-- and checkout raised UNKNOWN_TOKEN_ITEM.

INSERT INTO public.token_items (sku_code, display_name, kind, tokens, aliases, weekday) VALUES
  ('WATER_BOTTLE', 'Water Bottle', 'beverage', 10,
    ARRAY[
      'water',
      'water bottle',
      'mineral water',
      'mineral water (1l)',
      'mineral water 1l',
      'packaged water',
      'bisleri',
      'kinley'
    ], NULL)
ON CONFLICT (sku_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    tokens = EXCLUDED.tokens,
    aliases = EXCLUDED.aliases,
    kind = EXCLUDED.kind,
    active = true,
    updated_at = now();

-- Strip size suffixes like "(1L)" so "Mineral Water (1L)" matches "mineral water".
CREATE OR REPLACE FUNCTION public.snackify_find_item(p_name text)
RETURNS public.token_items
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_n text := public.snackify_norm(p_name);
  v_key text;
  v_row public.token_items;
BEGIN
  IF v_n = '' THEN
    RETURN NULL;
  END IF;

  v_key := public.snackify_norm(
    regexp_replace(
      regexp_replace(v_n, '\([^)]*\)', ' ', 'g'),
      '\m\d+\s*(ml|l|ltr|litre|liter)s?\M',
      ' ',
      'g'
    )
  );

  SELECT * INTO v_row
  FROM public.token_items
  WHERE active AND public.snackify_norm(display_name) IN (v_n, v_key)
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  SELECT * INTO v_row
  FROM public.token_items
  WHERE active AND public.snackify_norm(sku_code) IN (v_n, v_key)
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  SELECT t.* INTO v_row
  FROM public.token_items t
  WHERE t.active
    AND EXISTS (
      SELECT 1 FROM unnest(t.aliases) a
      WHERE public.snackify_norm(a) IN (v_n, v_key)
    )
  LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;

  SELECT t.* INTO v_row
  FROM public.token_items t
  WHERE t.active
    AND EXISTS (
      SELECT 1 FROM unnest(t.aliases) a
      WHERE length(public.snackify_norm(a)) >= 4
        AND (v_n LIKE '%' || public.snackify_norm(a) || '%'
          OR v_key LIKE '%' || public.snackify_norm(a) || '%')
    )
  ORDER BY tokens DESC
  LIMIT 1;
  RETURN v_row;
END;
$$;
