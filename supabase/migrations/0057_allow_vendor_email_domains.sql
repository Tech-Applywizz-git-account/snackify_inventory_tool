CREATE OR REPLACE FUNCTION public.enforce_vendor_profile_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _vendor_count integer;
BEGIN
  IF NEW.role::text = 'vendor'
     AND (TG_OP = 'INSERT' OR OLD.role::text IS DISTINCT FROM 'vendor') THEN
    PERFORM pg_advisory_xact_lock(720301, 1);

    SELECT count(*)
      INTO _vendor_count
      FROM public.profiles
      WHERE role::text = 'vendor'
        AND id <> NEW.id;

    IF _vendor_count >= 3 THEN
      RAISE EXCEPTION 'The maximum of 3 Vendor accounts has been reached.'
        USING errcode = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS enforce_vendor_profile_limit ON public.profiles;
CREATE TRIGGER enforce_vendor_profile_limit
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_vendor_profile_limit();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _email text := lower(coalesce(new.email, ''));
  _domain text := split_part(_email, '@', 2);
  _is_vendor boolean := coalesce(new.raw_app_meta_data->>'role', '') = 'vendor';
  _role user_role := 'staff';
  _full_name text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
BEGIN
  IF _domain <> 'applywizz.ai' AND NOT _is_vendor THEN
    RAISE EXCEPTION 'Signups restricted to @applywizz.ai'
      USING errcode = '42501';
  END IF;

  IF _is_vendor THEN
    _role := 'vendor';
  ELSIF _email = 'ramakrishna@applywizz.ai' THEN
    _role := 'leadership';
  END IF;

  INSERT INTO public.profiles (id, full_name, role, email)
  VALUES (
    new.id,
    coalesce(_full_name, split_part(_email, '@', 1), _email),
    _role,
    _email
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    email = coalesce(public.profiles.email, excluded.email),
    role = CASE
      WHEN public.profiles.role = 'staff' THEN excluded.role
      ELSE public.profiles.role
    END;

  RETURN new;
END;
$func$;
