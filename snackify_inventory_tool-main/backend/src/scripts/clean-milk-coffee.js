import { resolve } from 'node:path';
import dotenv from 'dotenv';

// Config env from root or backend directory depending on where command is run
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), 'backend', '.env') });

// Import supabaseAdmin
const { supabaseAdmin } = await import('../lib/supabase.js');

async function cleanDrinkPrefs() {
  console.log('🧹 Cleaning up "Milk Coffee" from database preferences...');

  // Fetch all employee preferences
  const { data, error } = await supabaseAdmin
    .from('employee_cafeteria_preferences')
    .select('user_id, drink_prefs');

  if (error) {
    console.error('Error fetching preferences:', error.message);
    process.exit(1);
  }

  let updatedCount = 0;
  for (const row of data) {
    if (Array.isArray(row.drink_prefs) && row.drink_prefs.includes('Milk Coffee')) {
      const filtered = row.drink_prefs.filter((d) => d !== 'Milk Coffee');
      console.log(`Updating preferences for user ${row.user_id}: removing "Milk Coffee"`);

      const { error: updateErr } = await supabaseAdmin
        .from('employee_cafeteria_preferences')
        .update({ drink_prefs: filtered })
        .eq('user_id', row.user_id);

      if (updateErr) {
        console.error(`❌ Error updating user ${row.user_id}:`, updateErr.message);
      } else {
        updatedCount++;
      }
    }
  }

  console.log(`\n✅ Completed database cleanup. Updated ${updatedCount} profiles.`);
  process.exit(0);
}

cleanDrinkPrefs();
