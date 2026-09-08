-- =====================================================================
-- 0022_product_forecasts.sql
-- Predictive ordering: store weekly consumption forecasts per product.
--
-- Computed each Monday by the /api/cron/weekly-forecast endpoint.
-- suggested_order is advisory only — never auto-applied.
-- basis tells downstream UI/digest whether the figure came from real
-- transaction history or fell back to the fixed daily_usage estimate.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.product_forecasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  week_of         date NOT NULL,           -- Monday of the forecast week (IST)
  avg_weekly      numeric(10, 2) NOT NULL, -- avg units consumed/week over history window
  predicted_next  numeric(10, 2) NOT NULL, -- weighted prediction for coming week
  suggested_order numeric(10, 2) NOT NULL, -- max(0, predicted_next - current_stock), capped
  basis           text NOT NULL CHECK (basis IN ('history', 'daily_usage_fallback')),
  weeks_of_data   int  NOT NULL DEFAULT 0, -- how many weeks had removal transactions
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per product per week (upsert target)
CREATE UNIQUE INDEX IF NOT EXISTS product_forecasts_product_week
  ON public.product_forecasts (product_id, week_of);

-- Fast lookup: latest forecast per product
CREATE INDEX IF NOT EXISTS product_forecasts_product_created
  ON public.product_forecasts (product_id, created_at DESC);

COMMENT ON TABLE public.product_forecasts IS
  'Weekly predictive order suggestions, computed by the Monday cron job. Advisory only.';

-- ── Convenience view: latest forecast per active product ─────────────────────
CREATE OR REPLACE VIEW public.v_latest_forecasts AS
SELECT DISTINCT ON (pf.product_id)
  pf.product_id,
  p.name          AS product_name,
  p.unit,
  pf.week_of,
  pf.avg_weekly,
  pf.predicted_next,
  pf.suggested_order,
  pf.basis,
  pf.weeks_of_data,
  i.current_stock,
  pf.created_at
FROM public.product_forecasts pf
JOIN public.products p ON p.id = pf.product_id AND p.active = true
LEFT JOIN public.inventory i ON i.product_id = pf.product_id
ORDER BY pf.product_id, pf.week_of DESC;
