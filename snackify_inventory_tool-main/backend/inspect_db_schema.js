import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  console.log("Inspecting employee_cafeteria_preferences columns and constraints...");

  // Query table columns
  const { data: cols, error: colsErr } = await supabaseAdmin.rpc('get_table_columns', { table_name: 'employee_cafeteria_preferences' });
  if (colsErr) {
    console.log("RPC get_table_columns failed, trying custom queries or metadata fetching.");
  } else {
    console.log("Columns metadata:", cols);
  }

  // Let's query information_schema columns using a direct query via a dummy table select if we don't have custom SQL RPC.
  // Wait, we can fetch the list of columns by doing a simple select of 1 row.
  const { data: rowData, error: rowErr } = await supabaseAdmin
    .from('employee_cafeteria_preferences')
    .select('*')
    .limit(1);

  if (rowErr) {
    console.error("Select * failed:", rowErr.message);
  } else {
    console.log("Row sample keys:", rowData.length > 0 ? Object.keys(rowData[0]) : "No rows found");
    console.log("Row sample values:", rowData[0]);
  }

  // Let's run a test query to find all foreign keys in the database.
  // Wait! Do we have a function or view we can select from?
  // Let's check if we can query from a system table or view via Supabase (PostgREST allows querying views if they are in the public schema).
  // But let's check if profiles and employee_cafeteria_preferences has a foreign key.
  // We can test if we can do the join with different names:
  // e.g. profiles(id), profiles:user_id(full_name), etc.
}

run();
