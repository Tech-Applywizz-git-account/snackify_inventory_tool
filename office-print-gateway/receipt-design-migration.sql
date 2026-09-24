-- Receipt design storage for the leadership-controlled printer settings feature.
-- Review and copy into the next Supabase migration before applying.

CREATE TABLE IF NOT EXISTS public.receipt_design (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  config JSONB NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.receipt_design (id, config)
VALUES (
  'default',
  '{
    "paper_width": "80mm",
    "header": "APPLYWIZZ",
    "subheader": "OFFICE PANTRY",
    "meal_header": "APPLYWIZZ",
    "meal_subheader": "MEAL TOKEN",
    "footer": "DELIVER ASAP!",
    "custom_label": {
      "enabled": false,
      "text": "",
      "position": "after_header",
      "bold": true
    },
    "context": {
      "order_number": true,
      "date": true,
      "employee": true,
      "location": true,
      "item": true,
      "note": true,
      "tokens": true,
      "guest_marker": true
    },
    "feed_lines": 3,
    "cut_mode": "partial"
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Correct the original meal-token field order without changing other saved settings.
UPDATE public.receipt_design
SET config = jsonb_set(
  jsonb_set(config, '{meal_header}', '"APPLYWIZZ"'::jsonb),
  '{meal_subheader}', '"MEAL TOKEN"'::jsonb
)
WHERE id = 'default'
  AND config->>'meal_header' = 'MEAL TOKEN'
  AND config->>'meal_subheader' = 'APPLYWIZZ';

ALTER TABLE public.receipt_design ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipt_design_leadership_read ON public.receipt_design;
CREATE POLICY receipt_design_leadership_read
  ON public.receipt_design FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'leadership'
    )
  );

-- Writes are performed by the authenticated backend using supabaseAdmin.
-- Do not add a browser INSERT/UPDATE policy for this table.