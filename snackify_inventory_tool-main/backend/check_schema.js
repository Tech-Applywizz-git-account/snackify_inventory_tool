import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  const { data: cols, error } = await supabaseAdmin.rpc('get_table_columns', { table_name: 'cafeteria_items' });
  if (error) {
    // If RPC doesn't exist, let's query information_schema via a raw query if allowed, or check by retrieving a row
    console.log("RPC get_table_columns failed, attempting direct query...");
    const { data: info, error: infoErr } = await supabaseAdmin
      .from('cafeteria_items')
      .select('*')
      .limit(1);
    if (infoErr) {
      console.error(infoErr);
    } else {
      console.log("Sample row:", info[0]);
    }
  } else {
    console.log("Columns:", cols);
  }
}

run();
