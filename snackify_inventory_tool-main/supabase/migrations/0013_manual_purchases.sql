-- =====================================================================
-- 0013_manual_purchases.sql
-- Telegram Manual Purchase Intelligence
-- =====================================================================
-- Run in: Supabase SQL Editor
--
-- Changes:
--   1. Create telegram_user_map table (links Telegram chat_id to profile)
--   2. Create manual_purchases table (no-invoice purchase tracking)
--   3. RLS policies
--   4. Indexes
-- =====================================================================


-- ── 1. Telegram user mapping ────────────────────────────────────────
-- Links a Telegram chat_id to an internal profile. Office boy, FM, or
-- leadership must /register on Telegram before submitting purchases.
CREATE TABLE IF NOT EXISTS public.telegram_user_map (
  telegram_chat_id  TEXT        PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  telegram_username  TEXT       DEFAULT NULL,
  mapped_at         TIMESTAMPTZ DEFAULT now(),
  mapped_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_user_map_user
  ON public.telegram_user_map (user_id);


-- ── 2. Manual purchases table ───────────────────────────────────────
-- One row per no-invoice purchase submitted via Telegram.
-- Tracks AI extraction, approval workflow, and inventory/finance sync.
CREATE TABLE IF NOT EXISTS public.manual_purchases (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Source info
  source                TEXT        NOT NULL DEFAULT 'telegram',
  purchase_type         TEXT        NOT NULL DEFAULT 'manual_no_invoice_purchase',

  -- Telegram context
  telegram_chat_id      TEXT,
  telegram_message_ids  TEXT[]      DEFAULT '{}',
  raw_telegram_text     TEXT,

  -- Sender (resolved from telegram_user_map)
  sender_user_id        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name           TEXT,
  sender_role           TEXT,

  -- Purchase details (AI-extracted or manually entered)
  item_name             TEXT,
  quantity              NUMERIC,
  unit                  TEXT,
  amount                NUMERIC,
  vendor_name           TEXT,
  payment_method        TEXT,       -- PhonePe / GPay / Paytm / Cash / Unknown
  payment_reference     TEXT,       -- UPI ref number from screenshot
  purchase_date         DATE,
  category              TEXT,       -- Pantry Food, Beverages, Cleaning Supplies, etc.
  invoice_available     BOOLEAN     DEFAULT false,

  -- Proof images (stored in Supabase Storage)
  payment_screenshot_url TEXT,
  item_photo_url         TEXT,

  -- AI extraction
  ai_extracted_json     JSONB,
  ai_confidence         NUMERIC,
  clarification_question TEXT,
  clarification_answer   TEXT,

  -- Workflow status
  status                TEXT        NOT NULL DEFAULT 'draft_needs_clarification',
  auto_approval_reason  TEXT,
  rejection_reason      TEXT,

  -- Approval
  approved_by           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at           TIMESTAMPTZ,

  -- Sync tracking
  synced_to_inventory   BOOLEAN     DEFAULT false,
  synced_to_finance     BOOLEAN     DEFAULT false,
  synced_at             TIMESTAMPTZ,

  -- Duplicate detection
  duplicate_risk        BOOLEAN     DEFAULT false,
  duplicate_reason      TEXT,

  -- Timestamps
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  CONSTRAINT valid_status CHECK (status IN (
    'draft_needs_clarification',
    'auto_approved',
    'pending_review',
    'approved',
    'rejected',
    'synced_to_inventory'
  ))
);


-- ── 3. Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_manual_purchases_status
  ON public.manual_purchases (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_manual_purchases_sender
  ON public.manual_purchases (sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_manual_purchases_chat
  ON public.manual_purchases (telegram_chat_id);

CREATE INDEX IF NOT EXISTS idx_manual_purchases_date
  ON public.manual_purchases (purchase_date);


-- ── 4. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.telegram_user_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_purchases  ENABLE ROW LEVEL SECURITY;

-- telegram_user_map: service role handles all CRUD (backend uses supabaseAdmin)

-- manual_purchases: Finance + Leadership see ALL
DROP POLICY IF EXISTS "mp_read_finance_leadership" ON public.manual_purchases;
CREATE POLICY "mp_read_finance_leadership"
  ON public.manual_purchases FOR SELECT
  USING (public.current_user_role() IN ('finance', 'leadership'));

-- manual_purchases: Facility Manager sees ALL (read only)
DROP POLICY IF EXISTS "mp_read_fm" ON public.manual_purchases;
CREATE POLICY "mp_read_fm"
  ON public.manual_purchases FOR SELECT
  USING (public.current_user_role() = 'facility_manager');

-- manual_purchases: Office Boy sees own submissions only
DROP POLICY IF EXISTS "mp_read_own" ON public.manual_purchases;
CREATE POLICY "mp_read_own"
  ON public.manual_purchases FOR SELECT
  USING (
    public.current_user_role() = 'office_boy'
    AND sender_user_id = auth.uid()
  );

-- All writes go through backend service role (supabaseAdmin) — bypasses RLS.
