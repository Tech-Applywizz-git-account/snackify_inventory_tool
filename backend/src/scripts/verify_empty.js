import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), 'backend', '.env') });

const { supabaseAdmin } = await import('../lib/supabase.js');

async function verify() {
  console.log('🔍 VERIFYING DATABASE EMPTINESS STATE...');

  // Check auth users
  const {
    data: { users },
    error: authErr,
  } = await supabaseAdmin.auth.admin.listUsers();
  if (authErr) {
    console.error('❌ Error checking auth users:', authErr.message);
  } else {
    console.log(`- Auth Users Count: ${users.length}`);
  }

  // Check table counts
  const tables = [
    'profiles',
    'employee_cafeteria_preferences',
    'requests',
    'ob_leave',
    'bill_items',
    'bill_uploads',
    'transactions',
    'inventory',
    'products',
    'teams_activity_logs',
    'notification_logs',
    'ai_summaries',
  ];

  for (const table of tables) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error(`❌ Error querying table ${table}:`, error.message);
    } else {
      console.log(`- Table [${table}] Rows Count: ${count}`);
    }
  }

  // Check cafeteria items (should still have rows but stock is 0/null)
  const { data: items, error: itemErr } = await supabaseAdmin
    .from('cafeteria_items')
    .select('item_name, stock_today, stock_servings');

  if (itemErr) {
    console.error('❌ Error querying cafeteria_items:', itemErr.message);
  } else {
    console.log(`- Table [cafeteria_items] Rows Count: ${items.length}`);
    const nonZeroStock = items.filter((i) => {
      const s = i.stock_servings ?? i.stock_today;
      return s !== null && s > 0;
    });
    console.log(`  - Items with non-zero stock (excluding Water): ${nonZeroStock.length}`);
  }

  console.log('🔍 VERIFICATION COMPLETE.');
  process.exit(0);
}

verify();
