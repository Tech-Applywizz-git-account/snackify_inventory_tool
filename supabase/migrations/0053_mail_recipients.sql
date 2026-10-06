-- =====================================================================
-- 0053_mail_recipients.sql
-- Admin-managed TO / CC lists for operational Snackify emails.
-- Seeds current production recipients so behavior matches today's fallbacks.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.mail_recipients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text NOT NULL,
  display_name text,
  mail_type text NOT NULL CHECK (
    mail_type IN (
      'meal_report',
      'daily_consumption',
      'low_stock',
      'guest_meal',
      'support_ticket'
    )
  ),
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('to', 'cc')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_recipients_email_type_kind_unique UNIQUE (email, mail_type, recipient_kind)
);

CREATE INDEX IF NOT EXISTS idx_mail_recipients_type_active
  ON public.mail_recipients (mail_type, active)
  WHERE active = true;

ALTER TABLE public.mail_recipients ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mail_recipients IS
  'Admin-managed TO/CC recipients for ops emails (meal reports, consumption, low stock, guest meal, support).';

-- ---------------------------------------------------------------------
-- Seed existing recipients (idempotent)
-- meal_report: leadership + office_boy + facility_manager (+ admin if any)
-- daily_consumption: consumer_report subscribers
-- low_stock: leadership
-- guest_meal: leadership + finance
-- support_ticket: facility_manager TO, dinesh CC
-- ---------------------------------------------------------------------
INSERT INTO public.mail_recipients (email, display_name, mail_type, recipient_kind, active)
VALUES
  -- Meal bookings report (TO)
  ('jagan@applywizz.ai', 'Jagan', 'meal_report', 'to', true),
  ('dinesh@applywizz.ai', 'Dinesh', 'meal_report', 'to', true),
  ('ramakrishna@applywizz.ai', 'Ramakrishna', 'meal_report', 'to', true),
  ('shyam@applywizz.ai', 'Shyam', 'meal_report', 'to', true),
  ('ranjithkumar@applywizz.ai', 'RanjithKumar', 'meal_report', 'to', true),
  ('anthagirimahesh@applywizz.ai', 'Anthagirimahesh', 'meal_report', 'to', true),
  ('santhosh.valaboju@applywizz.ai', 'Santhosh', 'meal_report', 'to', true),

  -- Daily consumption report (TO)
  ('dinesh@applywizz.ai', 'Dinesh', 'daily_consumption', 'to', true),

  -- Low stock alerts (TO)
  ('jagan@applywizz.ai', 'Jagan', 'low_stock', 'to', true),
  ('dinesh@applywizz.ai', 'Dinesh', 'low_stock', 'to', true),
  ('ramakrishna@applywizz.ai', 'Ramakrishna', 'low_stock', 'to', true),
  ('shyam@applywizz.ai', 'Shyam', 'low_stock', 'to', true),

  -- Guest meal notifications (TO)
  ('jagan@applywizz.ai', 'Jagan', 'guest_meal', 'to', true),
  ('dinesh@applywizz.ai', 'Dinesh', 'guest_meal', 'to', true),
  ('ramakrishna@applywizz.ai', 'Ramakrishna', 'guest_meal', 'to', true),
  ('shyam@applywizz.ai', 'Shyam', 'guest_meal', 'to', true),

  -- Support tickets (TO + CC)
  ('anthagirimahesh@applywizz.ai', 'Anthagirimahesh', 'support_ticket', 'to', true),
  ('santhosh.valaboju@applywizz.ai', 'Santhosh', 'support_ticket', 'to', true),
  ('dinesh@applywizz.ai', 'Dinesh', 'support_ticket', 'cc', true)
ON CONFLICT (email, mail_type, recipient_kind) DO NOTHING;
