<!--
  READ-ONLY REFERENCE DOCUMENT — do not edit by hand as part of feature work.
  Purpose: explain what the ApplyWizz Snackify app does, broken down by user role,
  so a fresher team member can understand the whole system at a glance.
  Last updated: 2026-06-03 (after Feature #9 Predictive Ordering UI was added).
-->

# ApplyWizz Snackify — Features by Role

This is a plain-English map of **who can do what** in the app. It is written for
new team members. It does not contain code — just behaviour, screens, and rules.

---

## 1. The Roles

The app has **5 roles**. Your role is stored on your `profiles.role` and decides
which pages and buttons you see.

| Role (in code)     | Friendly name   | Think of them as…                         |
|--------------------|-----------------|-------------------------------------------|
| `leadership`       | **Admin**       | The boss. Sees everything, approves spend.|
| `facility_manager` | Facility Manager| Runs the pantry/cafeteria day to day.     |
| `office_boy`       | Office Boy      | Fulfils orders, prints meal tokens.       |
| `finance`          | Accounts        | Approves bills, watches spending.         |
| `staff`            | Applywizzian    | Normal employee. Orders snacks/meals.     |

**Where each role lands after login** (their "home page"):

| Role             | Home page    |
|------------------|--------------|
| Admin            | `/dashboard` |
| Accounts         | `/dashboard` |
| Facility Manager | `/dashboard` |
| Office Boy       | `/queue`     |
| Applywizzian     | `/request`   |

---

## 2. Login & Security (everyone)

- Login is by **email + Microsoft Authenticator (TOTP)**. Two-factor (MFA/AAL2)
  is **required** — if you only pass the password step, you are sent back to
  finish the authenticator step.
- First-time users go through a one-time **Onboarding** (cafeteria preferences:
  cabin, reminders, etc.) before they can use the app.
- The app auto-locks after a period of inactivity (`InactivityLock`).

---

## 3. Page-by-Page Access Map

A ✅ means that role can open the page. Blank means "access denied".

| Page / Route             | Admin | Facility Mgr | Office Boy | Accounts | Applywizzian |
|--------------------------|:-----:|:------------:|:----------:|:--------:|:------------:|
| Dashboard `/dashboard`   |  ✅   |     ✅       |            |   ✅     |              |
| Available stock `/available` | ✅ |    ✅       |    ✅      |   ✅     |              |
| Cafeteria / order `/request` | ✅ |    ✅       |    ✅      |   ✅     |     ✅       |
| Meals booking `/meals`   |  ✅   |     ✅       |    ✅      |   ✅     |     ✅       |
| Meal history `/meal-history` | ✅ |   ✅        |    ✅      |   ✅     |     ✅       |
| My meal box `/my-meal-box` | ✅  |    ✅       |    ✅      |   ✅     |     ✅       |
| Meal token dashboard `/meal-token-dashboard` | ✅ | ✅ | ✅ |     |          |
| Order history `/orders`  |  ✅   |     ✅       |    ✅      |   ✅     |     ✅       |
| Order queue `/queue`     |  ✅   |     ✅       |    ✅      |          |              |
| Live tracking `/track/:id` | ✅  |    ✅       |    ✅      |   ✅     |     ✅       |
| Bills upload `/bills`    |  ✅   |     ✅       |    ✅      |   ✅     |              |
| Bills approval `/bills/approve` | ✅ |          |            |   ✅     |              |
| Daily stock update `/daily-update` | ✅ | ✅     |            |          |              |
| Finance `/finance`       |  ✅   |              |            |   ✅     |              |
| Manual purchases `/manual-purchases` | ✅ | ✅   |    ✅      |   ✅     |              |
| Admin · Users `/admin`   |  ✅   |              |            |          |              |
| Audit log / Reports `/reports` | ✅ |           |            |          |              |
| Connections `/connections` | ✅  |             |            |          |              |
| Settings `/settings`     |  ✅   |     ✅       |    ✅      |   ✅     |     ✅       |

---

## 4. What Each Role Can Do

### 4.1 Applywizzian (staff) — the everyday employee
- **Order snacks/drinks** from the Cafeteria page (`/request`).
- **Book daily meals** (`/meals`) and pick veg/non-veg/skip; see their **meal box**
  and **token** for the day (`/my-meal-box`).
- **Track an order live** (`/track/:id`) and see their **order history** (`/orders`).
- Set personal **preferences** (`/settings`): cabin, reminder on/off, preferred name.
- Cannot see stock levels, money, or other people's data.

### 4.2 Office Boy — the fulfiller
- Works mainly from the **Order Queue** (`/queue`) — their home page.
- **Sees available stock** (`/available`) so they know what they can hand out.
- **Meal token dashboard** (`/meal-token-dashboard`): triggers/reprints cabin
  print batches, sees bookings grouped by cabin.
- Can **upload bills** (`/bills`) and submit **manual purchases** (no-invoice buys
  made on the spot, often via Telegram).
- Can apply for **leave** (handled in the Staff view section).

### 4.3 Facility Manager — runs the pantry
- Everything Office Boy can do, **plus**:
- **Dashboard** (`/dashboard`): live IST clock, stock health, alerts.
- **Daily stock update** (`/daily-update`): record today's counts and prices,
  which feed the transaction history.
- Manage **products** and **inventory** (add/adjust stock, set thresholds,
  expiry dates, and the optional `daily_usage` estimate per product).
- Approve/reject/clarify **manual purchases**.
- **Sees forecasts** (read-only) — see Feature #9 below.

### 4.4 Accounts (finance) — the money watcher
- **Dashboard** + **Finance** page (`/finance`): spending reports, monthly expenses.
- **Approve or reject bills** (`/bills/approve`).
- Review **manual purchases**.
- Does not manage stock counts or users.

### 4.5 Admin (leadership) — full control
- Can open **every page**.
- **Admin · Users** (`/admin`): invite team members, assign/change roles, set
  preferred names. (This is also where the **Predictive Ordering** panel lives —
  see below.)
- **Audit log / Reports** (`/reports`) and **Connections** (`/connections`).
- Approves bills, manages everything Facility Manager and Accounts can.

---

## 5. Behind-the-Scenes Systems (no single screen)

These run automatically and support the roles above.

- **Telegram bot**: office boy / facility manager can submit manual purchases and
  photo stock-takes; leadership receives digests and alerts.
- **Scheduled jobs (pg_cron → backend)**:
  - **AI reminders**: nudge opted-in employees to book meals.
  - **Meal print scheduler**: at ~10:59 AM IST on working days, generates meal
    tokens per cabin and queues print jobs (printed with staggered 2-min gaps).
  - **Stock alerts & daily digest**: warns leadership about low stock / days-of-cover.
  - **Weekly forecast** (Mondays): the predictive ordering engine — see below.
- **Days-of-cover badges**: products with a `daily_usage` value show how many days
  of stock remain and whether to `order_soon` / `order_now` / `waste_risk`.

---

## 6. Feature #9 — Predictive Ordering (NEW)

**Goal:** instead of relying only on the static `daily_usage` number a manager
types in, the app looks at **real transaction history** to predict next week's
need for each item.

### How it works (plain English)
1. Every Monday (and on demand), the engine reads the last **6 weeks** of
   "remove" transactions (stock that was actually used).
2. It groups usage into weekly buckets and computes a **weighted average**
   (recent 2 weeks count 60%, older weeks 40%).
3. If an item has **at least 2 weeks** of real history → prediction basis is
   **"history"** (shown as a green badge).
4. If there isn't enough history yet → it falls back to the manager's
   `daily_usage × 5 working days` → basis **"estimate"** (amber badge).
5. **Suggested order = predicted need − current stock**, never below 0, and
   capped by `max_safe_order` so we don't over-buy perishables.
6. Results are saved to `product_forecasts` and exposed via the
   `v_latest_forecasts` view. **It is advisory only — nothing is auto-ordered.**

### Who sees / uses it

| Role             | What they get with Predictive Ordering                          |
|------------------|-----------------------------------------------------------------|
| **Admin**        | Full **ForecastPanel** on the `/admin` page: table of every item with avg/week, predicted next week, current stock, suggested order, and a basis badge. Has a **"Run forecast now"** button to recompute on demand. |
| **Facility Mgr** | Can **read** forecasts via the API (`GET /api/forecasts`). (UI panel currently lives on the Admin page, which is leadership-only — see "Notes".) |
| **Office Boy**   | No direct access. Benefits indirectly: better-stocked pantry. |
| **Accounts**     | No direct access. Spending stays predictable.                 |
| **Applywizzian** | No access. Transparent to them.                               |
| **Leadership (Telegram)** | Gets an automatic **Monday digest** of suggested orders for items that need ordering. |

### The API endpoints
- `GET /api/forecasts` — read the latest forecast per product.
  Allowed roles: **facility_manager, leadership**.
- `POST /api/forecasts/run` — recompute immediately.
  Allowed role: **leadership only** (keeps the cron secret on the server).
- `POST /api/cron/weekly-forecast` — the scheduled Monday job (machine-to-machine,
  protected by `CRON_SECRET`).

### Reading the ForecastPanel table

| Column           | Meaning                                                       |
|------------------|--------------------------------------------------------------|
| Product          | Item name.                                                   |
| Avg/week         | Average weekly usage over the history window.                |
| Predicted next   | The weighted prediction for the coming week.                |
| In stock         | Current stock on hand right now.                             |
| Suggested order  | How much to order (predicted − stock, floored at 0, capped). |
| Based on         | **history** (green) = real data · **estimate** (amber) = fallback, plus "Nw data" = how many weeks of history existed. |

### Notes / future improvements
- The forecast figures are **suggestions**, not auto-orders. A human confirms.
- The panel currently sits on the **Admin (leadership-only)** page. The API already
  allows Facility Managers to read forecasts, so a future small change could add the
  same panel to the Facility Manager's Dashboard if desired.
- No database migration was needed for the UI — the table/view (`0022`) already
  shipped with the engine.

---

## 7. Quick Glossary

- **IST**: Asia/Kolkata time (UTC+5:30). All scheduling is in IST.
- **Transaction (type=remove)**: a record that stock was used/handed out. This is
  the raw data the forecast learns from.
- **daily_usage**: a manual per-product estimate of units used per day. Used for
  days-of-cover badges and as the forecast fallback.
- **days_of_cover**: how many days current stock will last at the usage rate.
- **Advisory**: shown to a human to decide on; never acted on automatically.
