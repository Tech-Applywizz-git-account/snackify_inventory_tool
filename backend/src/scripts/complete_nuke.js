import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), 'backend', '.env') });

const { supabaseAdmin } = await import('../lib/supabase.js');

async function nuke() {
  console.log('💥 STARTING COMPLETE DATABASE AND AUTH USER NUKE... 💥');

  // 1. Delete all users from Supabase Auth
  try {
    const {
      data: { users },
      error: listErr,
    } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;
    console.log(`Found ${users.length} auth users. Deleting them...`);
    for (const u of users) {
      console.log(`Deleting user: ${u.email} (${u.id})`);
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
      if (delErr) {
        console.error(`❌ Failed to delete auth user ${u.email}:`, delErr.message);
      }
    }
  } catch (err) {
    console.error('Error deleting users:', err.message || err);
  }

  // 2. Clear all application tables
  const tables = [
    'ob_leave',
    'employee_cafeteria_preferences',
    'requests',
    'bill_items',
    'bill_uploads',
    'transactions',
    'inventory',
    'products',
    'profiles',
    'teams_activity_logs',
    'notification_logs',
    'ai_summaries',
  ];

  for (const table of tables) {
    console.log(`Clearing table: ${table}...`);
    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      // Fallback delete if table doesn't have uuid primary key id
      const { error: err2 } = await supabaseAdmin
        .from(table)
        .delete()
        .neq('user_id', '00000000-0000-0000-0000-000000000000');
      if (err2) {
        console.error(`❌ Error clearing table ${table}:`, error.message);
      } else {
        console.log(`✅ Table ${table} cleared.`);
      }
    } else {
      console.log(`✅ Table ${table} cleared.`);
    }
  }

  // 3. Reset cafeteria_items stock
  console.log('Resetting cafeteria_items stock...');
  const { data: items, error: fetchError } = await supabaseAdmin
    .from('cafeteria_items')
    .select('id, item_name');

  if (fetchError) {
    console.error('❌ Error fetching cafeteria items:', fetchError.message);
  } else {
    for (const item of items) {
      if (item.item_name.toLowerCase() === 'water bottle') {
        const { error: updateError } = await supabaseAdmin
          .from('cafeteria_items')
          .update({ stock_today: null, stock_servings: null })
          .eq('id', item.id);
        if (updateError) console.error(`❌ Error updating water:`, updateError.message);
      } else {
        const updateFields = { stock_today: 0, stock_servings: 0 };
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
        if (updateError) console.error(`❌ Error updating ${item.item_name}:`, updateError.message);
      }
    }
    console.log('✅ Stock values reset on all cafeteria items.');
  }

  console.log('💥 NUKE COMPLETED SUCCESSFULLY! 💥');
  process.exit(0);
}

nuke();
