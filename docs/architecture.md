# Architecture overview

## Request flow

```
[ Browser ]
   │  magic-link login → Supabase Auth issues JWT
   │
   ├──► Supabase (direct):  auth, RLS-protected reads if you ever bypass the API
   │
   └──► Express API  (Authorization: Bearer <JWT>)
            │  authMiddleware validates JWT with supabaseAdmin.auth.getUser()
            │  loads profile (role) → req.user
            │  requireRole() guards write routes
            │
            └──► Supabase Postgres (service role) — bypasses RLS for trusted server logic
```

The frontend can talk to Supabase directly OR through the Express API. The PRD picked Express, so writes go through the API where we centralize validation, transaction logging, and cost capture. Reads also go through the API so the views (`v_inventory_status`, `v_monthly_spending`) are the single source of truth.

## Schema

3 tables, 2 views.

- **products** — master catalog (name, category, unit, cost, shelf life)
- **inventory** — 1:1 with products, holds `current_stock`, `min_threshold`, `expiry_date`
- **transactions** — append-only audit log: every add/remove/waste/adjust with `quantity`, `unit_cost`, `total_cost`, `facility_manager_id`
- **v_inventory_status** — joined product+inventory + computed `stock_status` and `expiry_status`
- **v_monthly_spending** — sum of `add` transactions per month per category (for finance)

## Why the daily-update endpoint is the heart of the system

`POST /api/inventory/daily-update` accepts the facility manager's morning counts. It:

1. Loads the current stock and product cost per row.
2. For each item where new count ≠ current count, generates an `add` (if up) or `remove` (if down) transaction with cost captured at the moment.
3. Updates `inventory.current_stock`.

This means finance never has to reconcile separately — the spending report falls out of the same data that runs the dashboard.

## Auth & roles

Roles live on `public.profiles` (`facility_manager`, `finance`, `leadership`, `staff`).

- New auth.users get a default `staff` profile via the `handle_new_user` trigger.
- The leadership team manually promotes users (see README).
- RLS uses `current_user_role()` helper; the Express API uses `requireRole(...)` middleware.

The API uses the **service role key** to bypass RLS — that's fine because every request first goes through `authMiddleware` which validates the JWT and `requireRole` enforces access.
