import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const { supabaseAdmin } = await import('../lib/supabase.js');

const INVOICES = [
  {
    vendor: 'HyperPure by Zomato',
    invoice_no: 'ZHPTG27-00052570',
    date: '2026-05-08',
    items: [
      { name: "Mala's - Mix Fruit Jam, 4 Kg", qty: 4, price: 343, category: 'consumables' },
      { name: "Mala's - Pineapple Jam, 1 Kg", qty: 3, price: 146, category: 'consumables' },
      { name: 'Coffee Stirrer, 110 mm (Pack of 500)', qty: 6, price: 51, category: 'beverages' },
    ],
  },
  {
    vendor: 'JioMart',
    invoice_no: '295021826508710',
    date: '2026-05-12',
    items: [
      { name: 'EDAY MILK BREAD 400G', qty: 1, price: 39, category: 'consumables' },
      { name: 'MILK BREAD 400G', qty: 1, price: 34, category: 'consumables' },
      { name: 'WHT BREAD 400G', qty: 1, price: 30, category: 'consumables' },
    ],
  },
  {
    vendor: 'Ridhi Enterprises',
    invoice_no: 'INV-2023-1919',
    date: '2026-05-08',
    items: [
      { name: 'Assam tea', qty: 10, price: 250, category: 'beverages' },
      { name: 'Elaichi tea', qty: 2, price: 275, category: 'beverages' },
      { name: 'Ginger tea', qty: 2, price: 275, category: 'beverages' },
      { name: 'Lemon sachets', qty: 4, price: 120, category: 'beverages' },
      { name: 'Hot chocolate', qty: 2, price: 120, category: 'beverages' },
      { name: 'Badam Sachets', qty: 2, price: 150, category: 'beverages' },
      { name: 'Coffee Beans', qty: 5, price: 1000, category: 'beverages' },
      {
        name: 'Accessories (Bucket, Dispenser, Milk container)',
        qty: 1,
        price: 1800,
        category: 'consumables',
      },
      { name: 'Stirrers', qty: 3, price: 105, category: 'beverages' },
      { name: 'Monthly rental charges for May', qty: 1, price: 2800, category: 'consumables' },
    ],
  },
];

async function seed() {
  console.log('🚀 Seeding real data from invoices...');

  for (const inv of INVOICES) {
    console.log(`- Processing ${inv.vendor} (${inv.invoice_no})...`);

    // Check if bill exists
    const { data: existingBill } = await supabaseAdmin
      .from('bill_uploads')
      .select('id')
      .eq('invoice_number', inv.invoice_no)
      .single();
    if (existingBill) {
      console.log(`  Skipping ${inv.invoice_no}, already exists.`);
      continue;
    }

    const { data: bill, error: billErr } = await supabaseAdmin
      .from('bill_uploads')
      .insert({
        vendor_name: inv.vendor,
        invoice_number: inv.invoice_no,
        file_url: 'https://placeholder.com/historical-invoice',
        grand_total: inv.items.reduce((acc, item) => acc + item.qty * item.price, 0),
        verification_status: 'Admin Verified',
        approval_status: 'Pending Accounts Approval',
        created_at: new Date(inv.date).toISOString(),
        verified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (billErr) {
      console.error('Error creating bill:', billErr.message);
      continue;
    }

    for (const item of inv.items) {
      // 2. Create/Get Product
      let { data: product } = await supabaseAdmin
        .from('products')
        .select()
        .eq('name', item.name)
        .maybeSingle();
      if (!product) {
        const unit = item.name.toLowerCase().includes('kg') ? 'kg' : 'pieces';
        const { data: newProd, error: prodErr } = await supabaseAdmin
          .from('products')
          .insert({
            name: item.name,
            category: item.category,
            unit: unit,
            cost_per_unit: item.price,
          })
          .select()
          .single();

        if (prodErr) {
          console.error(`Error creating product ${item.name}:`, prodErr.message);
          continue;
        }
        product = newProd;
      }

      // 3. Create Bill Item
      await supabaseAdmin.from('bill_items').insert({
        bill_id: bill.id,
        item_name: item.name,
        quantity: item.qty,
        unit_rate: item.price,
        total_amount: item.qty * item.price,
      });

      // 4. Update Inventory
      const { data: currentInv } = await supabaseAdmin
        .from('inventory')
        .select()
        .eq('product_id', product.id)
        .maybeSingle();
      const newStock = (currentInv?.current_stock || 0) + item.qty;

      await supabaseAdmin.from('inventory').upsert(
        {
          product_id: product.id,
          current_stock: newStock,
          last_updated_at: new Date().toISOString(),
        },
        { onConflict: 'product_id' }
      );

      // 5. Log Transaction
      await supabaseAdmin.from('transactions').insert({
        product_id: product.id,
        type: 'add',
        quantity: item.qty,
        unit_cost: item.price,
        total_cost: item.qty * item.price,
        notes: `Imported from Historical Invoice #${inv.invoice_no}`,
      });
    }
  }

  console.log('✅ Real Data Seeding Complete.');
}

seed();
