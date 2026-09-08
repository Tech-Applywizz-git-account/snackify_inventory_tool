import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const { supabaseAdmin } = await import('../lib/supabase.js');

async function resetStock() {
  console.log('🔄 Starting complete stock reset...');

  // 1. Clear related tables
  const tables = ['bill_items', 'bill_uploads', 'transactions', 'inventory'];
  for (const table of tables) {
    console.log(`- Truncating/clearing table: ${table}...`);
    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.error(`Error clearing ${table}:`, error);
    }
  }

  // 2. Clear requests table too (so there are no dangling requests)
  console.log('- Clearing requests table...');
  const { error: reqError } = await supabaseAdmin
    .from('requests')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (reqError) {
    console.error('Error clearing requests:', reqError);
  }

  // 3. Reset cafeteria_items stock
  console.log('- Resetting cafeteria_items stock to 0...');

  // First, get all cafeteria items to ensure we don't clear Water Bottle
  const { data: items, error: fetchError } = await supabaseAdmin
    .from('cafeteria_items')
    .select('id, item_name');

  if (fetchError) {
    console.error('Error fetching cafeteria items:', fetchError);
    return;
  }

  for (const item of items) {
    if (item.item_name.toLowerCase() === 'water bottle') {
      console.log(`  Skipping water bottle (ID: ${item.id}) - keeping stock unlimited`);
      const { error: updateError } = await supabaseAdmin
        .from('cafeteria_items')
        .update({ stock_today: null, stock_servings: null })
        .eq('id', item.id);
      if (updateError) {
        console.error(`Error updating water bottle stock:`, updateError);
      }
    } else {
      console.log(`  Resetting stock for: ${item.item_name} (ID: ${item.id})`);

      const updateFields = { stock_today: 0, stock_servings: 0 };

      // Special configuration for unified bread items
      if (item.item_name === 'Bread') {
        updateFields.display_name = 'Milk Bread';
        updateFields.available = true;
        updateFields.orderable = false;
      } else if (item.item_name === 'MDRN AT SHK BRD400G') {
        updateFields.display_name = 'Atta Bread';
        updateFields.available = true;
        updateFields.orderable = false;
      } else if (
        item.item_name === 'MODERN MILK BRD 350G' ||
        item.item_name === 'MRBWL MLK BREAD 400G' ||
        item.item_name === 'MRBWL BR BREAD 400G'
      ) {
        updateFields.available = false;
        updateFields.orderable = false;
      }

      const { error: updateError } = await supabaseAdmin
        .from('cafeteria_items')
        .update(updateFields)
        .eq('id', item.id);
      if (updateError) {
        console.error(`Error updating stock for ${item.item_name}:`, updateError);
      }
    }
  }

  console.log('✅ Database stock reset complete!');
}

resetStock();
