import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('./.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  const { data: products, error: pErr } = await supabaseAdmin.from('products').select('id, name');
  if (pErr) {
    console.error('Error fetching products:', pErr);
    return;
  }

  console.log(`Checking inventory for ${products.length} products...`);

  for (const product of products) {
    const { data: inv, error: iErr } = await supabaseAdmin
      .from('inventory')
      .select('id')
      .eq('product_id', product.id)
      .maybeSingle();

    if (!inv) {
      // Find transactions to sum stock
      const { data: txns } = await supabaseAdmin
        .from('transactions')
        .select('type, quantity')
        .eq('product_id', product.id);

      let stock = 0;
      if (txns) {
        for (const txn of txns) {
          if (txn.type === 'add') {
            stock += Number(txn.quantity);
          } else if (txn.type === 'remove' || txn.type === 'waste') {
            stock -= Number(txn.quantity);
          }
        }
      }

      console.log(`Product "${product.name}" (${product.id}) is missing inventory. Computed stock: ${stock}`);
      const { error: insErr } = await supabaseAdmin
        .from('inventory')
        .insert({
          product_id: product.id,
          current_stock: Math.max(0, stock),
          min_threshold: 3
        });
      if (insErr) {
        console.error(`  Failed to insert inventory for ${product.name}:`, insErr.message);
      } else {
        console.log(`  Successfully created inventory row for ${product.name}`);
      }
    } else {
      console.log(`Product "${product.name}" already has inventory row`);
    }
  }
}

run();
