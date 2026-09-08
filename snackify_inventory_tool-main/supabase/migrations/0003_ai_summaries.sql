-- =====================================================================
-- 0003_ai_summaries.sql  -  AI weekly summary cache + history
-- =====================================================================

create table if not exists public.ai_summaries (
  id              uuid primary key default uuid_generate_v4(),
  period_start    date not null,
  period_end      date not null,
  content         text not null,
  model           text not null,
  prompt_tokens   int,
  completion_tokens int,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  unique (period_start, period_end)
);

create index if not exists idx_ai_summaries_created_at
  on public.ai_summaries (created_at desc);

-- RLS: leadership + finance can read; only service role (via API) inserts.
alter table public.ai_summaries enable row level security;

drop policy if exists "ai_summaries_read" on public.ai_summaries;
create policy "ai_summaries_read"
  on public.ai_summaries for select
  using (public.current_user_role() in ('leadership', 'finance'));

drop policy if exists "ai_summaries_no_direct_write" on public.ai_summaries;
-- intentionally no write policy for authenticated; only service role bypasses RLS.
