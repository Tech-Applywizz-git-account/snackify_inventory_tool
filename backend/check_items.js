import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  const { data: items, error } = await supabaseAdmin
    .from('cafeteria_items')
    .select('id, item_name, display_name, category, orderable, available, dependencies, stock_servings, stock_today, sides_option');

  if (error) {
    console.error('Error fetching cafeteria_items:', error);
    return;
  }

  console.log('--- ALL CAFETERIA ITEMS ---');
  items.forEach(item => {
    console.log(item);
  });
}

run();
