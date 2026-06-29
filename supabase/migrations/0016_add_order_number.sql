-- =====================================================================
-- Migration 0016: Preferred-name order numbers
-- Adds user-specific sequential order numbers and locks preferred-name edits.
-- =====================================================================

ALTER TABLE public.requests
  ADD COLUMN IF NOT EXISTS user_order_number text,
  ADD COLUMN IF NOT EXISTS user_order_seq int;

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_user_order_number_unique
  ON public.requests (user_order_number)
  WHERE user_order_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_submitted_by_user_order_seq_unique
  ON public.requests (submitted_by, user_order_seq)
  WHERE user_order_seq IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_preferred_name_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.preferred_name IS DISTINCT FROM OLD.preferred_name
     AND OLD.preferred_name IS NOT NULL THEN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND COALESCE(public.current_user_role()::text, '') NOT IN ('leadership', 'facility_manager') THEN
      RAISE EXCEPTION 'Only admins or authorized persons can edit the preferred name.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_preferred_name_update ON public.profiles;
CREATE TRIGGER trg_check_preferred_name_update
  BEFORE UPDATE OF preferred_name ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.check_preferred_name_update();

CREATE OR REPLACE FUNCTION public.generate_requests_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pref_name text;
  next_seq integer;
  candidate text;
BEGIN
  IF NEW.user_order_number IS NOT NULL AND NEW.user_order_seq IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Serialize numbering per submitter to avoid max(seq) races.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.submitted_by::text, 0));

  SELECT COALESCE(NULLIF(trim(preferred_name), ''), NULLIF(trim(full_name), ''), 'USR')
    INTO pref_name
  FROM public.profiles
  WHERE id = NEW.submitted_by;

  pref_name := UPPER(REGEXP_REPLACE(COALESCE(pref_name, 'USR'), '[^a-zA-Z0-9]', '', 'g'));
  IF pref_name = '' THEN
    pref_name := 'USR';
  END IF;

  -- Serialize shared display prefixes too, because user_order_number is
  -- globally unique and two people can have the same preferred name.
  PERFORM pg_advisory_xact_lock(hashtextextended('request-order-prefix:' || pref_name, 0));

  SELECT COALESCE(MAX(user_order_seq), 0) + 1
    INTO next_seq
  FROM public.requests
  WHERE submitted_by = NEW.submitted_by;

  LOOP
    candidate := pref_name || LPAD(next_seq::text, 3, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.requests
      WHERE user_order_number = candidate
    );
    next_seq := next_seq + 1;
  END LOOP;

  NEW.user_order_seq := COALESCE(NEW.user_order_seq, next_seq);
  NEW.user_order_number := COALESCE(NEW.user_order_number, candidate);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_requests_order_number ON public.requests;
CREATE TRIGGER trg_generate_requests_order_number
  BEFORE INSERT ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_requests_order_number();

DROP VIEW IF EXISTS public.v_request_queue CASCADE;
CREATE VIEW public.v_request_queue AS
SELECT
  r.id, r.raw_text, r.category, r.parsed_item,
  r.parsed_employee_name, r.parsed_location, r.instruction,
  r.status, r.live_status, r.submitted_by, r.assigned_to,
  r.fulfilled_by, r.created_at, r.updated_at, r.fulfilled_at,
  r.notes, r.priority, r.rating, r.feedback, r.rating_status,
  r.accepted_at, r.started_at, r.on_the_way_at, r.cancelled_at,
  r.user_order_number, r.user_order_seq,
  p.full_name AS submitter_name,
  COALESCE(pref.notification_tone, 'Friendly') AS notification_tone
FROM public.requests r
LEFT JOIN public.profiles p ON p.id = r.submitted_by
LEFT JOIN public.employee_cafeteria_preferences pref ON pref.user_id = r.submitted_by;
