-- =====================================================================
-- 0048_meal_reviews.sql
-- Post-lunch meal review (API-first: web / mobile / any client)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.meal_reviews (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meal_date     date NOT NULL,
  meal_type     text NOT NULL CHECK (meal_type IN ('veg', 'non_veg')),
  rating        int  NOT NULL CHECK (rating >= 1 AND rating <= 5),
  vibe          text NOT NULL,
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_reviews_user_date_unique UNIQUE (user_id, meal_date)
);

CREATE INDEX IF NOT EXISTS idx_meal_reviews_meal_date
  ON public.meal_reviews (meal_date DESC);

CREATE INDEX IF NOT EXISTS idx_meal_reviews_user_id
  ON public.meal_reviews (user_id);

ALTER TABLE public.meal_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meal_reviews_own_select" ON public.meal_reviews;
CREATE POLICY "meal_reviews_own_select"
  ON public.meal_reviews FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "meal_reviews_own_insert" ON public.meal_reviews;
CREATE POLICY "meal_reviews_own_insert"
  ON public.meal_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "meal_reviews_admin_select" ON public.meal_reviews;
CREATE POLICY "meal_reviews_admin_select"
  ON public.meal_reviews FOR SELECT
  USING (public.current_user_role() IN ('leadership', 'finance'));
