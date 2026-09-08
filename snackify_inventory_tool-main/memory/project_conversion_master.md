---
name: project-conversion-master
description: Product Conversion Master implementation — migration 0024, conversion library, admin review endpoints, cafeteria fix
metadata:
  type: project
---

Migration 0024 (`supabase/migrations/0024_product_conversion_master.sql`) is implemented and seeded. 18 approved master rules cover all current vendor products.

**Why:** Invoice sync used a hardcoded JS mapper (stockHelper.js) that auto-created cafeteria items and applied raw purchase quantities as servings, causing incorrect employee stock counts.

**What was built:**
- `product_conversion_master` table with aliases array (GIN indexed), classification enum, `apply_bill_item_stock` Postgres function (idempotency via UNIQUE on `bill_stock_applications.bill_item_id`)
- `backend/src/lib/productConversion.js` — alias matching + batched AI fallback, AI suggestions forced to `pending_review`/non-orderable/non-visible
- `bills.js` — extract route runs conversion after save (non-blocking); PATCH/:id/status blocks on pending_review items; new admin endpoints: GET/POST `/conversion-master`, PATCH `/items/:id/conversion`
- `billWebhook.js` — same conversion runs after webhook saves
- `cafeteria.js` — GET /items now filters `visible_to_employees != false` (Coffee Beans, Stirrers, Delivery Charges etc. excluded)
- `Cafeteria.jsx` — low-stock badge uses `stock_servings` only (not `stock_today`); milk availability uses `stock_servings` only
- Coffee virtual drinks (Espresso, Americano, etc.) now disabled until Coffee Beans has an approved recipe — `visible_to_employees=false` on Coffee Beans means `coffeeBeansRow` is never returned from API

**stockHelper.js** still exists — remove only after confirming no remaining imports.

**How to apply:** Run migration 0024 on Supabase, seed is included in migration. Rollback at `rollback_0024_product_conversion_master.sql`.
