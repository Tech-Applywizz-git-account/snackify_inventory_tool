import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  const tables = ['inventory', 'transactions', 'requests', 'bill_uploads', 'bill_items'];
  for (const t of tables) {
    const { count, error } = await supabaseAdmin
      .from(t)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`Table ${t}: Error - ${error.message}`);
    } else {
      console.log(`Table ${t}: ${count} rows`);
    }
  }
}

run();
