-- =====================================================================
-- 0004_requests.sql  -  Office request module
-- Adds office_boy role + requests table + RLS.
-- =====================================================================

-- 1. extend user_role enum (Postgres requires a separate ALTER per value)
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'office_boy'
  ) then
    alter type user_role add value 'office_boy';
  end if;
end $$;

-- 2. requests table
do $$ begin
  create type request_status as enum ('pending', 'in_progress', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_category as enum ('beverage', 'cleaning', 'stationery', 'meeting_room', 'other');
exception when duplicate_object then null; end $$;

create table if not exists public.requests (
  id                       uuid primary key default uuid_generate_v4(),
  raw_text                 text not null,
  category                 request_category default 'other',
  parsed_item              text,        -- "Coffee" / "Cleaning" / etc
  parsed_employee_name     text,
  parsed_location          text,
  instruction              text,        -- the polite "Please deliver coffee to Jagan in Cabin 2"
  status                   request_status not null default 'pending',
  submitted_by             uuid not null references public.profiles(id),
  assigned_to              uuid          references public.profiles(id),
  fulfilled_by             uuid          references public.profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  fulfilled_at             timestamptz,
  notes                    text
);

create index if not exists idx_requests_status      on public.requests (status);
create index if not exists idx_requests_created_at  on public.requests (created_at desc);
create index if not exists idx_requests_submitted_by on public.requests (submitted_by);

drop trigger if exists trg_requests_touch on public.requests;
create trigger trg_requests_touch
  before update on public.requests
  for each row execute function public.touch_updated_at();

-- 3. RLS
alter table public.requests enable row level security;

drop policy if exists "requests_insert_any_auth" on public.requests;
create policy "requests_insert_any_auth"
  on public.requests for insert
  with check (auth.uid() = submitted_by);

drop policy if exists "requests_read_own_or_staff" on public.requests;
create policy "requests_read_own_or_staff"
  on public.requests for select
  using (
    submitted_by = auth.uid()
    or public.current_user_role() in ('office_boy', 'facility_manager', 'leadership')
  );

drop policy if exists "requests_update_staff" on public.requests;
create policy "requests_update_staff"
  on public.requests for update
  using (public.current_user_role() in ('office_boy', 'facility_manager', 'leadership'))
  with check (public.current_user_role() in ('office_boy', 'facility_manager', 'leadership'));

-- 4. View joining requests with submitter name for the queue
-- Drop first so reruns after later migrations do not fail when the request
-- table has gained columns that would change the view's column order.
drop view if exists public.v_request_queue cascade;
create view public.v_request_queue as
select
  r.*,
  p.full_name as submitter_name
from public.requests r
left join public.profiles p on p.id = r.submitted_by;
