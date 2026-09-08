-- supabase/migrations/0026_enrollment_otps.sql
-- Short-lived OTP records for the backend-issued login flow.
-- RLS ON, no policies → deny-all for browser. Service_role bypasses RLS.

CREATE TABLE IF NOT EXISTS public.enrollment_otps (
  id                           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email                        text NOT NULL,
  code_hash                    text NOT NULL,
  expires_at                   timestamptz NOT NULL,
  attempts                     integer NOT NULL DEFAULT 0,
  used                         boolean NOT NULL DEFAULT false,
  enrollment_token_hash        text,
  enrollment_token_expires_at  timestamptz,
  created_at                   timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS enrollment_otps_email_idx
  ON public.enrollment_otps (email, created_at DESC);

ALTER TABLE public.enrollment_otps ENABLE ROW LEVEL SECURITY;
-- No policies = deny-all for anon/authenticated. Service_role unaffected.
