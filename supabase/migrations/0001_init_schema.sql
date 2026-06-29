-- =====================================================================
-- Applyways Office Pantry Inventory Management — Initial Schema
-- =====================================================================
-- Tables: products, inventory, transactions
-- Roles: facility_manager, finance, leadership, staff (read-only)
-- All tables use Row Level Security (RLS).
-- =====================================================================

-- Enable uuid generation
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
do $$ begin
  create type product_category as enum (
    'consumables',
    'coffee_materials',
    'washroom',
    'beverages'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type product_unit as enum ('pieces', 'packs', 'kg', 'liters', 'boxes');
exception when duplicate_object then null; end $$;

do $$ begin
  create type transaction_type as enum ('add', 'remove', 'waste', 'adjust');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('facility_manager', 'finance', 'leadership', 'staff');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- USER PROFILES — extends auth.users with a role
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role user_role not null default 'staff',
  created_at timestamptz not null default now()
);

-- Helper function to get current user's role (avoids RLS recursion)
create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- PRODUCTS — master catalog
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category product_category not null,
  unit product_unit not null,
  cost_per_unit numeric(10, 2) not null check (cost_per_unit >= 0),
  shelf_life_days int check (shelf_life_days is null or shelf_life_days > 0),
  supplier_hyperpure_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_active on public.products(active);

-- ---------------------------------------------------------------------
-- INVENTORY — current stock per product
-- One row per product (1:1).
-- ---------------------------------------------------------------------
create table if not exists public.inventory (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  current_stock numeric(10, 2) not null default 0 check (current_stock >= 0),
  min_threshold numeric(10, 2) not null default 0 check (min_threshold >= 0),
  date_added date,
  expiry_date date,
  last_updated timestamptz not null default now(),
  last_updated_by uuid references public.profiles(id)
);

create index if not exists idx_inventory_product on public.inventory(product_id);
create index if not exists idx_inventory_expiry on public.inventory(expiry_date);

-- ---------------------------------------------------------------------
-- TRANSACTIONS — audit trail of every stock change
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references public.products(id) on delete restrict,
  type transaction_type not null,
  quantity numeric(10, 2) not null check (quantity > 0),
  unit_cost numeric(10, 2),         -- captured at txn time for spending reports
  total_cost numeric(12, 2),        -- quantity * unit_cost, computed in API
  occurred_at timestamptz not null default now(),
  facility_manager_id uuid references public.profiles(id),
  notes text
);

create index if not exists idx_transactions_product on public.transactions(product_id);
create index if not exists idx_transactions_occurred_at on public.transactions(occurred_at);
create index if not exists idx_transactions_type on public.transactions(type);

-- ---------------------------------------------------------------------
-- VIEWS — what the dashboards consume
-- ---------------------------------------------------------------------

-- Low-stock and expiring-soon items, joined with product info
create or replace view public.v_inventory_status as
select
  p.id                  as product_id,
  p.name                as product_name,
  p.category,
  p.unit,
  p.cost_per_unit,
  i.current_stock,
  i.min_threshold,
  i.expiry_date,
  i.last_updated,
  case
    when i.current_stock <= 0 then 'out_of_stock'
    when i.current_stock <= i.min_threshold then 'low'
    else 'ok'
  end                   as stock_status,
  case
    when i.expiry_date is null then null
    when i.expiry_date < current_date then 'expired'
    when i.expiry_date <= current_date + interval '2 days' then 'expiring_soon'
    else 'fresh'
  end                   as expiry_status
from public.products p
left join public.inventory i on i.product_id = p.id
where p.active = true;

-- Monthly spending by category (Finance report)
create or replace view public.v_monthly_spending as
select
  date_trunc('month', t.occurred_at)::date as month,
  p.category,
  sum(coalesce(t.total_cost, t.quantity * coalesce(t.unit_cost, p.cost_per_unit))) as total_spent,
  sum(t.quantity)                                                                   as total_quantity,
  count(*)                                                                          as txn_count
from public.transactions t
join public.products p on p.id = t.product_id
where t.type = 'add'
group by 1, 2
order by 1 desc, 2;

-- ---------------------------------------------------------------------
-- TRIGGERS — auto-update timestamps
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

create or replace function public.touch_inventory_last_updated()
returns trigger language plpgsql as $$
begin
  new.last_updated := now();
  return new;
end $$;

drop trigger if exists trg_inventory_last_updated on public.inventory;
create trigger trg_inventory_last_updated
  before update on public.inventory
  for each row execute function public.touch_inventory_last_updated();

-- ---------------------------------------------------------------------
-- RLS POLICIES
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.products     enable row level security;
alter table public.inventory    enable row level security;
alter table public.transactions enable row level security;

-- profiles: a user can read/update their own row; leadership sees all
drop policy if exists "profiles_self_read"   on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "profiles_leadership"  on public.profiles;

create policy "profiles_self_read"
  on public.profiles for select
  using (auth.uid() = id or public.current_user_role() = 'leadership');

create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id);

create policy "profiles_leadership"
  on public.profiles for all
  using (public.current_user_role() = 'leadership');

-- products: everyone authenticated reads; only facility_manager + leadership write
drop policy if exists "products_read_all" on public.products;
drop policy if exists "products_write_fm_lead" on public.products;

create policy "products_read_all"
  on public.products for select
  using (auth.role() = 'authenticated');

create policy "products_write_fm_lead"
  on public.products for all
  using (public.current_user_role() in ('facility_manager', 'leadership'))
  with check (public.current_user_role() in ('facility_manager', 'leadership'));

-- inventory: everyone authenticated reads current stock; only facility_manager writes
drop policy if exists "inventory_read_all" on public.inventory;
drop policy if exists "inventory_write_fm" on public.inventory;

create policy "inventory_read_all"
  on public.inventory for select
  using (auth.role() = 'authenticated');

create policy "inventory_write_fm"
  on public.inventory for all
  using (public.current_user_role() in ('facility_manager', 'leadership'))
  with check (public.current_user_role() in ('facility_manager', 'leadership'));

-- transactions: facility_manager + finance + leadership read; only facility_manager inserts
drop policy if exists "transactions_read_priv" on public.transactions;
drop policy if exists "transactions_insert_fm" on public.transactions;

create policy "transactions_read_priv"
  on public.transactions for select
  using (public.current_user_role() in ('facility_manager', 'finance', 'leadership'));

create policy "transactions_insert_fm"
  on public.transactions for insert
  with check (public.current_user_role() in ('facility_manager', 'leadership'));

-- ---------------------------------------------------------------------
-- AUTO-PROFILE on signup
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'staff')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
