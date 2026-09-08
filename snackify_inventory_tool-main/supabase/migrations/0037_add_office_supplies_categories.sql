-- =====================================================================
-- 0037_add_office_supplies_categories.sql
-- Create office_supplies table and enable RLS
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.office_supplies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL, -- 'sanitary', 'stationery', 'electronic_gadgets', etc.
  unit TEXT NOT NULL DEFAULT 'pieces',
  current_stock NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  min_threshold NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (min_threshold >= 0),
  cost_per_unit NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (cost_per_unit >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.office_supplies ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users
DROP POLICY IF EXISTS "office_supplies_read_all" ON public.office_supplies;
CREATE POLICY "office_supplies_read_all" ON public.office_supplies
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow write access to facility_manager and leadership
DROP POLICY IF EXISTS "office_supplies_write_privileged" ON public.office_supplies;
CREATE POLICY "office_supplies_write_privileged" ON public.office_supplies
  FOR ALL USING (public.current_user_role() IN ('facility_manager', 'leadership'));
