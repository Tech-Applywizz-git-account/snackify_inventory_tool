import dotenv from 'dotenv';
import { resolve } from 'path';
import fs from 'fs';

dotenv.config({ path: resolve('./.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  const { data: products, error: pErr } = await supabaseAdmin.from('products').select('*');
  const { data: inventory, error: iErr } = await supabaseAdmin.from('inventory').select('*');
  const { data: transactions, error: tErr } = await supabaseAdmin.from('transactions').select('*');
  const { data: billUploads, error: buErr } = await supabaseAdmin.from('bill_uploads').select('*');
  const { data: billItems, error: biErr } = await supabaseAdmin.from('bill_items').select('*');

  console.log("Errors:");
  console.log("Products error:", pErr);
  console.log("Inventory error:", iErr);
  console.log("Transactions error:", tErr);
  console.log("Bill Uploads error:", buErr);
  console.log("Bill Items error:", biErr);

  const auditData = {
    products: products || [],
    inventory: inventory || [],
    transactions: transactions || [],
    billUploads: billUploads || [],
    billItems: billItems || []
  };

  fs.writeFileSync('./audit_data.json', JSON.stringify(auditData, null, 2));
  console.log("Wrote complete audit data to backend/audit_data.json");
}

run();
