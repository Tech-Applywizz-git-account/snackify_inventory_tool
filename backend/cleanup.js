import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { supabaseAdmin } from './src/lib/supabase.js';

async function cleanup() {
  console.log('🧹 Cleaning up existing data...');
  
  const tables = ['bill_items', 'bill_uploads', 'transactions', 'inventory', 'products'];
  
  for (const table of tables) {
    console.log(`- Clearing ${table}...`);
    const { error } = await supabaseAdmin.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) console.error(`Error clearing ${table}:`, error);
  }
  
  console.log('✅ System Reset Complete.');
}

cleanup();
