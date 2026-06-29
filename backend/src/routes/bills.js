import { Router } from 'express';
import { z } from 'zod';
import { fileUrlCompletion, visionCompletion } from '../lib/openai.js';
import { processInvoiceItems, saveConversions } from '../lib/productConversion.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

const EXTRACTION_SYSTEM = `You are an Office Bill, Inventory, and Expense Extraction Assistant.
Your job is to read vendor bills uploaded as images or PDFs and convert them into structured inventory and expense data.
The company buys office items from vendors such as HyperPure, JioMart, Amazon, Blinkit, BigBasket, and other suppliers.

Extract:
- vendor_name
- bill_date
- invoice_number
- uploaded_by
- items
- item_name
- category
- quantity
- unit
- unit_rate
- tax
- total_amount
- delivery_charges
- discount
- grand_total
- payment_status
- stock_update_summary
- expense_category
- confidence_score
- needs_manual_review
- manual_review_reason

Rules:
1. Extract only what is visible in the bill.
2. Do not guess rates or totals.
3. If a field is not visible, return null.
4. Categorize items as Pantry, Cleaning, Stationery, Maintenance, Electrical, Housekeeping, or Miscellaneous.
5. If the bill image is unclear, mark needs_manual_review as true.
6. If item totals do not match grand total, mark needs_manual_review as true.
7. If quantity or rate is missing, mark needs_manual_review as true.
8. Do not finalize inventory automatically.
9. Create stock update only as "Pending Admin Verification".
10. Office Boy upload does not mean bill approval.
11. Admin must verify stock and bill details.
12. Accounts must approve payment.
13. Return JSON only.

JSON format:
{
  "vendor_name": "",
  "bill_date": "",
  "invoice_number": "",
  "uploaded_by": "Office Boy",
  "items": [
    {
      "item_name": "",
      "category": "",
      "quantity": "",
      "unit": "",
      "unit_rate": "",
      "tax": "",
      "total_amount": "",
      "inventory_action": ""
    }
  ],
  "delivery_charges": "",
  "discount": "",
  "grand_total": "",
  "payment_status": "",
  "stock_update_summary": [],
  "expense_category": "",
  "extraction_status": "Extracted",
  "verification_status": "Pending Admin Verification",
  "approval_status": "Pending Accounts Approval",
  "confidence_score": "",
  "needs_manual_review": false,
  "manual_review_reason": ""
}`;

const ROASTS = [
  `Bhai, ye bill pehle se hi system mein hai. Ek hi move do baar thodi chalti hai? Checkmate! ♟️❌`,
  `Waah! Ek hi bill do baar upload karke kya ameer hona chahte ho? 😂 System itna bhi bhole nahi hai.`,
  `Pantry hai bhai, Magic Show nahi. Ek bill se do baar stock nahi badhega. Duplicate blocked! 🥜🚫`,
  `Oho! Overacting ke 50 rupay kaat iske. Ye bill pehle hi add ho chuka hai! 🎭`,
  `Bhai, thoda dhyan se. Ye bill duplicate hai. System ko chess sikhane ki koshish mat karo! ♟️🤖`,
];

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const m = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

// ── POST /api/bills/extract ────────────────────────────────────────────────
router.post('/extract', requireRole('office_boy', 'admin'), async (req, res, next) => {
  try {
    const { file_url } = req.body;
    if (!file_url) return res.status(400).json({ error: 'file_url required' });

    const isPdf = /\.pdf($|\?)/i.test(file_url);
    const { content, model } = isPdf
      ? await fileUrlCompletion({
          system: EXTRACTION_SYSTEM,
          user: 'Extract the details from this PDF vendor bill.',
          fileUrl: file_url,
          model: 'gpt-4o',
        })
      : await visionCompletion({
          system: EXTRACTION_SYSTEM,
          user: 'Extract the details from this bill image.',
          imageUrl: file_url,
        });

    let parsed;
    try {
      parsed = JSON.parse(
        content
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/```$/, '')
          .trim()
      );
    } catch {
      throw new Error(`Vision AI returned non-JSON: ${content.slice(0, 200)}`);
    }

    // Duplicate check (app-level — DB uniqueness constraint pending duplicate audit)
    const { data: existing } = await supabaseAdmin
      .from('bill_uploads')
      .select('id')
      .eq('invoice_number', parsed.invoice_number)
      .maybeSingle();

    if (existing) {
      const roast = ROASTS[Math.floor(Math.random() * ROASTS.length)];
      return res.status(200).json({
        ok: false,
        error: 'Duplicate Bill Detected',
        message: `❌ Duplicate Bill Detected!\nVendor: ${parsed.vendor_name}\nInvoice: #${parsed.invoice_number}\n\n${roast}`,
      });
    }

    const { data: bill, error: billErr } = await supabaseAdmin
      .from('bill_uploads')
      .insert({
        vendor_name: parsed.vendor_name,
        bill_date: normalizeDate(parsed.bill_date),
        invoice_number: parsed.invoice_number,
        uploaded_by_user_id: req.user.id,
        uploaded_by_name: req.user.full_name || 'Office Boy',
        file_url,
        extraction_status: 'Extracted',
        verification_status: parsed.verification_status || 'Pending Admin Verification',
        approval_status: parsed.approval_status || 'Pending Accounts Approval',
        grand_total: parsed.grand_total,
        delivery_charges: parsed.delivery_charges || 0,
        discount: parsed.discount || 0,
        confidence_score: parsed.confidence_score,
        needs_manual_review: parsed.needs_manual_review,
        manual_review_reason: parsed.manual_review_reason,
        inventory_sync_status: 'not_started',
      })
      .select()
      .single();

    if (billErr) throw billErr;

    // Insert items and run conversion matching
    const rawItems = parsed.items || [];
    let savedItems = [];
    if (rawItems.length) {
      const { data: insertedItems, error: itemsErr } = await supabaseAdmin
        .from('bill_items')
        .insert(
          rawItems.map((item) => ({
            bill_id: bill.id,
            item_name: item.item_name,
            category: item.category,
            quantity: item.quantity,
            unit: item.unit,
            unit_rate: item.unit_rate,
            tax: item.tax || 0,
            total_amount: item.total_amount,
            inventory_action: item.inventory_action,
          }))
        )
        .select('id, item_name, quantity, unit');
      if (itemsErr) throw itemsErr;
      savedItems = insertedItems || [];

      // Run conversion matching (non-blocking — failures don't fail the upload)
      processInvoiceItems(savedItems)
        .then((conversions) => saveConversions(savedItems, conversions))
        .catch(() => {});
    }

    res.json({
      ok: true,
      bill_id: bill.id,
      vendor_name: bill.vendor_name,
      invoice_number: bill.invoice_number,
      grand_total: bill.grand_total,
      message: `✅ Success! ${parsed.vendor_name} bill (Invoice #${parsed.invoice_number}) processed. ${rawItems.length} items queued for conversion review.`,
      parsed,
      model,
    });
  } catch (e) {
    next(e);
  }
});

// ── PATCH /api/bills/:id/status ────────────────────────────────────────────
// Finance can approve payment. Leadership/admin can verify stock.
// Stock sync only happens on verification_status = 'Admin Verified' and requires
// all stock items to have a resolved conversion (no pending_review).
router.patch(
  '/:id/status',
  requireRole('admin', 'leadership', 'finance'),
  async (req, res, next) => {
    try {
      const { verification_status, approval_status, notes } = req.body;

      const { data: bill, error: updateErr } = await supabaseAdmin
        .from('bill_uploads')
        .update({
          verification_status,
          approval_status,
          notes,
          verified_at: verification_status === 'Admin Verified' ? new Date().toISOString() : null,
        })
        .eq('id', req.params.id)
        .select('*, bill_items(*)')
        .single();

      if (updateErr) throw updateErr;

      // Stock sync: only leadership/admin may trigger, only on Admin Verified
      if (verification_status === 'Admin Verified' && req.user.role !== 'finance') {
        const items = bill.bill_items || [];

        // Block if any stock-relevant items are still unresolved
        const blocked = items.filter(
          (i) =>
            i.conversion_status === 'pending_review' &&
            i.ai_suggestion?.classification !== 'finance_expense' &&
            i.ai_suggestion?.classification !== 'equipment_asset'
        );

        if (blocked.length) {
          return res.status(409).json({
            error: 'Unresolved items',
            message: `${blocked.length} item(s) still need conversion review before stock can be applied.`,
            blocked_items: blocked.map((i) => ({ id: i.id, item_name: i.item_name })),
          });
        }

        // Apply each eligible item via the DB function (idempotent)
        const { data: products } = await supabaseAdmin.from('products').select('id, name');

        for (const item of items) {
          if (!['master_match', 'manual_linked'].includes(item.conversion_status)) continue;

          // Fetch master record
          const { data: master } = await supabaseAdmin
            .from('product_conversion_master')
            .select('*')
            .eq('id', item.conversion_master_id)
            .single();

          if (!master) continue;

          const qty = parseFloat(item.quantity) || 0;
          const converted =
            item.converted_quantity ??
            (master.units_per_purchase_unit != null ? qty * master.units_per_purchase_unit : null);

          // Call transactional DB function
          await supabaseAdmin.rpc('apply_bill_item_stock', {
            p_bill_item_id: item.id,
            p_bill_id: bill.id,
            p_conversion_master_id: master.id,
            p_cafeteria_item_name: master.cafeteria_item_name,
            p_stock_quantity: qty,
            p_stock_unit: master.storage_unit,
            p_servings: converted,
            p_applied_by: req.user.id,
            p_notes: `Synced from Bill #${bill.invoice_number} (${bill.vendor_name})`,
          });
          // Errors from already-applied items are swallowed (idempotent)

          // Also update inventory table for stock tracking
          const match = products?.find(
            (p) =>
              p.name.toLowerCase().includes(master.canonical_name.toLowerCase()) ||
              master.canonical_name.toLowerCase().includes(p.name.toLowerCase())
          );
          if (match) {
            const { data: inv } = await supabaseAdmin
              .from('inventory')
              .select('current_stock')
              .eq('product_id', match.id)
              .single();

            await supabaseAdmin
              .from('inventory')
              .update({
                current_stock: (inv?.current_stock || 0) + qty,
                last_updated_by: req.user.id,
              })
              .eq('product_id', match.id);

            await supabaseAdmin.from('transactions').insert({
              product_id: match.id,
              type: 'add',
              quantity: qty,
              unit_cost: item.unit_rate,
              total_cost: item.total_amount,
              notes: `Auto-synced from Bill #${bill.invoice_number} (${bill.vendor_name})`,
              facility_manager_id: req.user.id,
            });
          }
        }

        // Mark bill sync complete
        await supabaseAdmin
          .from('bill_uploads')
          .update({
            inventory_sync_status: 'complete',
            inventory_synced_at: new Date().toISOString(),
          })
          .eq('id', bill.id);
      }

      res.json(bill);
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/bills ─────────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('bill_uploads')
      .select('*, bill_items(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// ── GET /api/bills/vendor-summary ──────────────────────────────────────────
router.get('/vendor-summary', requireRole('finance', 'leadership'), async (req, res, next) => {
  try {
    const { month } = req.query;
    let q = supabaseAdmin
      .from('bill_uploads')
      .select(
        'id, vendor_name, invoice_number, bill_date, grand_total, file_url, created_at, verification_status, approval_status, bill_items(item_name, quantity, unit, unit_rate, tax, total_amount)'
      )
      .order('created_at', { ascending: false });

    if (month) {
      const [y, m] = month.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      q = q
        .gte('created_at', `${month}-01T00:00:00`)
        .lte('created_at', `${month}-${String(lastDay).padStart(2, '0')}T23:59:59`);
    }

    const { data: bills, error } = await q;
    if (error) throw error;

    const vendorMap = {};
    let monthTotal = 0;
    for (const bill of bills || []) {
      const vName = bill.vendor_name || 'Unknown Vendor';
      if (!vendorMap[vName])
        vendorMap[vName] = { vendor_name: vName, bill_count: 0, total_spend: 0, bills: [] };
      vendorMap[vName].bill_count++;
      vendorMap[vName].total_spend += Number(bill.grand_total) || 0;
      monthTotal += Number(bill.grand_total) || 0;
      vendorMap[vName].bills.push({
        id: bill.id,
        invoice_number: bill.invoice_number,
        bill_date: bill.bill_date,
        grand_total: bill.grand_total,
        file_url: bill.file_url,
        created_at: bill.created_at,
        verification_status: bill.verification_status,
        approval_status: bill.approval_status,
        items: (bill.bill_items || []).map((i) => ({
          item_name: i.item_name,
          quantity: i.quantity,
          unit: i.unit,
          unit_rate: i.unit_rate,
          tax: i.tax,
          total_amount: i.total_amount,
        })),
      });
    }

    res.json({
      month: month || 'all',
      month_total: Number(monthTotal.toFixed(2)),
      vendor_count: Object.keys(vendorMap).length,
      bill_count: (bills || []).length,
      vendors: Object.values(vendorMap).sort((a, b) => b.total_spend - a.total_spend),
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/bills/conversion-master ──────────────────────────────────────
// List all conversion master records (leadership only).
router.get('/conversion-master', requireRole('leadership'), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('product_conversion_master')
      .select('*')
      .eq('active', true)
      .order('canonical_name');
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// ── POST /api/bills/conversion-master ─────────────────────────────────────
// Create and immediately approve a new master rule (leadership only).
const MasterSchema = z.object({
  canonical_name: z.string().min(1),
  aliases: z.array(z.string()).min(1),
  classification: z.enum([
    'direct_menu_stock',
    'ingredient_or_dependency',
    'recipe_stock',
    'internal_supply',
    'equipment_asset',
    'finance_expense',
    'unknown_pending_review',
  ]),
  purchase_unit: z.string(),
  storage_unit: z.string(),
  units_per_purchase_unit: z.number().nullable().optional(),
  employee_serving_unit: z.string().nullable().optional(),
  cafeteria_item_name: z.string().nullable().optional(),
  visible_to_employees: z.boolean().default(false),
  employee_orderable: z.boolean().default(false),
  recipe_required: z.boolean().default(false),
  evidence_note: z.string().optional(),
});

router.post('/conversion-master', requireRole('leadership'), async (req, res, next) => {
  try {
    const body = MasterSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('product_conversion_master')
      .insert({
        ...body,
        approval_status: 'approved',
        approved_by: req.user.full_name || req.user.email,
        approved_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
});

// ── PATCH /api/bills/items/:id/conversion ─────────────────────────────────
// Link a bill item to a master record, or classify it directly (leadership only).
router.patch('/items/:id/conversion', requireRole('leadership'), async (req, res, next) => {
  try {
    const { conversion_master_id, conversion_status, converted_quantity } = req.body;
    const allowed = ['master_match', 'manual_linked', 'no_stock', 'pending_review'];
    if (conversion_status && !allowed.includes(conversion_status)) {
      return res
        .status(400)
        .json({ error: `conversion_status must be one of: ${allowed.join(', ')}` });
    }

    const update = {};
    if (conversion_master_id !== undefined) update.conversion_master_id = conversion_master_id;
    if (conversion_status !== undefined) update.conversion_status = conversion_status;
    if (converted_quantity !== undefined) update.converted_quantity = converted_quantity;
    update.processed_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('bill_items')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    next(e);
  }
});

export default router;
