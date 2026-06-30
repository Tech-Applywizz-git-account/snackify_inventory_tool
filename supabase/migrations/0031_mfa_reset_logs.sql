-- =====================================================================
-- Migration 0031: MFA Reset Logs
-- Creates a dedicated table to log authenticator reset actions.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.mfa_reset_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reset_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reset_by_email TEXT,
    target_user_id UUID,
    target_user_email TEXT,
    reset_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.mfa_reset_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Only leadership (Admins) can view these logs
CREATE POLICY "Leadership users can read MFA reset logs"
ON public.mfa_reset_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'leadership'
    )
);
