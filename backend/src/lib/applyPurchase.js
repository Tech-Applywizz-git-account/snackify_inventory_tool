/**
 * Shared inventory/finance sync for manual purchases.
 *
 * Single source of truth used by BOTH:
 *   - the web route (routes/manualPurchase.js — Approve / Sync)
 *   - the Telegram webhook (routes/telegramWebhook.js — auto-approved purchases)
 *
 * Finds or creates the product, increments stock, and logs a finance transaction.
 * Callers enforce idempotency via purchase status guards (a purchase reaches
 * this once before becoming 'synced_to_inventory').
 */

import { supabaseAdmin } from './supabase.js';
import { normalizeName } from './productConversion.js';

/**
 * @param {object} purchase Full manual_purchases row
 * @param {{ writeFinance?: boolean }} [opts]
 * @returns {Promise<{ productId: string|undefined }>}
 */
export async function applyPurchaseToInventory(purchase, { writeFinance = true } = {}) {
  const itemName = purchase.item_name || 'Unknown Item';
  const qty = Number(purchase.quantity) || 1;
  const amount = Number(purchase.amount) || 0;

  // 1. Find or create product
  const { data: existingProduct } = await supabaseAdmin
    .from('products')
    .select('id')
    .ilike('name', itemName)
    .maybeSingle();

  let productId;
  if (existingProduct) {
    productId = existingProduct.id;
  } else {
    const { data: newProduct } = await supabaseAdmin
      .from('products')
      .insert({
        name: itemName,
        category: purchase.category || 'Pantry',
        unit: purchase.unit || 'pcs',
      })
      .select('id')
      .single();
    productId = newProduct?.id;
  }

  if (!productId) return { productId };

  // 2. Update inventory stock
  const { data: inv } = await supabaseAdmin
    .from('inventory')
    .select('current_stock')
    .eq('product_id', productId)
    .maybeSingle();

  if (inv) {
    await supabaseAdmin
      .from('inventory')
      .update({ current_stock: (inv.current_stock || 0) + qty })
      .eq('product_id', productId);
  } else {
    await supabaseAdmin.from('inventory').insert({ product_id: productId, current_stock: qty });
  }

  // 3. Log transaction (finance record)
  if (writeFinance) {
    await supabaseAdmin.from('transactions').insert({
      product_id: productId,
      type: 'add',
      quantity: qty,
      unit_cost: amount / qty,
      total_cost: amount,
      notes: `Manual purchase — ${purchase.vendor_name || 'Local Shop'} — ${purchase.payment_method || 'Cash'} — No invoice`,
    });
  }

  // 4. Update cafeteria stock if applicable
  try {
    const normalized = normalizeName(itemName);
    const { data: master } = await supabaseAdmin
      .from('product_conversion_master')
      .select('*')
      .eq('active', true)
      .eq('approval_status', 'approved')
      .contains('aliases', [normalized])
      .maybeSingle();

    const skipClasses = new Set(['internal_supply', 'equipment_asset', 'finance_expense']);
    if (master?.cafeteria_item_name && !skipClasses.has(master.classification)) {
      const servings =
        master.units_per_purchase_unit != null ? qty * master.units_per_purchase_unit : null;

      const { data: existingCafe } = await supabaseAdmin
        .from('cafeteria_items')
        .select('id, stock_today, stock_servings')
        .eq('item_name', master.cafeteria_item_name)
        .maybeSingle();

      if (existingCafe) {
        await supabaseAdmin
          .from('cafeteria_items')
          .update({
            stock_today: (existingCafe.stock_today || 0) + qty,
            stock_servings:
              servings !== null
                ? (existingCafe.stock_servings || 0) + servings
                : existingCafe.stock_servings,
            available: true,
          })
          .eq('id', existingCafe.id);
      }
    }
  } catch (cafErr) {
    console.error('[applyPurchaseToInventory] Failed to update cafeteria items:', cafErr.message);
  }

  return { productId };
}
