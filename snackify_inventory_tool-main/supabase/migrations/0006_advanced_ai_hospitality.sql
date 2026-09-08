-- =====================================================================
-- 0006_advanced_ai_hospitality.sql
-- Building the "Brain" for Module 21
-- =====================================================================

-- 1. Office Schedule & Rules
create table if not exists public.office_schedule_settings (
  id                                uuid primary key default uuid_generate_v4(),
  working_days                      text[] default '{Monday, Tuesday, Wednesday, Thursday, Friday}',
  office_start_time                 time default '09:00:00',
  office_end_time                   time default '17:00:00',
  lunch_start_time                  time default '13:00:00',
  lunch_end_time                    time default '14:00:00',
  max_reminders_per_day             integer default 2,
  created_at                        timestamptz default now(),
  updated_at                        timestamptz default now()
);

-- 2. Employee AI Profiles (The Learning Table)
create table if not exists public.employee_ai_preferences (
  id                                uuid primary key default uuid_generate_v4(),
  employee_id                       uuid not null references public.profiles(id) on delete cascade,
  preferred_drink                   text,
  secondary_drink                   text,
  preferred_snack                   text,
  preferred_morning_time            time default '10:45:00',
  preferred_afternoon_time          time default '14:45:00',
  usual_location                    text,
  sugar_preference                  text default 'Normal',
  milk_preference                   text default 'Normal',
  reminder_enabled                  boolean default true,
  max_daily_reminders               integer default 2,
  notification_tone                 text default 'Casual',
  average_rating                    numeric(3,2) default 0.0,
  created_at                        timestamptz default now(),
  updated_at                        timestamptz default now(),
  unique(employee_id)
);

-- 3. Notification Behavior (Spam Protection)
create table if not exists public.employee_notification_behavior (
  id                                uuid primary key default uuid_generate_v4(),
  employee_id                       uuid not null references public.profiles(id) on delete cascade,
  notification_type                 text, -- 'Tea Coffee Reminder', 'Lunch', etc.
  sent_count                        integer default 0,
  clicked_count                     integer default 0,
  skipped_count                     integer default 0,
  last_sent_at                      timestamptz,
  last_clicked_at                   timestamptz,
  engagement_score                  integer default 100, -- 0 to 100
  updated_at                        timestamptz default now(),
  unique(employee_id, notification_type)
);

-- 4. AI Recommendation Logs
create table if not exists public.ai_recommendation_logs (
  id                                uuid primary key default uuid_generate_v4(),
  employee_id                       uuid not null references public.profiles(id),
  recommendation_type               text,
  suggested_item                    text,
  alternative_item                  text,
  reason                            text,
  notification_title                text,
  notification_message              text,
  action_buttons                    text[],
  sent_status                       text default 'Sent',
  employee_action                   text, -- 'Accepted', 'Try Alternative', 'Skip'
  created_at                        timestamptz default now(),
  responded_at                      timestamptz
);

-- 5. Real-time Item Availability
create table if not exists public.item_availability (
  id                                uuid primary key default uuid_generate_v4(),
  item_name                         text unique not null,
  category                          text,
  is_available                      boolean default true,
  stock_quantity                    integer default 0,
  updated_at                        timestamptz default now()
);

-- Seed initial schedule and items
insert into public.office_schedule_settings (id) values (uuid_generate_v4()) on conflict do nothing;

insert into public.item_availability (item_name, category) values 
('Coffee (CCD)', 'Beverage'),
('Tea', 'Beverage'),
('Lemon Tea', 'Beverage'),
('Bread', 'Snack'),
('Peanut Butter', 'Snack'),
('Jam', 'Snack'),
('Lunch', 'Food')
on conflict (item_name) do nothing;

-- RLS
alter table public.office_schedule_settings enable row level security;
alter table public.employee_ai_preferences enable row level security;
alter table public.employee_notification_behavior enable row level security;
alter table public.ai_recommendation_logs enable row level security;
alter table public.item_availability enable row level security;

create policy "all_read_schedule" on public.office_schedule_settings for select using (true);
create policy "users_own_prefs" on public.employee_ai_preferences for all using (auth.uid() = employee_id);
create policy "users_own_behavior" on public.employee_notification_behavior for all using (auth.uid() = employee_id);
create policy "users_own_recs" on public.ai_recommendation_logs for all using (auth.uid() = employee_id);
create policy "all_read_items" on public.item_availability for select using (true);
