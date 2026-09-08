import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const { supabaseAdmin } = await import('../lib/supabase.js');

async function run() {
  console.log('🥜 Updating Peanut Butter dependencies...');
  const { data: allItems, error } = await supabaseAdmin
    .from('cafeteria_items')
    .select('id, item_name, dependencies');

  if (error) {
    console.error('Error fetching items:', error.message);
    process.exit(1);
  }

  let updatedCount = 0;
  for (const item of allItems) {
    const n = (item.item_name || '').toLowerCase();
    if (n.includes('peanut butter') || n.includes(' pb ')) {
      const { error: updateError } = await supabaseAdmin
        .from('cafeteria_items')
        .update({ dependencies: ['bread'] })
        .eq('id', item.id);

      if (updateError) {
        console.error(`  ❌ Failed to update ${item.item_name}:`, updateError.message);
      } else {
        console.log(`  ✅ Set dependencies = ['bread'] for ${item.item_name}`);
        updatedCount++;
      }
    }
  }

  console.log(`\nFinished updating PB items. Total updated: ${updatedCount}`);
  process.exit(0);
}

run();
