-- =====================================================================
-- 0007_self_learning_ai_brain.sql
-- Module 23: Comprehensive Learning Infrastructure
-- =====================================================================

-- 1. Preference Scores (The +10 / -5 system)
create table if not exists public.employee_preference_scores (
  id                                uuid primary key default uuid_generate_v4(),
  employee_id                       uuid not null references public.profiles(id) on delete cascade,
  preference_type                   text not null, -- 'drink', 'snack', 'tone', 'time'
  preference_value                  text not null, -- 'CCD Coffee', 'Mom Mode', etc.
  score                             integer default 50,
  confidence_level                  numeric(3,2) default 0.1,
  last_updated_at                   timestamptz default now(),
  unique(employee_id, preference_type, preference_value)
);

-- 2. Taste Preferences (Extracted from comments)
create table if not exists public.employee_taste_preferences (
  id                                uuid primary key default uuid_generate_v4(),
  employee_id                       uuid not null references public.profiles(id) on delete cascade,
  item_name                         text not null,
  sugar_preference                  text default 'Normal',
  strength_preference               text default 'Normal',
  milk_preference                   text default 'Normal',
  temperature_preference            text default 'Normal',
  notes                             text,
  confidence_score                  integer default 0,
  updated_at                        timestamptz default now(),
  unique(employee_id, item_name)
);

-- 3. Dynamic Reminder Policy (Learns the "Best Time")
create table if not exists public.employee_reminder_policy (
  id                                uuid primary key default uuid_generate_v4(),
  employee_id                       uuid not null references public.profiles(id) on delete cascade,
  reminder_enabled                  boolean default true,
  max_daily_reminders               integer default 2,
  preferred_morning_time            time default '10:45:00',
  preferred_afternoon_time          time default '14:45:00',
  pause_until                       timestamptz,
  pause_reason                      text,
  last_updated_at                   timestamptz default now(),
  unique(employee_id)
);

-- 4. Learning Logs (AI Reasoning History)
create table if not exists public.employee_daily_learning_logs (
  id                                uuid primary key default uuid_generate_v4(),
  employee_id                       uuid not null references public.profiles(id) on delete cascade,
  learning_date                     date default current_date,
  activity_summary                  text,
  old_profile_snapshot              jsonb,
  new_profile_snapshot              jsonb,
  score_changes                     jsonb,
  learning_summary                  text,
  created_at                        timestamptz default now()
);

-- RLS
alter table public.employee_preference_scores enable row level security;
alter table public.employee_taste_preferences enable row level security;
alter table public.employee_reminder_policy enable row level security;
alter table public.employee_daily_learning_logs enable row level security;

create policy "users_own_scores" on public.employee_preference_scores for all using (auth.uid() = employee_id);
create policy "users_own_tastes" on public.employee_taste_preferences for all using (auth.uid() = employee_id);
create policy "users_own_policy" on public.employee_reminder_policy for all using (auth.uid() = employee_id);
create policy "users_own_learning" on public.employee_daily_learning_logs for all using (auth.uid() = employee_id);
