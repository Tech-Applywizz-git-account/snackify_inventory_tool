-- Allow a user to edit their own preferred_name. Admins still may edit anyone.
-- service_role (Snackify API) continues to bypass this check.

CREATE OR REPLACE FUNCTION public.check_preferred_name_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.preferred_name IS DISTINCT FROM OLD.preferred_name
     AND OLD.preferred_name IS NOT NULL THEN
    IF COALESCE(auth.role(), '') = 'service_role' THEN
      RETURN NEW;
    END IF;
    IF NEW.id IS NOT NULL AND NEW.id = auth.uid() THEN
      RETURN NEW;
    END IF;
    IF COALESCE(public.current_user_role()::text, '') NOT IN ('leadership', 'facility_manager') THEN
      RAISE EXCEPTION 'Only admins or authorized persons can edit the preferred name.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
