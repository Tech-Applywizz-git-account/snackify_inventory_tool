/**
 * One-time fix: Set dependencies = ['bread'] for all jam items
 * in the cafeteria_items table so they behave like Peanut Butter.
 *
 * Run with: node scripts/fix-jam-dependencies.js
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

import { supabaseAdmin } from '../src/lib/supabase.js';

const JAM_NAMES = ['mix fruit jam', 'pineapple jam', 'jam'];

async function run() {
  // Fetch all cafeteria items
  const { data: allItems, error } = await supabaseAdmin
    .from('cafeteria_items')
    .select('id, item_name, dependencies');

  if (error) {
    console.error('Failed to fetch items:', error.message);
    process.exit(1);
  }

  const toUpdate = allItems.filter(item => {
    const n = (item.item_name || '').toLowerCase();
    return JAM_NAMES.some(j => n.includes(j));
  });

  if (toUpdate.length === 0) {
    console.log('No jam items found in DB.');
    process.exit(0);
  }

  console.log(`Found ${toUpdate.length} jam item(s):`);
  toUpdate.forEach(i => console.log(`  → ${i.item_name} (current deps: ${JSON.stringify(i.dependencies)})`));

  for (const item of toUpdate) {
    const { error: updateError } = await supabaseAdmin
      .from('cafeteria_items')
      .update({ dependencies: ['bread'] })
      .eq('id', item.id);

    if (updateError) {
      console.error(`  ❌ Failed to update ${item.item_name}:`, updateError.message);
    } else {
      console.log(`  ✅ ${item.item_name} → dependencies = ['bread']`);
    }
  }

  console.log('\nDone. All jam items now require bread.');
  process.exit(0);
}

run();
