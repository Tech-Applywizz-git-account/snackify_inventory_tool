import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  console.log("Fetching Jam items from cafeteria_items table...");

  const { data: items, error } = await supabaseAdmin
    .from('cafeteria_items')
    .select('*')
    .ilike('item_name', '%jam%');

  if (error) {
    console.error("Error fetching Jam items:", error.message);
  } else {
    console.log(`Found ${items.length} Jam item(s):`);
    items.forEach(item => {
      console.log("-----------------------------------------");
      console.log(`ID: ${item.id}`);
      console.log(`Item Name: ${item.item_name}`);
      console.log(`Display Name: ${item.display_name}`);
      console.log(`Calories Per Serving: ${item.calories_per_serving} kcal`);
      console.log(`Stock Today (boxes/jars): ${item.stock_today}`);
      console.log(`Stock Servings (total portions): ${item.stock_servings}`);
      console.log(`Dependencies:`, item.dependencies);
      console.log(`Sides Option:`, item.sides_option);
    });
  }
}

run();
