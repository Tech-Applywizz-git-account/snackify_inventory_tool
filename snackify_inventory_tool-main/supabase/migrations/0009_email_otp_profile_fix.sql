-- =====================================================================
-- 0009_email_otp_profile_fix.sql
-- Make passwordless email OTP signups create a complete profile.
-- =====================================================================

alter table public.profiles
  add column if not exists email text,
  add column if not exists preferred_name text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  _email text := lower(coalesce(new.email, ''));
  _domain text := split_part(_email, '@', 2);
  _role user_role := 'staff';
  _full_name text := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
begin
  if _domain <> 'applywizz.ai' then
    raise exception 'Signups restricted to @applywizz.ai'
      using errcode = '42501';
  end if;

  if _email = 'ramakrishna@applywizz.ai' then
    _role := 'leadership';
  end if;

  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(_full_name, split_part(_email, '@', 1), _email),
    _role,
    _email
  )
  on conflict (id) do update set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    email = coalesce(public.profiles.email, excluded.email),
    role = case
      when public.profiles.role = 'staff' then excluded.role
      else public.profiles.role
    end;

  return new;
end;
$func$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

update public.profiles p
set email = lower(u.email)
from auth.users u
where p.id = u.id
  and p.email is null;
