-- =====================================================================
-- 0002_auth_policy.sql
-- Domain restriction + auto-promote admin on first signup.
-- Applies on top of 0001_init_schema.sql.
-- =====================================================================

-- ----- replace the signup trigger so it restricts + auto-promotes -----
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  _email     text := lower(coalesce(new.email, ''));
  _domain    text := split_part(_email, '@', 2);
  _role      user_role := 'staff';
begin
  -- Domain gate: only @applywizz.ai accounts can be users.
  -- Set ALLOWED_AUTH_DOMAINS via a sql GUC if you want to override later.
  if _domain <> 'applywizz.ai' then
    raise exception 'Signups restricted to @applywizz.ai (got: %)', _email
      using errcode = '42501';
  end if;

  -- Auto-promote the COO.
  if _email = 'ramakrishna@applywizz.ai' then
    _role := 'leadership';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    _role
  )
  on conflict (id) do update set
    role = case
      when public.profiles.role = 'staff' then excluded.role
      else public.profiles.role        -- never demote
    end;

  return new;
end;
$func$;

-- Re-create the trigger to point at the updated function.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Back-fill: if ramakrishna already signed in before this migration
-- (e.g. during the magic-link testing phase), make sure he's leadership.
update public.profiles
set role = 'leadership'
where id in (
  select id from auth.users
  where lower(email) = 'ramakrishna@applywizz.ai'
);

-- =====================================================================
-- ADMIN RPC: change another user's role
-- Only callable by a leadership user (enforced inside the function).
-- Service-role API still bypasses this — see backend admin routes.
-- =====================================================================
create or replace function public.admin_set_user_role(
  target_user_id uuid,
  new_role       user_role
)
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  if public.current_user_role() <> 'leadership' then
    raise exception 'Only leadership can change roles'
      using errcode = '42501';
  end if;
  update public.profiles set role = new_role where id = target_user_id;
end;
$func$;

revoke all on function public.admin_set_user_role(uuid, user_role) from public;
grant execute on function public.admin_set_user_role(uuid, user_role)
  to authenticated;
