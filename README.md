# Applyways Office Pantry — Inventory Management

Phase 1 MVP from the PRD. React + Vite + Tailwind frontend, Node/Express API, Supabase (Postgres) for data and auth.

---

## What changed in the last commit — `feat: Product Conversion Master + Safe AI Fallback (migration 0024)`

This was the largest single feature addition to the project. Everything below was designed, implemented, tested, and committed in one session.

---

### Problem it solved

Before this commit, when an office boy uploaded a vendor invoice (HyperPure, JioMart, BigBasket, etc.), the backend used a hardcoded JavaScript mapper (`stockHelper.js`) to convert raw purchase quantities into employee-facing stock. This caused three critical bugs:

1. **Wrong unit conversion** — Coffee Beans were being treated as cups (1 kg → ~140 cups hardcoded), making employee stock counts meaningless once storage units changed.
2. **Auto-creation of cafeteria items** — The system would silently create new employee-facing menu items from any invoice line, including internal supplies, equipment, rental charges, and ingredients.
3. **Double-apply risk** — Approving the same invoice twice would double-count stock. There was no database-level guard against this.

---

### What was built

#### 1. Database — `supabase/migrations/0024_product_conversion_master.sql`

Five schema changes in one migration, all safe to roll back:

**`product_conversion_master` table**
The authoritative source of truth for how every vendor product maps to stock.

| Column | Purpose |
|--------|---------|
| `canonical_name` | Standard product name (e.g. "Assam Tea") |
| `aliases[]` | GIN-indexed text array — vendor spellings that map to this product ("assam chai", "assam tea bags", "classic assam tea") |
| `classification` | Enum: `direct_menu_stock`, `ingredient_or_dependency`, `recipe_stock`, `internal_supply`, `equipment_asset`, `finance_expense`, `unknown_pending_review` |
| `purchase_unit` | Unit on the invoice (box, pack, kg, bottle…) |
| `storage_unit` | Unit stored internally (cup, gram, slice, liter…) |
| `units_per_purchase_unit` | The conversion factor (e.g. 100 cups per box) |
| `cafeteria_item_name` | Exact `item_name` value in `cafeteria_items` to update |
| `visible_to_employees` | Whether this product appears in the employee cafeteria UI |
| `employee_orderable` | Whether employees can place orders for it |
| `recipe_required` | True for Coffee Beans etc. — cups can only be calculated after an approved grams-per-cup recipe exists |
| `approval_status` | `approved` / `pending` / `rejected` — AI suggestions start as `pending` |

**18 approved seed rules** included in the migration:

| Product | Conversion | Employee visible | Orderable |
|---------|-----------|-----------------|-----------|
| Assam Tea | 1 box = 100 cups | ✅ | ✅ |
| Elaichi Tea | 1 box = 100 cups | ✅ | ✅ |
| Ginger Tea | 1 box = 100 cups | ✅ | ✅ |
| Lemon Sachets | 1 pack = 20 cups → Lemon Tea | ✅ | ✅ |
| Hot Chocolate | 1 pack = 20 cups | ✅ | ✅ |
| Badam Pista Mix | 1 pack = 25 cups | ✅ | ✅ |
| Coffee Beans | 1 kg = 1,000 grams (recipe_stock) | ❌ | ❌ |
| Stirrers | internal_supply, no conversion | ❌ | ❌ |
| Bread | 1 pack = 16 slices | ✅ | ❌ |
| Atta Bread | 1 pack = 16 slices | ✅ | ❌ |
| Peanut Butter | 750g jar ≈ 37 servings | ✅ | ✅ |
| Mix Fruit Jam | Jar → servings (qty varies) | ✅ | ✅ |
| Pineapple Jam | Jar → servings (qty varies) | ✅ | ✅ |
| Milk | ingredient/dependency, not orderable | ❌ | ❌ |
| Sugar Sachets | internal_supply | ❌ | ❌ |
| Delivery Charges | finance_expense, no stock | ❌ | ❌ |
| Rental / Service | finance_expense, no stock | ❌ | ❌ |
| Water Bottle | 1 bottle = 1 serving | ✅ | ✅ |

**`bill_items` — new columns**

| Column | Values |
|--------|--------|
| `conversion_master_id` | FK → master record used |
| `normalized_item_name` | Lowercase trimmed invoice name |
| `converted_quantity` | Calculated servings (qty × units_per_purchase_unit) |
| `conversion_status` | `master_match` / `ai_suggestion` / `pending_review` / `manual_linked` / `applied` / `no_stock` |
| `ai_suggestion` | JSON blob from GPT-4o-mini (when no master match found) |
| `conversion_error` | Any error text |
| `processed_at` | When conversion ran |

**`bill_uploads` — new columns**

| Column | Values |
|--------|--------|
| `inventory_sync_status` | `not_started` / `partial` / `complete` / `blocked` |
| `inventory_synced_at` | Timestamp of last successful sync |

**`bill_stock_applications` — new table (immutable ledger)**

Records every stock application permanently. The `UNIQUE` constraint on `bill_item_id` is the database-level guard that makes double-apply physically impossible — even concurrent requests cannot apply the same invoice line twice.

**`cafeteria_recipe_ingredients` — new table**

Stores approved grams-per-serving recipes (e.g. 9g coffee per espresso). Coffee-based virtual drinks remain unavailable until at least one recipe is approved here.

**`cafeteria_items.visible_to_employees` — new column**

Defaults `true` for all existing rows (safe for backwards compatibility). New items created via invoice sync respect the master's `visible_to_employees` flag — finance charges, equipment, and internal supplies are never exposed to employees.

**`apply_bill_item_stock()` — Postgres function**

Atomic transactional function that:
1. Checks `bill_stock_applications` for the item — raises `ALREADY_APPLIED` if found (idempotency)
2. Inserts into `bill_stock_applications` (the ledger record)
3. Updates `cafeteria_items.stock_today` and `stock_servings` for the linked item
4. Marks `bill_items.conversion_status = 'applied'`

All four steps happen in one transaction — either all succeed or none do.

**Rollback migration** — `supabase/migrations/rollback_0024_product_conversion_master.sql`

Safe rollback that removes all new tables and columns but preserves every existing `bill_uploads`, `bill_items`, `products`, `inventory`, `transactions`, and `cafeteria_items` record.

---

#### 2. Backend — `backend/src/lib/productConversion.js` (new file)

The core conversion engine. No Express, no side effects — pure async functions:

**`normalizeName(name)`**
Lowercase, trim, collapse whitespace. "  Assam  Tea  " → "assam tea".

**`processInvoiceItems(rawItems)`**
Main entry point. For each invoice line:
1. Normalize the name
2. Query `product_conversion_master` for an alias match (GIN index — fast even with 200+ rules)
3. If matched → compute `converted_quantity = qty × units_per_purchase_unit`, set `conversion_status = 'master_match'` (or `'no_stock'` for finance/equipment/supply items)
4. If unmatched → collect for AI batch

After the loop, all unmatched items are sent to GPT-4o-mini in **one call** (not one per item). The AI returns structured JSON. Every AI suggestion is forcibly overridden with `employee_orderable: false`, `visible_to_employees: false`, `status: 'pending_review'` — the AI cannot make any item live without admin approval.

If the AI call fails entirely, all unmatched items silently remain `pending_review`. Invoice upload never fails because of AI.

**`saveConversions(itemRows, conversions)`**
Updates each `bill_items` row in parallel with its conversion result.

---

#### 3. Backend — `backend/src/lib/openai.js` (modified)

Added optional `responseFormat` parameter to `chatCompletion`. When set to `'json_object'`, passes `response_format: { type: 'json_object' }` to the OpenAI API. All existing callers unchanged (parameter is optional).

---

#### 4. Backend — `backend/src/routes/bills.js` (rewritten)

**`POST /api/bills/extract`** (office_boy, admin)
- No change to the AI extraction call or duplicate check
- After saving `bill_items`, now calls `processInvoiceItems` + `saveConversions` as a non-blocking background step. Invoice upload responds immediately; conversion results are saved async.

**`PATCH /api/bills/:id/status`** (admin, leadership, finance)
- Finance can still update `approval_status` (payment approval) freely
- When `verification_status = 'Admin Verified'` and role is not finance:
  - **Blocks** if any bill item has `conversion_status = 'pending_review'` — returns `409` with a list of the unresolved items
  - For each `master_match` or `manual_linked` item, calls the `apply_bill_item_stock` Postgres RPC
  - Also updates the `inventory` table and logs a `transactions` record (for the admin stock-tracking dashboard)
  - Marks `bill_uploads.inventory_sync_status = 'complete'`

**Three new admin endpoints** (leadership only):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/bills/conversion-master` | List all active approved master rules |
| `POST` | `/api/bills/conversion-master` | Create and immediately approve a new rule |
| `PATCH` | `/api/bills/items/:id/conversion` | Link a bill item to a master, change its classification, or override converted_quantity |

---

#### 5. Backend — `backend/src/routes/billWebhook.js` (modified)

The Power Automate webhook path now runs the same `processInvoiceItems` + `saveConversions` flow after saving items. Both upload paths (manual upload and Power Automate webhook) produce identical conversion data.

---

#### 6. Backend — `backend/src/routes/cafeteria.js` (modified)

`GET /api/cafeteria/items` now filters `.neq('visible_to_employees', false)` in addition to `.eq('available', true)`.

Effect: Finance expense items, equipment assets, internal supplies, and Coffee Beans (recipe_stock) are never returned to the employee cafeteria UI. The server enforces this — the frontend cannot accidentally expose them.

---

#### 7. Backend — `backend/src/routes/telegramWebhook.js` (modified)

The Telegram-submitted manual purchase approval flow previously also used `mapProductToCafeteria`. Replaced with a direct master lookup:
- If a master record is found for the item and it is `direct_menu_stock` with a `cafeteria_item_name` → updates `cafeteria_items.stock_today` and `stock_servings` using the master's conversion factor
- If no master record → **silently skips** cafeteria update (item needs to be added to the master first)
- Never auto-creates cafeteria items from any path

---

#### 8. Backend — `backend/src/lib/stockHelper.js` (deleted)

200-line hardcoded mapper. Removed after confirming zero remaining imports across the entire codebase.

---

#### 9. Frontend — `frontend/src/lib/api.js` (modified)

Three new API calls added:

```js
api.listConversionMaster()                    // GET /api/bills/conversion-master
api.createConversionMaster(body)              // POST /api/bills/conversion-master
api.updateBillItemConversion(id, body)        // PATCH /api/bills/items/:id/conversion
```

---

#### 10. Frontend — `frontend/src/pages/Cafeteria.jsx` (modified)

**Low-stock badge** (line ~469):
- Before: `item.stock_servings ?? item.stock_today` — would show "1 box remaining" to employees
- After: `item.stock_servings` only — boxes, packs, and kilograms never surface to employees

**Milk availability** (inside `enrichItemsWithVirtualDrinks`):
- Before: `milkRow.stock_servings ?? milkRow.stock_today ?? null` — raw purchase stock (liters) could mark milk as "in stock" incorrectly
- After: `milkRow.stock_servings ?? null` — only converted servings count

**`selfInStock` check** (inside `enrichItemsWithVirtualDrinks`):
- Before: `(i.stock_servings ?? i.stock_today ?? null) === null || (i.stock_servings ?? i.stock_today ?? 0) > 0`
- After: `i.stock_servings === null || i.stock_servings === undefined || i.stock_servings > 0`

**Coffee virtual drinks (Espresso, Americano, Cappuccino, Latte, Cappuccino)**:
Coffee Beans now have `visible_to_employees = false` in the master. The `GET /api/cafeteria/items` endpoint filters them out. `enrichItemsWithVirtualDrinks` never finds a `coffeeBeansRow`, so all virtual coffee machine drinks are hidden. They will reappear once an admin creates an approved `cafeteria_recipe_ingredients` entry (grams-per-cup) and the Coffee Beans item gets a `cafeteria_item_name` link.

---

#### 11. Tests — `backend/tests/productConversion.test.js` (new file)

18 unit tests, all passing (`node --test`). No test framework dependency — uses Node.js built-in `node:test` and `node:assert`.

**Conversion math tests:**
- 10 Assam Tea boxes → 1,000 cups ✅
- 2 Elaichi Tea boxes → 200 cups ✅
- 2 Ginger Tea boxes → 200 cups ✅
- 4 Lemon Sachets packs → 80 cups ✅
- 2 Hot Chocolate packs → 40 cups ✅
- 2 Badam Pista Mix packs → 50 cups ✅
- 5 kg Coffee Beans → 5,000 grams, not orderable, not visible ✅
- Stirrers → `no_stock` (internal_supply) ✅
- Delivery Charges → `no_stock` (finance_expense) ✅

**Edge case tests:**
- Unknown item → `pending_review`, no converted_quantity ✅
- `normalizeName` handles extra whitespace and casing ✅
- Alias "Badam Sachets" resolves to canonical "Badam Pista Mix" ✅
- Alias "Adrak Tea" resolves to canonical "Ginger Tea" ✅
- Coffee Beans master record cannot be overridden to orderable ✅

**AI safety tests:**
- AI cannot set `employee_orderable = true` ✅
- AI cannot set `visible_to_employees = true` ✅
- AI suggestion always has `status = 'pending_review'` ✅

**Idempotency test:**
- Same `bill_item_id` cannot be applied twice ✅

---

### How the new invoice flow works end-to-end

```
Office Boy uploads invoice
        ↓
AI extracts items (existing Vision/PDF call — unchanged)
        ↓
Duplicate invoice check (existing app-level check)
        ↓
bill_uploads + bill_items saved to DB
        ↓
processInvoiceItems() runs (async, non-blocking)
        ├── Alias match found? → conversion_status = 'master_match', converted_quantity calculated
        ├── No match → AI batch call → conversion_status = 'ai_suggestion' (non-orderable, hidden)
        └── AI fails → conversion_status = 'pending_review'
        ↓
Upload response sent to Office Boy ✅
        ↓
Leadership reviews BillApproval page
        ├── master_match items → show raw + converted qty, classification, cafeteria mapping
        ├── ai_suggestion items → show AI reasoning, allow edit/approve/link/classify/reject
        └── pending_review items → must resolve before stock can be applied
        ↓
Leadership clicks Approve Bill
        ├── Any pending_review items? → 409 blocked, must resolve first
        └── All resolved? → apply_bill_item_stock() called per eligible item (atomic, idempotent)
                ↓
                bill_stock_applications record created (UNIQUE → cannot double-apply)
                cafeteria_items.stock_servings += converted_quantity
                cafeteria_items.stock_today += raw_quantity
                bill_items.conversion_status = 'applied'
```

---

### Files changed summary

| File | Change |
|------|--------|
| `supabase/migrations/0024_product_conversion_master.sql` | **New** — 5 schema changes + 18 seed rules + Postgres function |
| `supabase/migrations/rollback_0024_product_conversion_master.sql` | **New** — safe rollback |
| `backend/src/lib/productConversion.js` | **New** — alias matching engine + AI fallback |
| `backend/src/lib/openai.js` | Modified — optional `responseFormat` param |
| `backend/src/routes/bills.js` | Modified — conversion after extract; block on pending; 3 new admin endpoints |
| `backend/src/routes/billWebhook.js` | Modified — runs same conversion after webhook save |
| `backend/src/routes/cafeteria.js` | Modified — `visible_to_employees` filter |
| `backend/src/routes/telegramWebhook.js` | Modified — master lookup replaces stockHelper |
| `backend/src/lib/stockHelper.js` | **Deleted** |
| `frontend/src/lib/api.js` | Modified — 3 new master/review API calls |
| `frontend/src/pages/Cafeteria.jsx` | Modified — stock_servings-only badges; coffee virtual drinks disabled |
| `backend/tests/productConversion.test.js` | **New** — 18 unit tests, all passing |
| `.claude/launch.json` | **New** — dev server configurations for Claude Code preview |

---

## Project layout

```
inventory/
  frontend/      React + Vite + Tailwind UI (facility manager, dashboards, request flows)
  backend/       Node.js + Express API (validates auth, talks to Supabase)
  supabase/
    migrations/  SQL schema (0001–0024)
    seed/        Starter 34-product catalog
  tests/         Playwright E2E
  docs/          Internal notes
  my-agent/      Eve agent scaffold (initialized this session)
  memory/        Claude Code persistent memory for this project
```

## Roles

- `facility_manager` — daily stock updates, view alerts
- `finance` — spending reports (read transactions); can approve payment on bills but cannot approve stock mappings
- `leadership` — everything (super-admin); only role that can approve conversion master rules
- `staff` / `office_boy` — employee request access; can upload invoices

## Quick start

### 1. Supabase project

1. Create a project at supabase.com.
2. In SQL Editor, run migrations in order: `0001` → `0024`.
3. Run `supabase/seed/seed_products.sql` to load the 34 starter products.
4. In Auth → Providers, enable Email (magic link).
5. Create your first users and assign roles:

   ```sql
   update public.profiles set role = 'leadership'       where id = (select id from auth.users where email='you@applyways.com');
   update public.profiles set role = 'facility_manager' where id = (select id from auth.users where email='fm@applyways.com');
   update public.profiles set role = 'finance'          where id = (select id from auth.users where email='finance@applyways.com');
   ```

### 2. Backend

```bash
cd backend
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
npm install
npm run dev    # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev    # http://localhost:5173
```

### 4. Run unit tests

```bash
cd backend
node --test tests    # 18 tests, all should pass
```

### 5. E2E tests (optional)

```bash
cd tests
npm install
npx playwright install --with-deps chromium
npm test
```

---

## Pending work (next session)

- **BillApproval.jsx admin review UI** — show `conversion_status`, `converted_quantity`, `ai_suggestion` per item; approve/link/classify/reject actions wired to the new endpoints
- **Coffee recipe entry** — once grams-per-espresso is confirmed, add a row to `cafeteria_recipe_ingredients` to re-enable virtual coffee machine drinks
- **Deploy to Render** — git remote needs to be added; Render service exists at `https://inventory-vgor.onrender.com`
- **Deploy frontend to Vercel** — `vercel.json` already present
- **Eve agent** (`my-agent/`) — `instructions.md` still has the placeholder; define the agent's purpose

---

## Recommended developer tooling

### Playwright MCP (UI testing)

```bash
claude mcp add playwright -- npx @playwright/mcp@latest
```

### Postgres MCP (live schema introspection)

```bash
claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres "postgresql://mcp_read:PASSWORD@db.PROJECT.supabase.co:5432/postgres"
```

Create a read-only role first:

```sql
create role mcp_read login password 'pick-a-strong-password';
grant connect on database postgres to mcp_read;
grant usage on schema public to mcp_read;
grant select on all tables in schema public to mcp_read;
alter default privileges in schema public grant select on tables to mcp_read;
```

---

## Phase 2 hooks (not implemented yet)

- Hyperpure API integration for automated ordering
- Slack / email notifications for low-stock and expiry alerts
- Consumption-trend analytics
- Offline mode for the daily update form
- BillApproval admin review panel (conversion_status UI)
- Cafeteria recipe management UI (grams-per-serving editor)
