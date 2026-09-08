-- =====================================================================
-- 0027_auth_enrollment_transactions.sql
--
-- Two changes in this migration:
--   A. Add invalidated_at to public.enrollment_otps
--   B. Create public.enrollment_transactions
--
-- Apply via Supabase SQL Editor only.
-- DO NOT run with supabase db push against production.
-- =====================================================================


-- ---------------------------------------------------------------
-- A. Add invalidated_at to public.enrollment_otps
-- ---------------------------------------------------------------
ALTER TABLE public.enrollment_otps
  ADD COLUMN IF NOT EXISTS invalidated_at timestamptz NULL;


-- ---------------------------------------------------------------
-- B. Create public.enrollment_transactions
-- ---------------------------------------------------------------
-- Purpose:
--   Server-side state created after a new employee successfully
--   verifies their OTP email code.
--
-- Reserve transaction before calling Supabase MFA:
--
--   UPDATE public.enrollment_transactions
--   SET
--     version      = version + 1,
--     verifying_at = now(),
--     updated_at   = now()
--   WHERE
--     id           = :transaction_id
--     AND version  = :expected_version
--     AND locked_at IS NULL
--     AND used_at IS NULL
--     AND expires_at > now()
--     AND (
--       verifying_at IS NULL
--       OR verifying_at < now() - interval '60 seconds'
--     );
--
--   If the UPDATE affects 0 rows, do not call Supabase MFA. Treat that as
--   a reservation miss caused by version drift, expiry, lock, prior use, or
--   an in-flight verifier that still owns the reservation.
--
--   Reserve only sets version/verifying_at/updated_at.
--   DO NOT increment attempts during reserve.
--
-- If Supabase MFA returns invalid TOTP code:
--
--   UPDATE public.enrollment_transactions
--   SET
--     attempts     = attempts + 1,
--     locked_at    = CASE
--                      WHEN attempts + 1 >= 5 THEN now()
--                      ELSE locked_at
--                    END,
--     verifying_at = null,
--     updated_at   = now()
--   WHERE id = :transaction_id;
--
-- On successful enrollment:
--
--   UPDATE public.enrollment_transactions
--   SET
--     used_at      = now(),
--     verifying_at = null,
--     updated_at   = now()
--   WHERE id = :transaction_id;
--
-- If an unexpected server error occurs:
--
--   UPDATE public.enrollment_transactions
--   SET
--     verifying_at = null,
--     updated_at   = now()
--   WHERE id = :transaction_id;
--
--   Do not increment attempts for unexpected server errors.
--   Do not set locked_at for unexpected server errors.
--
-- Crash recovery:
--   A stuck reservation is reclaimable after 60 seconds because reserve
--   accepts verifying_at older than now() - interval '60 seconds'.
--
-- Cleanup:
--   Delete expired rows during normal maintenance.
--   Delete used rows after 30 days.

CREATE TABLE IF NOT EXISTS public.enrollment_transactions (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text         NOT NULL,
  user_id       uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_id     text         NOT NULL,
  expires_at    timestamptz  NOT NULL,
  attempts      integer      NOT NULL DEFAULT 0,
  version       integer      NOT NULL DEFAULT 1,
  verifying_at  timestamptz  NULL,
  locked_at     timestamptz  NULL,
  used_at       timestamptz  NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

-- RLS enabled with no browser-access policies.
-- anon/authenticated get deny-all; service_role bypasses RLS.
ALTER TABLE public.enrollment_transactions ENABLE ROW LEVEL SECURITY;

-- No redundant (id, version) index. id is already the primary key.
CREATE INDEX IF NOT EXISTS enrollment_transactions_expires_at_idx
  ON public.enrollment_transactions (expires_at);

CREATE INDEX IF NOT EXISTS enrollment_transactions_email_expires_at_idx
  ON public.enrollment_transactions (email, expires_at);
