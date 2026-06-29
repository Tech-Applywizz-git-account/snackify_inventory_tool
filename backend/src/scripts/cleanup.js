import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

// Import after config for ESM
const { supabaseAdmin } = await import('../lib/supabase.js');

async function cleanup() {
  console.log('🧹 Cleaning up existing data...');

  const tables = ['bill_items', 'bill_uploads', 'transactions', 'inventory', 'products'];

  for (const table of tables) {
    console.log(`- Clearing ${table}...`);
    // Delete all rows
    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.error(`Error clearing ${table}:`, error.message);
    } else {
      console.log(`✅ ${table} cleared.`);
    }
  }

  console.log('✅ System Reset Complete.');
}

cleanup();
