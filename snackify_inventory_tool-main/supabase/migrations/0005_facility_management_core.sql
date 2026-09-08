-- =====================================================================
-- Task 1 & 14: Facility Management Core Schema
-- =====================================================================

-- 1. Update User Roles Enum
-- We add the new names. Existing rows will need manual or scripted mapping.
alter type user_role add value if not exists 'employee';
alter type user_role add value if not exists 'office_boy';
alter type user_role add value if not exists 'admin';
alter type user_role add value if not exists 'accounts_team';

-- 2. Create Bill Uploads Table
create table if not exists public.bill_uploads (
  id uuid primary key default uuid_generate_v4(),
  vendor_name text,
  bill_date date,
  invoice_number text,
  uploaded_by_user_id uuid references public.profiles(id),
  uploaded_by_name text,
  file_url text not null,
  extraction_status text default 'Extraction Pending',
  verification_status text default 'Pending Admin Verification',
  approval_status text default 'Pending Accounts Approval',
  payment_status text default 'Unpaid',
  grand_total numeric(12, 2),
  delivery_charges numeric(10, 2) default 0,
  discount numeric(10, 2) default 0,
  confidence_score numeric(5, 2),
  needs_manual_review boolean default false,
  manual_review_reason text,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz
);

-- 3. Create Bill Items Table
create table if not exists public.bill_items (
  id uuid primary key default uuid_generate_v4(),
  bill_id uuid references public.bill_uploads(id) on delete cascade,
  item_name text not null,
  category text,
  quantity numeric(12, 2) not null,
  unit text,
  unit_rate numeric(12, 2),
  tax numeric(12, 2) default 0,
  total_amount numeric(12, 2),
  inventory_action text,
  received_quantity numeric(12, 2),
  verified_quantity numeric(12, 2),
  verification_status text default 'Pending'
);

-- 4. Create Service Ratings Table
create table if not exists public.service_ratings (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid references public.requests(id) on delete cascade,
  employee_id uuid references public.profiles(id),
  office_boy_id uuid references public.profiles(id),
  rating int check (rating >= 1 and rating <= 5),
  review_comment text,
  feedback_tags text[], -- Array of strings: ['Fast service', 'Polite', etc]
  created_at timestamptz not null default now()
);

-- 5. Create Audit Logs Table
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

-- 6. Create Teams Activity Logs Table
create table if not exists public.teams_activity_logs (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid references public.requests(id),
  teams_message_id text,
  user_id uuid references public.profiles(id),
  action_clicked text,
  previous_status text,
  new_status text,
  response_time_seconds int,
  created_at timestamptz not null default now()
);

-- 7. Create Notification Logs Table
create table if not exists public.notification_logs (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid references public.requests(id),
  user_id uuid references public.profiles(id),
  notification_type text,
  title text,
  message text,
  sent_at timestamptz not null default now(),
  delivery_status text default 'Sent',
  read_status boolean default false
);

-- 8. Create Employee Preferences Table
create table if not exists public.employee_preferences (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  tea_coffee_reminder_enabled boolean default false,
  reminder_interval_hours int default 2,
  preferred_drink text default 'Tea',
  notification_enabled boolean default true,
  office_hours_start time default '09:00',
  office_hours_end time default '18:00'
);

-- 9. Add Live Status to Requests
-- Current requests table might not have live_status and the full tracking stages
alter table public.requests add column if not exists live_status text default 'placed';
alter table public.requests add column if not exists accepted_at timestamptz;
alter table public.requests add column if not exists started_at timestamptz;
alter table public.requests add column if not exists on_the_way_at timestamptz;
alter table public.requests add column if not exists cancelled_at timestamptz;
alter table public.requests add column if not exists issue_reason text;
alter table public.requests add column if not exists rating_status text default 'pending';

-- 10. Enable RLS on new tables
alter table public.bill_uploads enable row level security;
alter table public.bill_items enable row level security;
alter table public.service_ratings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.teams_activity_logs enable row level security;
alter table public.notification_logs enable row level security;
alter table public.employee_preferences enable row level security;

-- 11. Basic Policies for new tables
create policy "admin_all_bills" on public.bill_uploads for all using (public.current_user_role() in ('admin', 'leadership', 'accounts_team'));
create policy "office_boy_upload_bills" on public.bill_uploads for insert with check (public.current_user_role() in ('office_boy', 'facility_manager'));
create policy "office_boy_view_own_bills" on public.bill_uploads for select using (uploaded_by_user_id = auth.uid());

create policy "employee_view_own_prefs" on public.employee_preferences for all using (employee_id = auth.uid());
create policy "employee_view_own_ratings" on public.service_ratings for select using (employee_id = auth.uid());
create policy "employee_insert_ratings" on public.service_ratings for insert with check (employee_id = auth.uid());
