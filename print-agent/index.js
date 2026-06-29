/**
 * Applywizz Print Agent
 *
 * Standalone process that runs on any machine on the office LAN.
 * Listens to Supabase Realtime for order confirmations and auto-prints
 * receipts on the thermal printer (OCPP-88A, 80mm, ESC/POS via TCP).
 *
 * Usage:
 *   1. Copy .env.example → .env and fill in values
 *   2. npm install
 *   3. npm start (or use pm2: pm2 start index.js --name print-agent)
 */

import 'dotenv/config';
import net from 'node:net';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const PRINTER_IP    = process.env.PRINTER_IP || '192.168.1.100';
const PRINTER_PORT  = parseInt(process.env.PRINTER_PORT || '9100', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[print-agent] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── ESC/POS Helpers ──────────────────────────────────────────────────────────
const ESC = '\x1B';
const GS  = '\x1D';

const CMD = {
  INIT:        `${ESC}\x40`,           // Initialize printer
  CENTER:      `${ESC}\x61\x01`,       // Center alignment
  LEFT:        `${ESC}\x61\x00`,       // Left alignment
  BOLD_ON:     `${ESC}\x45\x01`,       // Bold on
  BOLD_OFF:    `${ESC}\x45\x00`,       // Bold off
  DOUBLE_ON:   `${ESC}\x21\x30`,       // Double height+width
  DOUBLE_OFF:  `${ESC}\x21\x00`,       // Normal size
  FEED:        '\n',
  CUT:         `${GS}\x56\x00`,       // Full cut
  PARTIAL_CUT: `${GS}\x56\x01`,       // Partial cut
};

const LINE  = '================================';
const DASH  = '--------------------------------';
const WIDTH = 32; // usable chars for 80mm at default font

function stripEmojis(str) {
  if (!str) return '';
  return str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
}

function getQuote(order) {
  const name = stripEmojis(order.parsed_employee_name || order.submitter_name || 'Employee');
  const item = stripEmojis(order.parsed_item || order.raw_text || 'Refreshment');

  const quotes = {
    girlfriend: [
      `You got this, love! Rooting for you from the sidelines, ${name}. 💕`,
      `Special delivery for my favorite coworker ${name}. Enjoy your ${item}! 😘`,
      `Hey handsome, made sure you get this ${item}! Miss me?`,
      `You make this office so much better, ${name}. Have a good break!`,
    ],
    boyfriend: [
      `Proud of how hard you work, ${name}. Eat/drink up! 💕`,
      `Don't stress, babe. This ${item} is coming with extra love.`,
      `Thinking of you! Take a quick break and enjoy your ${item}, ${name}.`,
      `Hey cutie, got you this ${item} to keep you going! You got this.`,
    ],
    "Mom Mode": [
      `Beta ${name}, phone side pe rakho aur garam garam ${item} piyo!`,
      `Beta ${name}, time pe khaya/piya karo aur thanda mat hone dena.`,
      `Beta ${name}, aap bohot mehnat karte ho! Thoda break le lo.`,
      `Kaam toh chalta rahega beta, health pehle! Dhyan rakhna.`,
    ],
    Funny: [
      `Refueling complete. ${name}'s brain reboot in 3... 2... 1...`,
      `Warning: ${name}'s productivity level critical. Deploying ${item}!`,
      `Error 404: Sleep not found. Restoring ${name}'s energy levels.`,
      `Pantry wisdom: Chai piyo, kaam jiyo, boss se bacho!`,
    ],
    Professional: [
      `Focus on the process, ${name}, and the results will follow.`,
      `Your dedication is appreciated. Have a productive day ahead, ${name}.`,
      `Excellence is not an act, but a habit. Keep up the great work.`,
      `Fueling the daily deliverables with a fresh ${item}.`,
    ],
    Minimal: [
      `Keep moving forward, ${name}.`,
      `Focus on what matters.`,
      `Stay consistent.`,
      `Enjoy your ${item}.`,
    ],
    Friendly: [
      `Hope this ${item} brings a smile to your face today, ${name}! 😊`,
      `Take a deep breath and enjoy your break, ${name}. You deserve it!`,
      `Wishing you a wonderful and productive day ahead!`,
      `Cheers to small moments of joy in a busy workday, ${name}!`,
    ],
  };

  const tone = order.notification_tone || 'Friendly';
  const list = quotes[tone] || quotes.Friendly;
  return stripEmojis(list[Math.floor(Math.random() * list.length)]);
}

// ── Format Receipt ───────────────────────────────────────────────────────────
function formatReceipt(order) {
  const qty = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
  const item = stripEmojis(order.parsed_item || order.raw_text || 'Unknown Item');
  const employee = stripEmojis(order.parsed_employee_name || 'Unknown');
  const location = stripEmojis(order.parsed_location || 'Not specified');
  const orderId = order.user_order_number || (order.id || '').slice(0, 8).toUpperCase();

  // Format date in IST
  const dateStr = new Date(order.created_at || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  // Parse note from instruction (remove the prefix like "Jagan needs 1x ...")
  const noteMatch = order.instruction?.match(/Note:\s*(.+?)\.?$/i);
  const note = stripEmojis(noteMatch?.[1] || '');

  const lines = [
    CMD.INIT,
    CMD.CENTER,
    CMD.BOLD_ON,
    CMD.DOUBLE_ON,
    'APPLYWIZZ',
    CMD.DOUBLE_OFF,
    'OFFICE PANTRY',
    CMD.BOLD_OFF,
    CMD.FEED,
    LINE,
    CMD.LEFT,
    `Order  #${orderId}`,
    `Date   ${dateStr}`,
    DASH,
    `${CMD.BOLD_ON}Employee${CMD.BOLD_OFF}  ${employee}`,
    `${CMD.BOLD_ON}Location${CMD.BOLD_OFF}  ${location}`,
    DASH,
    CMD.BOLD_ON,
    `  ${qty}x ${item}`,
    CMD.BOLD_OFF,
  ];

  if (note) {
    lines.push(`  Note: ${note}`);
  }

  const quote = getQuote(order);
  if (quote) {
    lines.push(
      DASH,
      CMD.CENTER,
      quote
    );
  }

  lines.push(
    DASH,
    CMD.CENTER,
    CMD.BOLD_ON,
    'DELIVER ASAP!',
    CMD.BOLD_OFF,
    LINE,
    CMD.FEED,
    CMD.FEED,
    CMD.FEED,
    CMD.PARTIAL_CUT,
  );

  return lines.join('\n');
}

// ── Night Shift Receipt Format ────────────────────────────────────────────────
// Fires when an order placed after office hours (5 PM) is auto-recorded.
// No office boy delivery — just prints for inventory/audit trail.
function formatNightReceipt(order) {
  const qty      = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
  const item     = stripEmojis(order.parsed_item || order.raw_text || 'Unknown Item');
  const employee = stripEmojis(order.parsed_employee_name || 'Unknown');
  const location = stripEmojis(order.parsed_location || 'Not specified');
  const orderId  = order.user_order_number || (order.id || '').slice(0, 8).toUpperCase();

  const dateStr = new Date(order.created_at || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const lines = [
    CMD.INIT,
    CMD.CENTER,
    CMD.BOLD_ON,
    CMD.DOUBLE_ON,
    'APPLYWIZZ',
    CMD.DOUBLE_OFF,
    'OFFICE PANTRY',
    CMD.BOLD_OFF,
    CMD.FEED,
    LINE,
    CMD.LEFT,
    `Order  #${orderId}`,
    `Date   ${dateStr}`,
    DASH,
    `${CMD.BOLD_ON}Employee${CMD.BOLD_OFF}  ${employee}`,
    `${CMD.BOLD_ON}Location${CMD.BOLD_OFF}  ${location}`,
    DASH,
    CMD.BOLD_ON,
    `  ${qty}x ${item}`,
    CMD.BOLD_OFF,
  ];

  const quote = getQuote(order);
  if (quote) {
    lines.push(
      DASH,
      CMD.CENTER,
      quote
    );
  }

  lines.push(
    DASH,
    CMD.FEED,
    CMD.CENTER,
    CMD.BOLD_ON,
    '*** NIGHT SHIFT ***',
    'RECORDED ONLY',
    CMD.BOLD_OFF,
    'No delivery - Self Pickup',
    'Applywizz Office Pantry',
    LINE,
    CMD.FEED,
    CMD.FEED,
    CMD.FEED,
    CMD.PARTIAL_CUT,
  );

  return lines.join('\n');
}

// ── Print an order receipt ────────────────────────────────────────────────────
function printReceipt(order) {
  const receipt = formatReceipt(order);
  const orderId = order.user_order_number || (order.id || '').slice(0, 8);
  return sendToPrinter(receipt, `order-#${orderId}`);
}

function formatMealToken(booking, profile, isDuplicate = false) {
  const choiceLabel = { veg: 'VEG', non_veg: 'NON-VEG', egg: 'EGG' };
  const choiceEmoji = { veg: '🥬', non_veg: '🍗', egg: '🥚' };
  const name     = stripEmojis(profile?.preferred_name || profile?.full_name || 'Employee');
  const code     = stripEmojis(profile?.employee_code  || '--');
  const cabin    = stripEmojis(booking.cabin_name      || 'Unknown Cabin');
  const token    = stripEmojis(booking.token_number    || '---');
  const mealDate = new Date(booking.meal_date + 'T00:00:00+05:30');
  const dateStr = mealDate.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const lines = [
    CMD.INIT,
    CMD.CENTER,
    CMD.BOLD_ON,
    CMD.DOUBLE_ON,
    'APPLYWIZZ',
    'MEAL TOKEN',
    CMD.DOUBLE_OFF,
    CMD.BOLD_OFF,
    CMD.FEED,
  ];

  if (isDuplicate) {
    lines.push(
      CMD.CENTER,
      CMD.BOLD_ON,
      '*** DUPLICATE TOKEN ***',
      `Reprint #${(booking.print_count || 1)}`,
      CMD.BOLD_OFF,
      CMD.FEED
    );
  }

  lines.push(
    LINE,
    CMD.LEFT,
    `Token #  ${token}`,
    `Date     ${dateStr}`,
    `Time     1:00 PM`,
    `Cabin    ${cabin}`,
    DASH,
    CMD.BOLD_ON,
    stripEmojis(`${choiceEmoji[booking.choice] || ''} ${choiceLabel[booking.choice] || booking.choice}`),
    CMD.BOLD_OFF,
    DASH,
    `Name     ${name}`,
    `Code     ${code}`,
    DASH,
    CMD.CENTER,
    `Booked at ${new Date(booking.booked_at || Date.now()).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    })}`,
    LINE,
    CMD.FEED,
    CMD.FEED,
    CMD.FEED,
    CMD.PARTIAL_CUT
  );

  return lines.join('\n');
}

// ── Send any content to printer ──────────────────────────────────────────────
function sendToPrinter(content, label, retries = 1) {
  return new Promise((resolve, reject) => {
    console.log(`[print-agent] Printing ${label} → ${PRINTER_IP}:${PRINTER_PORT}`);

    const socket = net.createConnection(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(content, 'binary', () => {
        socket.end();
        console.log(`[print-agent] ✅ Printed ${label}`);
        resolve();
      });
    });

    socket.setTimeout(5000);

    socket.on('timeout', () => {
      socket.destroy();
      if (retries > 0) {
        console.log(`[print-agent] ⏱ Timeout, retrying ${label} in 2s...`);
        setTimeout(() => sendToPrinter(content, label, retries - 1).then(resolve).catch(reject), 2000);
      } else {
        reject(new Error('Printer connection timeout'));
      }
    });

    socket.on('error', (err) => {
      if (retries > 0) {
        console.log(`[print-agent] ⚠ Error: ${err.message}, retrying ${label} in 2s...`);
        setTimeout(() => sendToPrinter(content, label, retries - 1).then(resolve).catch(reject), 2000);
      } else {
        console.error(`[print-agent] ❌ Print failed for ${label}:`, err.message);
        reject(err);
      }
    });
  });
}

// ── Supabase Realtime Subscription ───────────────────────────────────────────
function startListening() {
  console.log('[print-agent] Subscribing to order confirmations + meal bookings...');

  const channel = supabase
    .channel('print-all')
    // ── Order confirmations ──
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'requests',
      },
      async (payload) => {
        const oldStatus = payload.old?.status;
        const newStatus = payload.new?.status;
        const newLive   = payload.new?.live_status;

        // ── Daytime: confirming → pending (office hours 8:30AM–5PM) ──────────
        if (oldStatus === 'confirming' && newStatus === 'pending') {
          const order = payload.new;
          const orderId = order.user_order_number || (order.id || '').slice(0, 8);
          console.log(`[print-agent] 🔔 Order confirmed: #${orderId} — ${order.parsed_item}`);
          try {
            await printReceipt(order);
          } catch (err) {
            console.error(`[print-agent] Failed to print after retries:`, err.message);
          }
        }

        // ── Night shift: confirming → done/Recorded (after 5PM) ──────────────
        if (oldStatus === 'confirming' && newStatus === 'done' && newLive === 'Recorded') {
          const order   = payload.new;
          const orderId = order.user_order_number || (order.id || '').slice(0, 8);
          console.log(`[print-agent] 🌙 Night shift recorded: #${orderId} — ${order.parsed_item}`);
          try {
            const receipt = formatNightReceipt(order);
            await sendToPrinter(receipt, `night-#${orderId}`);
          } catch (err) {
            console.error(`[print-agent] Failed to print night receipt:`, err.message);
          }
        }
      }
    )
    // ── Meal Box: listen to meal_print_jobs INSERT ──
    // When a new print job arrives, wait until scheduled_for time, then print all tokens.
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'meal_print_jobs',
      },
      async (payload) => {
        const job = payload.new;
        if (!job || job.status !== 'pending') return;

        const scheduledFor = new Date(job.scheduled_for);
        const now          = Date.now();
        const delayMs      = Math.max(0, scheduledFor.getTime() - now);

        console.log(`[print-agent] 🍱 New print job: ${job.cabin_name} on ${job.meal_date} — ` +
          `type=${job.print_type}, delay=${Math.round(delayMs / 1000)}s`);

        setTimeout(() => executePrintJob(job), delayMs);
      }
    )
    .subscribe((status) => {
      console.log(`[print-agent] Realtime status: ${status}`);
    });

  return channel;
}

// ── Execute a meal print job ──────────────────────────────────────────────────
async function executePrintJob(job) {
  console.log(`[print-agent] ▶ Starting print job: ${job.cabin_name} (${job.print_type})`);

  // Mark as printing
  await supabase
    .from('meal_print_jobs')
    .update({ status: 'printing', started_at: new Date().toISOString() })
    .eq('id', job.id);

  try {
    let bookings = [];

    if (job.print_type === 'reprint' && job.booking_user_id) {
      // Single reprint for one employee
      const { data } = await supabase
        .from('meal_bookings')
        .select('id, user_id, choice, token_number, cabin_name, print_count, meal_date')
        .eq('user_id', job.booking_user_id)
        .eq('meal_date', job.meal_date)
        .neq('choice', 'skip')
        .maybeSingle();
      if (data) bookings = [data];
    } else {
      // Cabin batch (cabin_batch or manual_cabin)
      const { data } = await supabase
        .from('meal_bookings')
        .select('id, user_id, choice, token_number, cabin_name, print_count, meal_date')
        .eq('meal_date', job.meal_date)
        .eq('cabin_name', job.cabin_name)
        .neq('choice', 'skip')
        .order('token_number');
      bookings = data || [];
    }

    if (bookings.length === 0) {
      console.log(`[print-agent] ⚠ No bookings to print for job ${job.id}`);
      await supabase
        .from('meal_print_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString(), token_count: 0 })
        .eq('id', job.id);
      return;
    }

    // Fetch profiles for all bookings in one query
    const userIds = bookings.map(b => b.user_id).filter(Boolean);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, preferred_name, employee_code')
      .in('id', userIds);
    const profileMap = {};
    for (const p of (profiles || [])) profileMap[p.id] = p;

    // Print each token
    let printedCount = 0;
    const isDuplicate = job.print_type === 'reprint';

    for (const booking of bookings) {
      const profile = profileMap[booking.user_id] || null;
      const receipt = formatMealToken(booking, profile, isDuplicate);
      const label   = `meal-token-${booking.token_number || booking.id.slice(0, 6)}`;

      try {
        await sendToPrinter(receipt, label);
        printedCount++;

        // Update print_count on the booking only for batch prints
        // (reprint count is updated by the API route before inserting the job)
        if (!isDuplicate) {
          await supabase
            .from('meal_bookings')
            .update({
              print_count:     (booking.print_count || 0) + 1,
              last_printed_at: new Date().toISOString(),
            })
            .eq('id', booking.id);
        }
      } catch (err) {
        console.error(`[print-agent] ❌ Failed to print ${label}:`, err.message);
      }
    }

    // Mark job as completed
    await supabase
      .from('meal_print_jobs')
      .update({
        status:       'completed',
        completed_at: new Date().toISOString(),
        token_count:  printedCount,
      })
      .eq('id', job.id);

    console.log(`[print-agent] ✅ Print job done: ${job.cabin_name} — ${printedCount}/${bookings.length} tokens printed`);

  } catch (err) {
    console.error(`[print-agent] ❌ Print job failed:`, err.message);
    await supabase
      .from('meal_print_jobs')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', job.id);
  }
}


// ── Auto-confirm stuck orders (safety net) ───────────────────────────────────
// If frontend fails to call /confirm, orders stuck in 'confirming' > 60s
// should be auto-confirmed. This runs every 30s.
async function autoConfirmStuck() {
  try {
    const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: stuck } = await supabase
      .from('requests')
      .select('id, created_at')
      .eq('status', 'confirming')
      .lt('created_at', cutoff)
      .limit(10);

    if (stuck?.length) {
      console.log(`[print-agent] Found ${stuck.length} stuck confirming orders, auto-confirming...`);
      for (const order of stuck) {
        await supabase
          .from('requests')
          .update({ status: 'pending', live_status: 'placed' })
          .eq('id', order.id)
          .eq('status', 'confirming'); // double-check to avoid race
        console.log(`[print-agent] Auto-confirmed #${order.id.slice(0, 8)}`);
      }
    }
  } catch (err) {
    console.error('[print-agent] Auto-confirm check failed:', err.message);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const channel = startListening();

// Heartbeat + stuck order check
setInterval(() => {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`[print-agent] ♥ Heartbeat — ${now} — printer: ${PRINTER_IP}:${PRINTER_PORT}`);
  autoConfirmStuck();
}, 60_000);

console.log(`[print-agent] 🖨 Ready — Listening for orders, printing to ${PRINTER_IP}:${PRINTER_PORT}`);

// Graceful shutdown
function shutdown() {
  console.log('\n[print-agent] Shutting down...');
  supabase.removeChannel(channel);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
