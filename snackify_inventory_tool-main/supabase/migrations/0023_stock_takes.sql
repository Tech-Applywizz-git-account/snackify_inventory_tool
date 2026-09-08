-- Feature #8: Photo Stock-take
-- Advisory-only shelf counts from a Telegram photo. AI counts are NEVER
-- auto-applied: leadership confirms or discards each stock-take. Every run is
-- persisted here so a server restart between photo and confirm is safe.

create table if not exists stock_takes (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid references profiles(id),
  created_by_name text,
  photo_urls      text[]      not null default '{}',
  ai_counts       jsonb       not null default '[]',   -- [{ item_name, count }]
  diff            jsonb       not null default '[]',    -- [{ product_id, name, system, counted, delta }]
  status          text        not null default 'pending'
                  check (status in ('pending', 'confirmed', 'discarded')),
  confirmed_by    uuid references profiles(id),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index if not exists idx_stock_takes_status on stock_takes (status);

-- Backend uses the service-role key (bypasses RLS), same as every other table.
-- Enable RLS with no public policy so anon/auth clients cannot read or write.
alter table stock_takes enable row level security;
