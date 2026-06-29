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

  return { productId };
}
