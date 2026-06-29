-- =====================================================================
-- 0008_staff_inventory_lockdown.sql
-- Staff/employees can create service requests, but must not see inventory.
-- =====================================================================

drop policy if exists "products_read_all" on public.products;
create policy "products_read_operational_roles"
  on public.products for select
  using (
    public.current_user_role() in (
      'facility_manager',
      'finance',
      'leadership',
      'office_boy',
      'admin',
      'accounts_team'
    )
  );

drop policy if exists "inventory_read_all" on public.inventory;
create policy "inventory_read_operational_roles"
  on public.inventory for select
  using (
    public.current_user_role() in (
      'facility_manager',
      'finance',
      'leadership',
      'office_boy',
      'admin',
      'accounts_team'
    )
  );

-- Make view access use the caller's RLS privileges where supported.
alter view public.v_inventory_status set (security_invoker = true);
alter view public.v_monthly_spending set (security_invoker = true);
