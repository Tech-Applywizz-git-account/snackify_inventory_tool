import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  const { data: items, error } = await supabaseAdmin
    .from('cafeteria_items')
    .select('*');

  if (error) {
    console.error('Error fetching cafeteria_items:', error);
    return;
  }

  console.log('--- ALL CAFETERIA ITEMS ---');
  items.forEach(item => {
    console.log(`ID: ${item.id} | Name: ${item.item_name} | Display: ${item.display_name} | Category: ${item.category} | Orderable: ${item.orderable} | StockToday: ${item.stock_today} | StockServings: ${item.stock_servings} | Deps: ${JSON.stringify(item.dependencies)}`);
  });
}

run();
