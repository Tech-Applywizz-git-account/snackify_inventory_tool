import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

// Print agent receipt configuration logic replicated for validation
const TONE_QUOTATIONS = {
  'Mom Mode': [
    "Beta, phone side pe rakho aur garam garam piyo!",
    "Kaam toh chalta rahega beta, health pehle! Dhyan rakhna.",
    "Beta, time pe khaya karo aur thanda mat hone dena.",
    "Aap bohot mehnat karte ho beta, thoda break le lo!"
  ],
  'gen_z': [
    "This is your main character moment. Slay!",
    "Work hard, but make it look easy. No cap.",
    "Fueling your hustle. Go get that bread!",
    "Stay hydrated, stay hydrated, stay hydrated. Period."
  ],
  'Friendly': [
    "Hope this brings a smile to your face today!",
    "Take a deep breath and enjoy your break. You deserve it!",
    "Wishing you a wonderful and productive day ahead!",
    "Cheers to small moments of joy in a busy workday!"
  ]
};

function stripEmojis(str) {
  if (!str) return '';
  return str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
}

function getQuoteForTone(tone) {
  const quotes = TONE_QUOTATIONS[tone] || TONE_QUOTATIONS['Friendly'];
  const randomIndex = Math.floor(Math.random() * quotes.length);
  return quotes[randomIndex];
}

function formatMockReceipt(order) {
  const qty = 1;
  const item = stripEmojis(order.parsed_item || 'Espresso');
  const employee = stripEmojis(order.parsed_employee_name || 'Ramakrishna');
  const location = stripEmojis(order.parsed_location || 'Tech Team');
  const orderId = (order.id || 'TEST-ID').slice(0, 8).toUpperCase();
  const dateStr = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const instructionClean = stripEmojis(order.instruction || '');
  const tone = order.notification_tone || 'Friendly';
  const quote = stripEmojis(getQuoteForTone(tone));

  const LINE = '================================';
  const DASH = '--------------------------------';

  let output = [];
  output.push(LINE);
  output.push('           APPLYWIZZ            ');
  output.push('         OFFICE PANTRY          ');
  output.push(LINE);
  output.push(`Order  #${orderId}`);
  output.push(`Date   ${dateStr}`);
  output.push(DASH);
  output.push(`Employee  ${employee}`);
  output.push(`Location  ${location}`);
  output.push(DASH);
  output.push(`  ${qty}x ${item}`);
  if (instructionClean) {
    output.push(`  Note: ${instructionClean}`);
  }
  output.push(DASH);
  output.push(`  "${quote}"`);
  output.push(DASH);
  output.push('         DELIVER ASAP!          ');
  output.push(LINE);

  return output.join('\n');
}

async function simulateQuickOrder() {
  console.log('--- STARTING QUICK ORDER SIMULATION ---');
  
  // 1. Setup tone preference for Ramakrishna
  const ramakrishnaId = '25e9736a-6f4b-4ea8-9e92-b0bdd55a15af';
  console.log('Step 1: Upserting Mom Mode preference for Ramakrishna...');
  const { error: prefError } = await supabase
    .from('employee_cafeteria_preferences')
    .upsert({
      user_id: ramakrishnaId,
      notification_tone: 'Mom Mode',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (prefError) {
    console.error('Failed to set tone preference:', prefError.message);
    return;
  }
  console.log('Preference updated successfully!');

  // 2. Insert order in confirming state
  console.log('\nStep 2: Placing Quick Order for 1x Espresso ☕ to Tech Team...');
  const { data: order, error: insertError } = await supabase
    .from('requests')
    .insert({
      raw_text: '1x Espresso to Tech Team',
      category: 'beverage',
      parsed_item: 'Espresso',
      parsed_employee_name: 'Ramakrishna',
      parsed_location: 'Tech Team',
      instruction: 'Beta Ramakrishna needs 1x Espresso to Tech Team. Please deliver with love! ❤️',
      submitted_by: ramakrishnaId,
      live_status: 'confirming',
      status: 'confirming',
      delivery_mode: 'get_it_here'
    })
    .select()
    .single();

  if (insertError) {
    console.error('Failed to place order:', insertError.message);
    return;
  }
  console.log(`Order placed successfully in confirming state: ID = ${order.id}`);

  // 3. 30-Second Countdown timer
  console.log('\nStep 3: Waiting 30 seconds for confirmation window... (Simulating Cancel Window)');
  for (let i = 30; i > 0; i--) {
    process.stdout.write(`⏱ Time remaining: ${i}s... \r`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\nCancel window expired. Moving to confirmation!');

  // 4. Update order to pending (placed)
  console.log('\nStep 4: Confirming the order in database...');
  const { error: confirmError } = await supabase
    .from('requests')
    .update({
      status: 'pending',
      live_status: 'placed'
    })
    .eq('id', order.id);

  if (confirmError) {
    console.error('Failed to confirm order:', confirmError.message);
    return;
  }
  console.log('Order successfully confirmed!');

  // 5. Query order using database view to check joined tone column
  console.log('\nStep 5: Fetching order via v_request_queue to verify joined tone...');
  const { data: fetchedOrder, error: fetchError } = await supabase
    .from('v_request_queue')
    .select('*')
    .eq('id', order.id)
    .single();

  if (fetchError) {
    console.error('Failed to fetch from view:', fetchError.message);
    return;
  }
  console.log(`Successfully fetched from view!`);
  console.log(`Joined Notification Tone: "${fetchedOrder.notification_tone}"`);

  // 6. Print Mockup
  console.log('\nStep 6: Generating formatted receipt output (Emoji-stripped)...');
  const printOutput = formatMockReceipt(fetchedOrder);
  console.log('\n--- SIMULATED RECEIPT OUTPUT ---');
  console.log(printOutput);
  console.log('--------------------------------');

  console.log('\nQuick Order Simulation verified successfully!');
}

simulateQuickOrder().catch(console.error);
