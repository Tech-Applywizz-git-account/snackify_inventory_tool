# Applywizz Pantry — Current Product State
## A line-by-line audit of what is actually in `C:\Users\DELL\Desktop\inventory` today

Last audited from the codebase, not from memory. Roles, files, endpoints, and
schemas listed here are exactly what is on disk.

---

## 1. Top-level architecture

| Layer | Tech | Lives in |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind + framer-motion + lucide-react + recharts | `frontend/` |
| Backend | Node 18+ / Express / Zod / Supabase admin SDK | `backend/` |
| Database | Supabase Postgres (8 migrations, ~25 tables/views/RPCs) | `supabase/migrations/` |
| Auth | Supabase Auth → Microsoft (Azure AD) OAuth, restricted to `@applywizz.ai` | migration 0002 |
| File storage | Supabase Storage bucket `bills` (PDF/JPG bill uploads) | used in billWebhook + telegramWebhook |
| AI | OpenAI: `gpt-4o-mini` for text, `gpt-4o` for vision/PDF | `backend/src/lib/openai.js` |
| External channels | MS Teams (outbound Adaptive Cards), Make.com/Zapier (inbound bills), Telegram bot (inbound bills) | `teams.js`, `billWebhook.js`, `telegramWebhook.js` |
| Deploy | Vercel (frontend hint at `inventory-ashen-theta.vercel.app`) | not yet wired in repo |

**Total surface area:** 65 source files, ~5,200 lines of code excluding lockfiles.

---

## 2. Roles (DB enum `user_role`)

After migration 0005, the enum has 8 values; the running app uses 5 of them and the UI presents 4. This needs cleanup but currently:

| DB value | UI label (Layout.jsx) | Purpose | Sees in nav |
|---|---|---|---|
| `leadership` | **Leadership (Admin)** | Super admin (Ramakrishna) | Dashboard, Daily Update, Finance, Request, Queue, What's Available, Admin, Bills, Verify Bills, Insights, Sync, Settings |
| `facility_manager` | **Office Boy** | The person who runs the pantry AND fulfils tea/coffee requests | Dashboard, Daily Update, Request, Queue, What's Available, Bills, Settings |
| `finance` | **Accounts Team** | Money / verify bills | Dashboard, Finance, Request, What's Available, Bills, Verify Bills, Settings |
| `office_boy` | Office Boy | Same as facility_manager but inventory-blind | Request, Queue, Bills, Settings |
| `staff` | **Employee** | 70 regular employees | Request, Settings |
| `employee`, `admin`, `accounts_team` | _unused alias_ | Reserved by migration 0005 but not wired anywhere yet | — |

**Auto-promotion rule** (migration 0002): `ramakrishna@applywizz.ai` is auto-promoted to `leadership` on first sign-in. New signups default to `staff`. Domain gate rejects anything other than `@applywizz.ai`.

---

## 3. Modules built

### Module A — Inventory & Pantry (the original)
**Goal:** the COO sees pantry stock; the Office Boy updates it daily with prices.

- **34 seed products** across consumables, coffee, washroom, beverages (`supabase/seed/seed_products.sql`)
- **Daily stock update** (`/daily-update`): per-product card with count + unit-price input. Saving:
  - logs `transactions` rows (`add` or `remove` depending on delta sign)
  - updates `products.cost_per_unit` if the price changed (so spending reports reflect current price)
- **Spending report** (`/finance`): stacked bar chart by month × category, INR formatting
- **Dashboard** (`/dashboard`): 6 stat cards (in stock / low / out / expiring soon / expired) + product table + AI Summary card
- **What's Available** (`/available`): operational-only product list, employees can't see it (migration 0008 enforced)

Endpoints: `/api/products`, `/api/inventory`, `/api/inventory/daily-update`, `/api/transactions`, `/api/reports/spending`, `/api/reports/dashboard`.

### Module B — Weekly AI Summary
**Goal:** COO gets a 4-bullet weekly digest of pantry spend, anomalies, and one recommended action.

- `GET /api/reports/ai-summary` builds context (this week vs prev week spend, top consumed, low stock, expiring), calls `gpt-4o-mini`, caches in `ai_summaries` table by `(period_start, period_end)`
- Dashboard widget shows it for leadership + finance; refresh button regenerates
- Graceful "Add OPENAI_API_KEY to backend/.env" message if key missing

### Module C — Microsoft auth + Admin
- `Sign in with Microsoft` button (Login.jsx) → Supabase Azure provider → callback to `/dashboard`
- `/admin` page (leadership only): invite users by email, change roles, see all users with role pills

### Module D — Employee Requests (Office Concierge)
**Goal:** an employee types "Coffee for Cabin 2" and the office boy gets it on Teams.

- `/request` page (every authenticated user): textarea + 7 location chips (Balaji Cabin, RK Cabin, Manisha Cabin, Resume Cabin, Tech Team, Marketing Team, Conference Room)
- Backend (`POST /api/requests`) calls **GPT-4o-mini** with a witty "Applywizz Office Concierge" persona prompt that knows the office culture (9-5 hours, 1-2pm lunch, CCD coffee, bread+PB+J at 4pm)
- GPT returns JSON: `employee_name, request_type, item, quantity, location, priority, instruction, missing_details, follow_up_question`
- If anything's missing → returns `needs_followup: true` with a witty clarifying question
- Else → inserts into `requests` table and fires Teams notification
- `/queue` page (office_boy / facility_manager / leadership): cards filterable by Pending / In progress / Done / All, with Start / Mark done / Cancel buttons

### Module E — Live Tracking (Zomato style)
**Goal:** employee opens `/track/<request-id>` and sees their coffee progress in real time.

- Timeline with 5 stages: Placed → Accepted → Preparing → On the way → Delivered
- Polls `/api/requests` every 5 seconds
- Animated active-stage dot (framer-motion pulse)
- 5-star rating modal appears when status hits `done` and `rating_status === 'pending'`
- Rating posts to `/api/requests/:id/rate` which writes rating+feedback to the request, then async-fires `learnFromRating()` (AI learning)

### Module F — Vendor Bill OCR (3 entry points)
**Goal:** Office Boy receives a Hyperpure / Amazon / Blinkit bill — system extracts items, costs, totals automatically, queues for Admin verification, then auto-syncs to inventory.

Three ways a bill can enter the system:

1. **In-app upload** (`/bills`) → `POST /api/bills/extract` with `file_url`
   - Auth required, office_boy/admin only
   - GPT-4o Vision (for images) or GPT-4o Responses API (for PDFs) extracts structured JSON
   - Duplicate detection by `invoice_number` — returns one of 5 Hindi roast messages if duplicate
   - Saves to `bill_uploads` + `bill_items`, status `Pending Admin Verification`

2. **External webhook** (Make.com / Zapier / WhatsApp / Telegram via Zapier) → `POST /api/bills/webhook?key=app_wizz_secure_782`
   - **NO auth** — gated only by `BILL_WEBHOOK_KEY` query string
   - Accepts multipart `file` OR JSON `file_url`
   - Uploads file to Supabase Storage bucket `bills/power-automate/...`
   - Same extraction + duplicate-detection flow

3. **Telegram bot** (`POST /api/telegram/webhook?key=...`)
   - Full Telegram Bot API integration
   - Downloads file from Telegram, uploads to Supabase Storage, extracts, replies to user in same Telegram thread with success or duplicate-roast message

After Admin verification (`PATCH /api/bills/:id/status` with `verification_status: 'Admin Verified'`), the bill items try to match products in the master list (case-insensitive substring) and:
- bump `inventory.current_stock` by the extracted quantity
- log a `transactions` row with `total_cost` so finance picks it up

### Module G — AI personalisation brain (Modules 21-23 from your spec)
Three migrations (0006, 0007) created the schema; `recommendations.js` and `learning.js` implement the logic:

- **`employee_ai_preferences`** — each employee's preferred drink, sugar/milk/coffee strength, preferred morning/afternoon time, reminder enabled, notification tone (Mom Mode, Friendly, Professional, Funny, Minimal)
- **`employee_preference_scores`** — every drink/snack/tone/time has a 0-100 score per employee, learned from behaviour (+10 for order, +6 for 4-star, -10 for 1-star, etc.)
- **`employee_taste_preferences`** — sugar/strength/milk per item, extracted from rating comments ("too sweet" → sugar = "Less sugar")
- **`employee_notification_behavior`** — sent/clicked/skipped per notification type with engagement score
- **`employee_reminder_policy`** — preferred morning + afternoon times, pause window
- **`employee_daily_learning_logs`** — audit trail of every learning iteration

The flow:
1. Employee rates a request → `POST /api/requests/:id/rate` → `learnFromRating()` runs async
2. Daily, `recommendations.getAIDecision(employeeId)` is callable (no scheduler wired yet) — returns `{send_notification, type, tone, title, message, buttons}`
3. Office boy's Connections page (`/connections`) shows the webhook setup; Preferences page (`/settings`) lets the employee opt in to AI nudges

### Module H — Outbound Microsoft Teams notifications
`backend/src/lib/teams.js` posts an Adaptive Card to `TEAMS_WEBHOOK_URL` every time a new request is created. The card has: title (with priority color), facts (request id, employee, qty, location, priority, status), instruction, timestamp, and an "Open in App to Accept" button linking to `/queue`.

### Module I — Audit logs + Insights + Sync page
- `audit_logs`, `teams_activity_logs`, `notification_logs` tables exist (migration 0005)
- `/reports` page (leadership only) — wired in routing as `AuditLogPage`
- `/connections` page (leadership only) — shows the bill webhook URL + Make/Zapier instructions for WhatsApp/Telegram

---

## 4. Database tables that exist now

From migrations 0001 through 0008, public schema:

**Core inventory**
`products`, `inventory`, `transactions`, `v_inventory_status`, `v_monthly_spending`

**Auth + Admin**
`profiles`, `current_user_role()` function, `admin_set_user_role()` RPC, `handle_new_user()` trigger

**AI summaries**
`ai_summaries`

**Requests (Office Concierge)**
`requests` (with `live_status, accepted_at, started_at, on_the_way_at, cancelled_at, issue_reason, rating_status, rating, feedback`), `v_request_queue`

**Bills**
`bill_uploads`, `bill_items`

**Operational logs**
`audit_logs`, `teams_activity_logs`, `notification_logs`, `service_ratings`

**Employee preferences (basic + AI)**
`employee_preferences`, `employee_ai_preferences`, `employee_notification_behavior`, `ai_recommendation_logs`, `item_availability`, `office_schedule_settings`

**Self-learning AI**
`employee_preference_scores`, `employee_taste_preferences`, `employee_reminder_policy`, `employee_daily_learning_logs`

**~25 tables total.** RLS is enabled on all of them with role-aware policies.

---

## 5. Frontend pages (with route + role)

| Route | Component | Role | Purpose |
|---|---|---|---|
| `/login` | Login.jsx | public | Microsoft OAuth button |
| `/dashboard` | Dashboard.jsx | facility_manager, finance, leadership | inventory snapshot + AI summary |
| `/daily-update` | DailyUpdate.jsx | facility_manager, leadership | morning stock + price update |
| `/finance` | Finance.jsx | finance, leadership | spending charts |
| `/available` | StaffView.jsx | operational roles | what's in pantry |
| `/request` | RequestSubmit.jsx | all | submit service request |
| `/track/:id` | LiveTracking.jsx | all | Zomato-style live tracking + rating |
| `/queue` | RequestQueue.jsx | office_boy, facility_manager, leadership | work the queue |
| `/bills` | BillUpload.jsx | office_boy, facility_manager, leadership, finance | upload + view bills |
| `/bills/approve` | BillApproval.jsx | leadership, finance | verify/approve bills, sync to inventory |
| `/admin` | Admin.jsx | leadership | invite users, change roles |
| `/reports` | AuditLog.jsx | leadership | audit trail viewer |
| `/connections` | Connections.jsx | leadership | external integration setup (Teams/Telegram/Make) |
| `/settings` | Preferences.jsx | all | personal AI tone, reminders, opt-ins |

---

## 6. Backend endpoints

```
GET  /health

# Public webhooks (key-gated)
POST /api/bills/webhook?key=BILL_WEBHOOK_KEY      # Make.com / Zapier / WhatsApp bills
POST /api/telegram/webhook?key=TELEGRAM_WEBHOOK_KEY # Telegram bot

# Everything below requires Authorization: Bearer <supabase-jwt>
GET    /api/products
POST   /api/products              (facility_manager, leadership)
GET    /api/products/:id
PATCH  /api/products/:id          (facility_manager, leadership)
DELETE /api/products/:id          (soft delete; facility_manager, leadership)

GET    /api/inventory
GET    /api/inventory/alerts
PATCH  /api/inventory/:productId  (facility_manager, leadership)
POST   /api/inventory/daily-update (facility_manager, leadership)

GET    /api/transactions          (facility_manager, finance, leadership)
POST   /api/transactions          (facility_manager, leadership)

GET    /api/reports/spending      (finance, leadership)
GET    /api/reports/dashboard
GET    /api/reports/ai-summary[?refresh=true]    (leadership, finance)
GET    /api/reports/ai-summary/history           (leadership, finance)

GET    /api/admin/users           (leadership)
PATCH  /api/admin/users/:id/role  (leadership)
POST   /api/admin/users/invite    (leadership)

POST   /api/requests
GET    /api/requests
PATCH  /api/requests/:id/status   (office_boy, facility_manager, leadership)
POST   /api/requests/:id/rate

POST   /api/bills/extract         (office_boy, admin)
PATCH  /api/bills/:id/status      (admin, leadership, finance)
GET    /api/bills
```

---

## 7. Environment variables

`backend/.env`:
```
PORT=4000
NODE_ENV=development
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ALLOWED_ORIGINS=http://localhost:5173
APP_PUBLIC_URL=http://localhost:5173
OPENAI_API_KEY=...
TEAMS_WEBHOOK_URL=...           # outbound (notifies office boy of new requests)
BILL_WEBHOOK_KEY=app_wizz_secure_782       # inbound (Make.com / Zapier)
TELEGRAM_BOT_TOKEN=...                     # if Telegram inbound is used
TELEGRAM_WEBHOOK_KEY=app_wizz_telegram_secret
```

`frontend/.env.local`:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_API_BASE_URL=http://localhost:4000
VITE_BILL_WEBHOOK_URL=https://your-app/api/bills/webhook?key=app_wizz_secure_782
```

---

## 8. Where the Microsoft Teams integration actually stands today

This is the part to read carefully. There are **two completely different Teams integrations** in scope, and they got tangled:

### Direction 1 — OUTBOUND (app → Teams)
**Goal:** when an employee submits a request, the office boy sees a card pop up in a Teams channel.

**How it works in our code:** `backend/src/lib/teams.js` POSTs an Adaptive Card to `TEAMS_WEBHOOK_URL`. That URL comes from a Teams **Workflows** template called `"Post to a channel when a webhook request is received"` (the modern replacement for the retired Office 365 Connector / Incoming Webhook).

**To set up:**
1. Teams → `#office-requests` channel → ··· menu → Workflows
2. Search "Post to a channel when a webhook request is received"
3. Pick the team and channel → create → copy the URL it gives you
4. Paste it in `backend/.env` as `TEAMS_WEBHOOK_URL=...`
5. Restart backend

**Status:** code is ready. Whether it works for you depends only on having the URL in `.env`.

### Direction 2 — INBOUND (Teams → app)
**Goal:** Office Boy drops a Hyperpure PDF into a Teams channel, and the app picks it up automatically.

**How it works in our code:** the `Office_Boy_Sync` flow you screenshotted is a Power Automate flow that:
- Triggers on **"When a new channel message is added"**
- Checks if the message has an attachment
- If yes, should POST the attachment to `POST /api/bills/webhook?key=app_wizz_secure_782`
- If no, ignores

**The reason it looks "screwed":** the screenshot shows the flow has only two steps (`When a new channel message is added` and `Check for Attachment` with 2 cases), and **no HTTP action inside either case**. So even if Office Boy uploads a bill to Teams, the flow does nothing.

**To fix this Power Automate flow:**

1. Open the `Office_Boy_Sync` flow in Power Automate (`make.powerautomate.com`)
2. Click **Edit**
3. Open the **"Check for Attachment"** condition
4. In the **"If yes"** branch:
   - Add an action → search **HTTP**
   - Method: `POST`
   - URI: `https://YOUR-DEPLOYED-BACKEND/api/bills/webhook?key=app_wizz_secure_782`
     (use your Vercel/Render URL, NOT localhost — Power Automate runs in Microsoft's cloud and can't reach localhost)
   - Headers: `Content-Type: multipart/form-data` (or pass the file URL as JSON)
   - Body: attach the message attachment via the dynamic content picker
5. In the **"If no"** branch: leave empty (or add a "do nothing" terminate)
6. Click **Save**, then **Test** with a real bill upload

**Important constraint:** until the backend is deployed to a public URL, the inbound flow can't reach it. For local testing use `ngrok http 4000` and put the ngrok URL in the HTTP action.

**Simpler alternative:** skip the Teams inbound entirely and use the Telegram bot — `telegramWebhook.js` already works end-to-end. Office Boy DMs the bill to the bot, gets a reply.

---

## 9. What's NOT built yet (gaps in your full spec)

From your "Office Facility Manager Assistant" requirements:

- ❌ Teams Adaptive Card **buttons** that call back into our API (Accept / Preparing / On the way / Completed buttons inside Teams). Today the card has only an "Open in App" button. Two-way Teams requires a registered Bot Framework bot (signed HMAC verification etc.) — 2-3 days of work.
- ❌ Browser **push notifications** (FCM / Web Push). Today there are only in-app toasts + Teams cards.
- ❌ **Tea/coffee reminder scheduler** (the 2-hour cadence). The `recommendations.getAIDecision()` function exists; nothing calls it on a schedule. Needs Supabase `pg_cron` or a backend cron.
- ❌ Accounts Team flow as a distinct user-facing path. The `accounts_team` enum value exists; current code treats `finance` as that role.
- ❌ Lottie animations on the live-tracking screen. We use framer-motion pulses but no actual coffee-cup-being-poured Lottie. Easy to add (`lottie-react` + a free coffee animation JSON).
- ❌ "Cannot complete" reason capture and Admin escalation. Status enum supports `cancelled` but there's no reason form.
- ❌ Full reports beyond the AI summary: per-office-boy avg completion time, daily request count, low-rating report, etc.
- ❌ Office Boy mobile app. The current web UI is responsive but isn't installable as a PWA.

---

## 10. Migration order to apply on a fresh Supabase project

Run these in the Supabase SQL editor in order:

1. `0001_init_schema.sql` — products, inventory, transactions, profiles, RLS
2. `0002_auth_policy.sql` — `@applywizz.ai` domain gate + ramakrishna auto-promote
3. `0003_ai_summaries.sql` — weekly summary cache
4. `0004_requests.sql` — office_boy role + requests + v_request_queue
5. `seed_products.sql` — 34 starter products
6. `0005_facility_management_core.sql` — bills, ratings, audit logs, notifications, request live_status columns
7. `0006_advanced_ai_hospitality.sql` — AI preference brain
8. `0007_self_learning_ai_brain.sql` — scoring system
9. `0008_staff_inventory_lockdown.sql` — block employees from seeing inventory

Also: create a Supabase Storage bucket named **`bills`** (public read OK; you can lock it down later). The `billWebhook.js` and `telegramWebhook.js` routes write into it.

---

## 11. Recommended next 3 steps

1. **Fix the inbound Power Automate flow** — add the HTTP POST action inside the "If yes" branch of `Check for Attachment` so Office Boy can drop PDFs into Teams and have them auto-processed.
2. **Deploy the backend to Vercel/Render/Fly** so Power Automate can reach `/api/bills/webhook` over the public internet. Set every env var listed in §7 on the host.
3. **Wire the scheduler for the AI reminder brain** — Supabase pg_cron job that calls `recommendations.getAIDecision()` for every opted-in employee every 30 minutes during office hours, sends the message via Teams/Telegram if `send_notification: true`.

After that: two-way Teams buttons (Bot Framework), Lottie animations on tracking, and Accounts Team verification flow.
