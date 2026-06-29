# ApplyWizz Office Pantry — Detailed PRD

> **Status:** Living document · Last updated 2026-06-02
> **Repo:** `Inventory` · **Branch documented:** `feat/cafeteria-sandwich-spread-flow`
> Covers the full system: web app, backend API, Telegram bot, database, and scheduled jobs.

---

## 1. Product Summary

ApplyWizz Office Pantry ("Snackify") is an internal system that runs a company
cafeteria/pantry. It tracks **inventory**, captures **purchases** (vendor bills
and no-receipt buys), lets employees **order food / book meals**, prints
**meal tokens** per cabin, and gives leadership **AI-driven stock alerts,
predictive ordering, and photo stock-takes**.

The office operates **Monday–Friday only** (weekends = 0 headcount). This rule
shapes perishable warnings, meal printing, and forecasting.

### 1.1 Tech stack & deployment

| Layer | Technology | Hosting |
|-------|-----------|---------|
| Frontend | React + Vite + React Router + Tailwind | Vercel (`snackify.applywizz.ai`) |
| Backend | Node.js + Express (ESM) | Render (`inventory-vgor.onrender.com`) |
| Database | Supabase Postgres + RLS + Storage | Supabase |
| AI | OpenAI GPT-4o / GPT-4o-mini (vision + text) | OpenAI API |
| Messaging | Telegram Bot API, Microsoft Teams webhook, Web Push | — |
| Scheduling | Supabase `pg_cron` + `pg_net` → backend `/api/cron/*` | Supabase |

### 1.2 User roles

| Role | Home page | Capability summary |
|------|-----------|--------------------|
| `leadership` | `/dashboard` | Full access: admin, approvals, reports, connections, forecasts |
| `finance` | `/dashboard` | Bills, finance ledger, manual-purchase review |
| `facility_manager` | `/dashboard` | Inventory, restock, daily updates, meal tokens |
| `office_boy` | `/queue` | Fulfil orders, meal tokens, bills, stock-take photos |
| `staff` | `/request` | Order food, book meals, view their meal box |

---

## 2. System Architecture (high level)

```
                         ┌─────────────────────────────┐
                         │        Supabase             │
                         │  Postgres + RLS + Storage   │
                         │  + pg_cron + pg_net         │
                         └───────────▲──────┬──────────┘
                                     │      │ cron HTTP (x-cron-secret)
            service-role key (admin) │      │ every Mon / daily
                                     │      ▼
   ┌──────────────┐  HTTPS   ┌───────┴────────────────┐
   │  React SPA   │ ───────► │   Express API (Render) │
   │  (Vercel)    │ ◄─────── │  authMiddleware (JWT)  │
   └──────┬───────┘  JSON    └───┬─────────┬──────────┘
          │ Supabase JS (auth)   │         │
          │ MFA / AAL2           │         │ OpenAI (vision/text)
          ▼                      │         ▼
   Supabase Auth (TOTP)          │   ┌──────────────┐
                                 │   │  OpenAI API  │
   ┌───────────────┐  webhook    │   └──────────────┘
   │ Telegram Bot  │ ──────────► │
   │ (field users) │ ◄────────── │ → Teams webhook, Web Push
   └───────────────┘  replies    │
```

**Two trust zones in the backend:**
- **Public routes** (no JWT): `/api/bills/webhook`, `/api/telegram/webhook`,
  `/api/auth`, `/api/cron`. Each guards itself with its own secret (webhook key
  / `CRON_SECRET`).
- **Protected routes** (`app.use('/api', authMiddleware)`): everything else
  requires a valid Supabase JWT.

---

## 3. Authentication & Authorization Flow

```
User → /login (React)
   │
   ├─ email + password → Supabase Auth  ──► AAL1 session
   │
   ├─ TOTP (MFA) challenge ──────────────► AAL2 session   ◄─ REQUIRED
   │
   ▼
Protected route guard (App.jsx):
   if !session            → /login
   if aal !== 'aal2'      → /login        (MFA mandatory)
   if role not in allow[] → "Access denied"
   │
   ▼
OnboardingGate: has employee_cafeteria_preferences.onboarding_completed?
   no  → OnboardingPage
   yes → app (Layout + InactivityLock)
   │
   ▼
RoleHome → redirects to role's home page
```

- **MFA is mandatory** — only `aal2` (TOTP-verified) sessions reach the app.
- **InactivityLock** auto-locks an idle session.
- Backend `authMiddleware` validates the Supabase JWT on every `/api/*` call
  (except the four public routes).
- Database access uses the **service-role key** server-side (bypasses RLS);
  RLS protects against direct client access.

---

## 4. Database Schema (core tables)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | User identity + role | `id`, `role`, `full_name` |
| `products` | Catalog | `id`, `name`, `unit`, `cost_per_unit`, `shelf_life_days`, `active`, `daily_usage` |
| `inventory` | Live stock level | `product_id`, `current_stock`, `min_threshold`, `last_updated_by` |
| `transactions` | Audit ledger | `product_id`, `type` enum(`add`,`remove`,`waste`,`adjust`), `quantity`, `unit_cost`, `total_cost`, `facility_manager_id`, `notes` |
| `bill_uploads` | Vendor invoices | `vendor_name`, `invoice_number`, `grand_total`, `verification_status`, `approval_status` |
| `bill_items` | Invoice line items | `bill_id`, `item_name`, `quantity`, `unit_rate`, `tax`, `total_amount` |
| `manual_purchases` | No-receipt buys via Telegram | `sender_*`, `item_name`, `amount`, `status`, `confirmation_step`, `synced_*` |
| `cafeteria_items` | Orderable menu | `item_name`, `display_name`, `stock_today`, `stock_servings`, `orderable`, `sandwich_type` |
| `employee_cafeteria_preferences` | Per-user prefs + cabin | `user_id`, `cabin`, `reminder_enabled`, `onboarding_completed` |
| `meal_bookings` | Daily meal choices | `user_id`, `meal_date`, `choice`, `token_number`, `cabin_name` |
| `meal_print_jobs` | Print agent queue | `meal_date`, `cabin_name`, `scheduled_for`, `status`, `token_count` |
| `product_forecasts` / `v_latest_forecasts` | Weekly predictive ordering (#9) | `product_id`, `suggested_order`, `basis`, `week_start` |
| `stock_takes` | Photo stock-take (#8) | `photo_urls[]`, `ai_counts`, `diff`, `status`, `confirmed_by` |
| `telegram_user_map` | Link Telegram chat → profile | `telegram_chat_id`, `user_id` |
| `ai_summaries` | Cached AI insights | per-feature JSON |

**Migrations** live in `supabase/migrations/000X_*.sql` and are run manually in
the Supabase SQL editor. Each risky one ships a `rollback_*` counterpart.

---

## 5. API Route Map

| Mount | Router | Auth | Notes |
|-------|--------|------|-------|
| `/health` | — | public | liveness |
| `/api/bills/webhook` | billWebhook | webhook key | inbound bill ingestion |
| `/api/telegram/webhook` | telegramWebhook | webhook key | **bot brain** (see §6) |
| `/api/auth` | auth | public | login helpers |
| `/api/cron/*` | cron | `CRON_SECRET` | scheduled jobs (see §10) |
| `/api/products` | products | JWT | catalog CRUD |
| `/api/inventory` | inventory | JWT | stock levels |
| `/api/transactions` | transactions | JWT | ledger |
| `/api/reports` | reports + aiSummary | JWT | analytics + AI summaries |
| `/api/admin` | admin | JWT (leadership) | user/role admin |
| `/api/requests` | requests | JWT | snack requests |
| `/api/bills` | bills | JWT | bill review/approval |
| `/api/cafeteria` | cafeteria | JWT | menu + ordering |
| `/api/meals` | meals | JWT | meal booking |
| `/api/push` | push | JWT | web-push subscriptions |
| `/api/meal-print` | mealPrint | JWT | token print management |
| `/api/manual-purchases` | manualPurchase | JWT | review no-receipt buys |

Hardening: `helmet`, CORS allow-list, `express-rate-limit` (120 req/min), 1 MB
JSON body cap, `morgan` logging, centralized `errorHandler`.

---

## 6. Feature: Telegram Bot (field interface)

The bot is the single entry point for office staff in the field. One webhook
(`/api/telegram/webhook`) routes every update.

```
Telegram update → webhook (verify ?key=)
   │  respond 200 immediately, dedupe by update_id
   │
   ├─ callback_query? ─────────► handleCallbackQuery()
   │        ├─ st_confirm/st_discard:<id>  → Photo stock-take (§9)
   │        └─ c1/c2/c3_yes/no:<id>        → Purchase confirm steps (§7)
   │
   ├─ text "/register <email>" → link chat ↔ profile
   ├─ text "/restock <item> <qty>" → direct stock add (§8)
   ├─ text "/stocktake" + photo → Photo stock-take (§9)
   │
   └─ otherwise → classify message (AI):
          ├─ manual_no_invoice_purchase → buffer/extract → confirm (§7)
          ├─ invoice_bill / document    → extract bill → auto-add stock (§7)
          ├─ personal_or_irrelevant     → ignore
          └─ unclear                    → ask user to clarify
```

Shared helpers: `downloadTelegramFile`, `uploadFile` (Supabase `bills` bucket),
`sendTelegramMessage`, role lookup via `telegram_user_map` → `profiles`.

---

## 7. Feature: Purchase Capture

### 7.1 Vendor bill (has invoice)
```
Photo/PDF → vision/file AI extract → JSON {vendor, items[]}
   → duplicate check (invoice_number)
   → saveBill(): insert bill_uploads + bill_items
   → auto-sync: upsert products, +inventory, log 'add' txn,
                upsert cafeteria_items (servings via stockHelper)
   → Telegram confirmation + Teams notification
```
Bills from Telegram are auto-verified (only admins upload there).

### 7.2 Manual purchase (no receipt)
```
Text (+optional photo) → AI extract → save manual_purchases (pending_confirmation)
   → 3-step Telegram confirm:  Item → Weight → Price  (Yes / correct-it)
   → finalise: checkAutoApproval + detectDuplicate
        ├─ clear  → applyPurchaseToInventory (stock + finance) → 'synced'
        └─ unclear/dup → 'pending_review' (web review in /manual-purchases)
```

---

## 8. Feature: Quick Restock (`/restock`)

```
/restock <item> <qty>   (facility_manager | leadership)
   → products ilike match
   → perishable safeguard: if Fri/weekend & shelf_life short,
       compute working-days-left consumption → warn about waste
   → inventory.current_stock += qty
   → log 'add' transaction
   → Telegram confirmation (+ warning if applicable)
```

---

## 9. Feature #8: Photo Stock-take (NEW — advisory audit)

**Goal:** reconcile real shelf counts against system stock, with a human in the
loop. AI counts are **never auto-applied**.

```
/stocktake + shelf photo   (office_boy | facility_manager | leadership)
   │
   ▼
handleStockTakeCommand
   ├─ role gate + require photo
   ├─ download largest photo → upload to 'bills' bucket
   ▼
runStockTake(photoUrls):
   1. visionCompletion → JSON [{item_name, count}]   (conservative; [] if unsure)
   2. each item → products ilike match → read inventory.current_stock
   3. build diff [{product_id, name, system, counted, delta}]
   4. INSERT stock_takes (status='pending')           ◄─ survives restart
   ▼
Telegram: diff list  + [✅ Confirm]  [🗑 Discard]
   │
   ├─ Confirm (facility_manager | leadership):
   │     applyStockTake() — atomically claim 'pending'→'confirmed'
   │       for each delta≠0:  inventory.current_stock = counted
   │                          + ONE 'adjust' transaction
   │     (idempotent: double-tap → "already processed")
   │
   └─ Discard: status='discarded', nothing written
```

**Why advisory:** shelf counting is unreliable (stacking/occlusion). Full audit
trail in `stock_takes`; only a confirmed diff mutates inventory.

**Files:** `supabase/migrations/0023_stock_takes.sql` (+ rollback),
`backend/src/lib/stockTake.js`, 4 insertions in `telegramWebhook.js`.

---

## 10. Feature: Scheduled Jobs (`pg_cron` → `/api/cron/*`)

All cron routes are guarded by `CRON_SECRET` (header `x-cron-secret`, or
`?secret=`). Supabase `pg_cron` + `pg_net` fire HTTP POSTs on schedule.

| Job | Schedule (IST) | Route | Action |
|-----|----------------|-------|--------|
| AI reminders | configurable | `/ai-reminders` | per-employee meal reminder push/Teams |
| Meal print | 10:59 working days | `/schedule-meal-print` | generate cabin tokens → `meal_print_jobs` |
| Stock alerts | daily | `/stock-alerts` | low-stock Telegram alert |
| Stock digest | ~09:00 | `/stock-digest` | days-of-cover daily digest |
| **Weekly forecast (#9)** | **Mon 07:00** | `/weekly-forecast` | compute `product_forecasts`, digest to leadership |

### 10.1 Feature #9: Predictive Ordering
```
Mon 07:00 → /weekly-forecast
   computeForecasts(): 6 weeks of 'remove' txns → weekly usage
        fallback: products.daily_usage × 7 when <2 weeks data
   upsert product_forecasts (idempotent per week)
   getActionableForecasts() → Telegram digest to leadership (🔮)
```

---

## 11. Feature: Cafeteria Ordering & Meal Tokens

```
Employee → /request (Cafeteria) → order items (stock_servings aware)
        → /meals → book daily meal (choice or skip)  [Mon–Fri]
   │
   ▼
10:59 cron → schedule-meal-print:
   group bookings by cabin → generate tokens "28MAY-TECH-012"
   stagger print times per cabin (2-min gaps) → meal_print_jobs
   │
   ▼
USB Print Agent (print-agent/) polls meal_print_jobs → prints batches
   │
   ▼
/meal-token-dashboard, /my-meal-box → live status
```
Cabins (print order): Balaji, Rama Krishna, Manisha, Tech, Marketing, Resume.

---

## 12. Feature: Web App Pages (by role)

| Route | Page | Allowed roles |
|-------|------|---------------|
| `/dashboard` | KPIs / overview | FM, finance, leadership |
| `/request` | Cafeteria ordering | all |
| `/available` | Stock view | FM, finance, leadership, office_boy |
| `/meals`, `/meal-history`, `/my-meal-box` | Meal booking | all |
| `/meal-token-dashboard` | Token ops | office_boy, FM, leadership |
| `/orders` | Order history | all |
| `/queue` | Fulfilment queue | office_boy, FM, leadership |
| `/bills`, `/bills/approve` | Bill upload / approval | role-scoped |
| `/daily-update` | Daily stock entry | FM, leadership |
| `/finance` | Finance ledger | finance, leadership |
| `/manual-purchases` | Review no-receipt buys | finance, leadership, FM, office_boy |
| `/admin`, `/reports`, `/connections` | Admin/audit/integrations | leadership |
| `/settings` | Preferences | all |

---

## 13. Environment Variables

**Backend (Render):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_KEY`, `CRON_SECRET`,
`TEAMS_WEBHOOK_URL`, `ALLOWED_ORIGINS`, `NODE_ENV`, `PORT`.

**Frontend (Vercel):** `VITE_API_BASE_URL`, `VITE_BILL_WEBHOOK_URL`, Supabase
anon config.

> ⚠️ `CRON_SECRET` currently equals the placeholder
> `app_wizz_cron_secret_change_in_production` — should be rotated to a strong
> value (and the `pg_cron` job header updated to match).

---

## 14. Known Risks / Tech Debt

| Area | Risk | Mitigation |
|------|------|-----------|
| Cron secret | Default placeholder in prod | Rotate `CRON_SECRET` + update pg_cron job |
| In-memory bot state | `confirmationState`/`messageBuffer` lost on Render restart | Stock-take (#8) persists to DB by design; purchase flow is short-lived |
| AI shelf counting | Unreliable | Advisory-only + human Confirm (#8) |
| Product name matching | `ilike` can mis-match | Confirm step shows names before applying |
| Repo hygiene | USB zips + `check_*.js` debug files untracked | Add to `.gitignore` |
| Deploy coupling | Render branch vs feature branches | Confirm which branch Render auto-deploys |

---

## 15. Deployment Checklist (per feature)

1. Write migration `000X_*.sql` (+ `rollback_*`).
2. Run migration in Supabase SQL editor (`Success. No rows returned` = ok).
3. Enable required extensions if scheduled (`pg_cron`, `pg_net`).
4. Commit + push to the branch Render deploys → auto-redeploy.
5. For cron features: schedule `cron.schedule(...)` with `x-cron-secret`.
6. Smoke test (Telegram command or web page).
7. Rollback path: `git revert <sha>` + `drop table` via `rollback_*`.
