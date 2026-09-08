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

function mapToProductCategory(categoryInput) {
  if (!categoryInput) return 'consumables';
  const clean = categoryInput.toLowerCase().trim();
  if (clean.includes('beverage')) {
    return 'beverages';
  }
  if (
    clean.includes('washroom') ||
    clean.includes('cleaning') ||
    clean.includes('toilet') ||
    clean.includes('soap')
  ) {
    return 'washroom';
  }
  if (clean.includes('coffee') || clean.includes('tea')) {
    return 'coffee_materials';
  }
  return 'consumables';
}

function mapToProductUnit(unitInput) {
  if (!unitInput) return 'pieces';
  const clean = unitInput.toLowerCase().trim();
  if (clean.includes('pack')) {
    return 'packs';
  }
  if (clean.includes('box')) {
    return 'boxes';
  }
  if (clean.includes('kg') || clean.includes('kilogram') || clean.includes('g') || clean.includes('gram')) {
    return 'kg';
  }
  if (clean.includes('liter') || clean.includes('ltr') || clean.includes('ml') || clean.includes('milliliter')) {
    return 'liters';
  }
  return 'pieces';
}

export function normalizeQuantityToPurchaseUnit(qty, purchaseUnit, master) {
  const pUnit = (purchaseUnit || '').toLowerCase().trim();
  const mUnit = (master.purchase_unit || '').toLowerCase().trim();

  // If units already match, no conversion needed
  if (pUnit === mUnit) return qty;

  // Case 1: Grams/Milliliters conversion
  if (pUnit === 'g' || pUnit === 'gram' || pUnit === 'grams') {
    if (mUnit === 'kg' || mUnit === 'kilogram') {
      return qty / 1000;
    }
    if (master.canonical_name === 'Bread' || master.canonical_name === 'Atta Bread') {
      return qty / 400; // standard 400g pack
    }
    if (master.canonical_name === 'Peanut Butter') {
      return qty / 750; // standard 750g jar
    }
  }

  if (pUnit === 'ml' || pUnit === 'milliliter' || pUnit === 'milliliters') {
    if (mUnit === 'liter' || mUnit === 'liters' || mUnit === 'l') {
      return qty / 1000;
    }
  }

  // Case 2: kg/L to g/ml conversion
  if (pUnit === 'kg' || pUnit === 'kilogram' || pUnit === 'kilograms') {
    if (mUnit === 'g' || mUnit === 'gram' || mUnit === 'grams') {
      return qty * 1000;
    }
  }
  if (pUnit === 'l' || pUnit === 'liter' || pUnit === 'liters') {
    if (mUnit === 'ml' || mUnit === 'milliliter' || mUnit === 'milliliters') {
      return qty * 1000;
    }
  }

  return qty;
}

/**
 * @param {object} purchase Full manual_purchases row
 * @param {{ writeFinance?: boolean }} [opts]
 * @returns {Promise<{ productId: string|undefined }>}
 */
export async function applyPurchaseToInventory(purchase, { writeFinance = true } = {}) {
  const itemName = purchase.item_name || 'Unknown Item';
  const qty = Number(purchase.quantity) || 1;
  const amount = Number(purchase.amount) || 0;

  // Query conversion master rule first to see if we need to scale quantity
  let master = null;
  let finalQty = qty;
  try {
    const normalized = normalizeName(itemName);
    const { data } = await supabaseAdmin
      .from('product_conversion_master')
      .select('*')
      .eq('active', true)
      .eq('approval_status', 'approved')
      .contains('aliases', [normalized])
      .maybeSingle();
    master = data;
    if (master) {
      finalQty = normalizeQuantityToPurchaseUnit(qty, purchase.unit, master);
    }
  } catch (err) {
    console.error('[applyPurchaseToInventory] Master lookup error:', err.message);
  }

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
    const costPerUnit = finalQty > 0 ? Number((amount / finalQty).toFixed(2)) : 0;
    const { data: newProduct, error: insertErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: itemName,
        category: mapToProductCategory(purchase.category),
        unit: mapToProductUnit(purchase.unit),
        cost_per_unit: costPerUnit,
      })
      .select('id')
      .single();
    if (insertErr) {
      console.error('[applyPurchaseToInventory] Failed to insert product:', insertErr.message);
      throw insertErr;
    }
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
      .update({ current_stock: (inv.current_stock || 0) + finalQty })
      .eq('product_id', productId);
  } else {
    await supabaseAdmin.from('inventory').insert({ product_id: productId, current_stock: finalQty });
  }

  // 3. Log transaction (finance record)
  if (writeFinance) {
    await supabaseAdmin.from('transactions').insert({
      product_id: productId,
      type: 'add',
      quantity: finalQty,
      unit_cost: finalQty > 0 ? amount / finalQty : amount,
      total_cost: amount,
      notes: `Manual purchase — ${purchase.vendor_name || 'Local Shop'} — ${purchase.payment_method || 'Cash'} — No invoice`,
    });
  }

  // 4. Update cafeteria stock if applicable
  if (master) {
    try {
      const skipClasses = new Set(['internal_supply', 'equipment_asset', 'finance_expense']);
      if (master.cafeteria_item_name && !skipClasses.has(master.classification)) {
        const servings =
          master.units_per_purchase_unit != null ? finalQty * master.units_per_purchase_unit : null;

        const { data: existingCafe } = await supabaseAdmin
          .from('cafeteria_items')
          .select('id, stock_today, stock_servings')
          .eq('item_name', master.cafeteria_item_name)
          .maybeSingle();

        if (existingCafe) {
          const { error: updErr } = await supabaseAdmin
            .from('cafeteria_items')
            .update({
              stock_today: (existingCafe.stock_today || 0) + Math.round(finalQty),
              stock_servings:
                servings !== null
                  ? (existingCafe.stock_servings || 0) + Math.round(servings)
                  : existingCafe.stock_servings,
              available: true,
            })
            .eq('id', existingCafe.id);
          if (updErr) {
            throw updErr;
          }
        }
      }
    } catch (cafErr) {
      console.error('[applyPurchaseToInventory] Failed to update cafeteria items:', cafErr.message);
    }
  }

  return { productId };
}
