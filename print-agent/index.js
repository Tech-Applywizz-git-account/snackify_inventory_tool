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
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_RECEIPT_DESIGN,
  clampReceiptText,
  loadReceiptDesign,
  receiptLine,
  normalizeReceiptDesign,
} from '../office-print-gateway/receiptDesign.js';
import { receiptBrandLines } from './receiptBrand.js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const PRINTER_IP    = process.env.PRINTER_IP || '192.168.1.100';
const PRINTER_PORT  = parseInt(process.env.PRINTER_PORT || '9100', 10);
const PRINTER_NAME  = process.env.PRINTER_NAME || '58mm Series Printer';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[print-agent] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
let receiptDesign = normalizeReceiptDesign(DEFAULT_RECEIPT_DESIGN);
let receiptDesignLoadedAt = 0;

async function getReceiptDesign() {
  if (Date.now() - receiptDesignLoadedAt > 15000) {
    receiptDesign = await loadReceiptDesign(supabase, receiptDesign);
    receiptDesignLoadedAt = Date.now();
  }
  return receiptDesign;
}

function receiptEnding(design) {
  const cut = design.cut_mode === 'full'
    ? CMD.CUT
    : design.cut_mode === 'partial'
      ? CMD.PARTIAL_CUT
      : '';
  return [...Array(design.feed_lines).fill(CMD.FEED), cut];
}

function customLabelLines(design, position) {
  if (!design.custom_label.enabled || !design.custom_label.text || design.custom_label.position !== position) return [];
  return [
    CMD.CENTER,
    design.custom_label.bold ? CMD.BOLD_ON : CMD.BOLD_OFF,
    ...clampReceiptText(design.custom_label.text, design),
    CMD.BOLD_OFF,
  ];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PRINTED_LOG = path.join(__dirname, 'printed.json');

let printedIds = new Set();
let printedOrderNumbers = new Set();
let printingOrderNumbers = new Set();

if (fs.existsSync(PRINTED_LOG)) {
  try {
    const saved = JSON.parse(fs.readFileSync(PRINTED_LOG, 'utf8'));
    if (Array.isArray(saved)) {
      for (const value of saved) {
        const key = String(value);
        if (key.startsWith('order:')) {
          printedOrderNumbers.add(key.slice(6));
        } else {
          printedIds.add(key);
        }
      }
    }
    console.log(
      `[print-agent] Loaded ${printedIds.size} previously printed orders + ` +
      `${printedOrderNumbers.size} previously printed order numbers`
    );
  } catch {
    // Ignore corrupt file.
  }
}

function savePrinted() {
  try {
    const saved = [
      ...printedIds,
      ...[...printedOrderNumbers].map((orderNumber) => `order:${orderNumber}`),
    ];
    fs.writeFileSync(PRINTED_LOG, JSON.stringify(saved), 'utf8');
  } catch (err) {
    console.error('[print-agent] Failed to save printed.json:', err.message);
  }
}

function getOrderNumber(order) {
  return String(
    order?.user_order_number ||
    order?.order_number ||
    (order?.id || '').slice(0, 8)
  ).trim().toUpperCase();
}

function claimOrderForPrinting(order) {
  const orderNumber = getOrderNumber(order);
  if (!orderNumber) return null;

  if (
    printedOrderNumbers.has(orderNumber) ||
    printingOrderNumbers.has(orderNumber) ||
    (order?.id && printedIds.has(order.id))
  ) {
    return null;
  }

  printingOrderNumbers.add(orderNumber);
  return orderNumber;
}

function releaseOrderPrintClaim(orderNumber) {
  if (orderNumber) printingOrderNumbers.delete(orderNumber);
}

function istDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentIstDayBounds() {
  const today = istDateString();
  const start = new Date(`${today}T00:00:00+05:30`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { today, start: start.toISOString(), end: end.toISOString() };
}

function isCurrentIstDay(dateValue) {
  return istDateString(new Date(dateValue || 0)) === istDateString();
}

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
  const name = stripEmojis(order.parsed_employee_name || order.submitter_name || order.full_name || 'Employee');
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

function isGuestBookedOrder(order) {
  const notes = String(order?.notes || '').trim();
  const normalized = notes.toUpperCase();
  return normalized === 'GUEST_BOOKED' || normalized.startsWith('GUEST_BOOKED:');
}

// ── Format Receipt ───────────────────────────────────────────────────────────
function formatReceipt(order, design) {
  const isGuestBooked = isGuestBookedOrder(order);
  const line = receiptLine(design);
  const dash = receiptLine(design, '-');
  const qty = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
  const item = stripEmojis(order.parsed_item || order.raw_text || 'Unknown Item');
  const employee = isGuestBooked ? 'GUEST' : stripEmojis(order.parsed_employee_name || order.submitter_name || order.full_name || 'Unknown');
  const location = stripEmojis(order.parsed_location || 'Not specified');
  const baseOrderId = order.user_order_number || (order.id || '').slice(0, 8).toUpperCase();
  const orderId = isGuestBooked
    ? (String(baseOrderId).toUpperCase().startsWith('GUEST') ? baseOrderId : `GUEST-${baseOrderId}`)
    : baseOrderId;

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

  const note = stripEmojis(order.instruction || '');

  const itemLines = [];
  if (order.raw_text && order.raw_text.includes(',')) {
    order.raw_text.split(',').forEach((part) => {
      const match = part.trim().match(/^(\d+)x\s*(.+)$/);
      if (match) {
        let name = match[2].trim();
        const breadIdx = name.indexOf(' [bread:');
        if (breadIdx !== -1) {
          name = name.slice(0, breadIdx).trim();
        }
        itemLines.push(`  ${match[1]}x ${name}`);
      } else {
        itemLines.push(`  1x ${part.trim()}`);
      }
    });
  } else {
    itemLines.push(`  ${qty}x ${item}`);
  }

  const lines = [
    CMD.INIT,
    CMD.CENTER,
    ...customLabelLines(design, 'before_header'),
    CMD.BOLD_ON,
    CMD.DOUBLE_ON,
    design.header,
    CMD.DOUBLE_OFF,
    design.subheader,
    CMD.BOLD_OFF,
    CMD.FEED,
    line,
    ...customLabelLines(design, 'after_header'),
    CMD.LEFT,
    design.context.order_number ? `Order  #${orderId}` : null,
    design.context.date ? `Date   ${dateStr}` : null,
    ...receiptBrandLines(order),
    dash,
    isGuestBooked && design.context.guest_marker ? `${CMD.BOLD_ON}Type     GUEST BOOKED${CMD.BOLD_OFF}` : null,
    design.context.employee ? `${CMD.BOLD_ON}Employee${CMD.BOLD_OFF}  ${employee}` : null,
    design.context.location ? `${CMD.BOLD_ON}Location${CMD.BOLD_OFF}  ${location}` : null,
    dash,
    CMD.BOLD_ON,
    ...(design.context.item ? itemLines : []),
    CMD.BOLD_OFF,
  ];

  const charged = Number(order.tokens_charged) || 0;
  if (charged > 0) {
    lines.push(
      dash,
      `${CMD.BOLD_ON}Tokens${CMD.BOLD_OFF}  ${charged}`,
    );
  }

  if (note && design.context.note) {
    lines.push(`  Note: ${note}`);
  }

  const quote = isGuestBooked ? '' : getQuote(order);
  if (quote) {
    lines.push(
      dash,
      CMD.CENTER,
      quote
    );
  }

  lines.push(
    dash,
    CMD.CENTER,
    CMD.BOLD_ON,
    design.footer,
    CMD.BOLD_OFF,
    ...customLabelLines(design, 'before_footer'),
    line,
    ...receiptEnding(design),
  );

  return lines.filter((value) => value !== null && value !== undefined).join('\n');
}

// ── Night Shift Receipt Format ────────────────────────────────────────────────
// Fires when an order placed after office hours (5 PM) is auto-recorded.
// No office boy delivery — just prints for inventory/audit trail.
function formatNightReceipt(order, design) {
  const line = receiptLine(design);
  const dash = receiptLine(design, '-');
  const isGuestBooked = isGuestBookedOrder(order);
  const qty      = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
  const item     = stripEmojis(order.parsed_item || order.raw_text || 'Unknown Item');
  const employee = isGuestBooked ? 'GUEST' : stripEmojis(order.parsed_employee_name || 'Unknown');
  const location = stripEmojis(order.parsed_location || 'Not specified');
  const baseOrderId = order.user_order_number || (order.id || '').slice(0, 8).toUpperCase();
  const orderId  = isGuestBooked
    ? (String(baseOrderId).toUpperCase().startsWith('GUEST') ? baseOrderId : `GUEST-${baseOrderId}`)
    : baseOrderId;

  const dateStr = new Date(order.created_at || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const itemLines = [];
  if (order.raw_text && order.raw_text.includes(',')) {
    order.raw_text.split(',').forEach((part) => {
      const match = part.trim().match(/^(\d+)x\s*(.+)$/);
      if (match) {
        let name = match[2].trim();
        const breadIdx = name.indexOf(' [bread:');
        if (breadIdx !== -1) {
          name = name.slice(0, breadIdx).trim();
        }
        itemLines.push(`  ${match[1]}x ${name}`);
      } else {
        itemLines.push(`  1x ${part.trim()}`);
      }
    });
  } else {
    itemLines.push(`  ${qty}x ${item}`);
  }

  const lines = [
    CMD.INIT,
    CMD.CENTER,
    ...customLabelLines(design, 'before_header'),
    CMD.BOLD_ON,
    CMD.DOUBLE_ON,
    design.header,
    CMD.DOUBLE_OFF,
    design.subheader,
    CMD.BOLD_OFF,
    CMD.FEED,
    line,
    ...customLabelLines(design, 'after_header'),
    CMD.LEFT,
    design.context.order_number ? `Order  #${orderId}` : null,
    design.context.date ? `Date   ${dateStr}` : null,
    ...receiptBrandLines(order),
    dash,
    isGuestBooked && design.context.guest_marker ? `${CMD.BOLD_ON}Type     GUEST BOOKED${CMD.BOLD_OFF}` : null,
    design.context.employee ? `${CMD.BOLD_ON}Employee${CMD.BOLD_OFF}  ${employee}` : null,
    design.context.location ? `${CMD.BOLD_ON}Location${CMD.BOLD_OFF}  ${location}` : null,
    dash,
    CMD.BOLD_ON,
    ...(design.context.item ? itemLines : []),
    CMD.BOLD_OFF,
  ];

  const quote = isGuestBooked ? '' : getQuote(order);
  if (quote) {
    lines.push(
      dash,
      CMD.CENTER,
      quote
    );
  }

  lines.push(
    dash,
    CMD.FEED,
    CMD.CENTER,
    CMD.BOLD_ON,
    '*** NIGHT SHIFT ***',
    'RECORDED ONLY',
    CMD.BOLD_OFF,
    'No delivery - Self Pickup',
    design.footer,
    ...customLabelLines(design, 'before_footer'),
    line,
    ...receiptEnding(design),
  );

  return lines.filter((value) => value !== null && value !== undefined).join('\n');
}

// ── Print an order receipt ────────────────────────────────────────────────────
async function printReceipt(order) {
  const receipt = formatReceipt(order, await getReceiptDesign());
  const orderId = order.user_order_number || (order.id || '').slice(0, 8);
  return sendToPrinter(receipt, `order-#${orderId}`);
}

function formatMealToken(booking, profile, isDuplicate = false, design) {
  const line = receiptLine(design);
  const dash = receiptLine(design, '-');
  const choiceLabel = { veg: 'VEG', non_veg: 'NON-VEG', egg: 'EGG' };
  const choiceEmoji = { veg: '🥬', non_veg: '🍗', egg: '🥚' };
  const name     = stripEmojis(booking.is_guest && booking.guest_name
    ? booking.guest_name
    : profile?.full_name || 'Employee');
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
    ...customLabelLines(design, 'before_header'),
    CMD.BOLD_ON,
    CMD.DOUBLE_ON,
    design.meal_header,
    design.meal_subheader,
    CMD.DOUBLE_OFF,
    CMD.BOLD_OFF,
    CMD.FEED,
    ...customLabelLines(design, 'after_header'),
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
    line,
    CMD.LEFT,
    design.context.order_number ? `Token #  ${token}` : null,
    design.context.date ? `Date     ${dateStr}` : null,
    `Time     1:00 PM`,
    `Cabin    ${cabin}`,
    dash,
    booking.is_guest ? 'GUEST BOOKED' : null,
    CMD.BOLD_ON,
    stripEmojis(`${choiceEmoji[booking.choice] || ''} ${choiceLabel[booking.choice] || booking.choice}`),
    booking.onion_slices && booking.onion_slices !== 'no onion' ? `Onion    ${booking.onion_slices.toUpperCase()}` : null,
    CMD.BOLD_OFF,
    dash,
    design.context.employee ? `Name     ${name}` : null,
    design.context.employee ? `Code     ${code}` : null,
    design.context.tokens && booking.tokens_charged ? `Tokens   ${booking.tokens_charged}` : null,
    dash,
    CMD.CENTER,
    `Booked at ${new Date(booking.booked_at || Date.now()).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    })}`,
    line,
    ...customLabelLines(design, 'before_footer'),
    design.footer,
    ...receiptEnding(design)
  );

  return lines.filter((l) => l !== null && l !== undefined).join('\n');
}

function printViaWindowsSpooler(content, label, printerName) {
  return new Promise((resolve, reject) => {
    console.log(`[print-agent] Printing ${label} via Windows Spooler → ${printerName}`);
    try {
      const tempFile = path.join(__dirname, `temp_print_${Date.now()}.bin`);
      fs.writeFileSync(tempFile, Buffer.from(content, 'binary'));

      const psScriptPath = path.join(__dirname, `print_${Date.now()}.ps1`);
      const psScript = `
$code = @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [DllImport("winspool.drv", CharSet = CharSet.Ansi, SetLastError = true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA pDocInfo);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        public string pDocName;
        public string pOutputFile;
        public string pDatatype;
    }
    public static void SendBytesToPrinter(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
            DOCINFOA di = new DOCINFOA { pDocName = "ApplyWizz Receipt", pOutputFile = null, pDatatype = "RAW" };
            if (StartDocPrinter(hPrinter, 1, di)) {
                StartPagePrinter(hPrinter);
                IntPtr pBytes = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, pBytes, bytes.Length);
                int dwWritten;
                WritePrinter(hPrinter, pBytes, bytes.Length, out dwWritten);
                Marshal.FreeCoTaskMem(pBytes);
                EndPagePrinter(hPrinter);
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
    }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
$bytes = [System.IO.File]::ReadAllBytes('${tempFile.replace(/\\/g, '\\\\')}')
[RawPrinterHelper]::SendBytesToPrinter('${printerName}', $bytes)
`;

      fs.writeFileSync(psScriptPath, psScript, 'utf8');

      exec(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, (err) => {
        try { fs.unlinkSync(tempFile); } catch {}
        try { fs.unlinkSync(psScriptPath); } catch {}

        if (err) {
          console.error(`[print-agent] Spooler error: ${err.message}`);
          reject(err);
        } else {
          console.log(`[print-agent] ✅ Spooled successfully: ${label}`);
          resolve();
        }
      });
    } catch (err) {
      console.error(`[print-agent] Windows printing setup error: ${err.message}`);
      reject(err);
    }
  });
}

// ── Send any content to printer ──────────────────────────────────────────────
function sendToPrinter(content, label, retries = 1) {
  const isLanIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(PRINTER_IP) && !PRINTER_IP.endsWith('.0');
  
  if (process.platform === 'win32' && (!isLanIp || process.env.PRINTER_NAME)) {
    const pName = process.env.PRINTER_NAME || PRINTER_NAME || '58mm Series Printer';
    return printViaWindowsSpooler(content, label, pName);
  }

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

function getPrinterLabel() {
  if (process.env.PRINTER_NAME) return `spooler:${process.env.PRINTER_NAME}`;
  return `${PRINTER_IP}:${PRINTER_PORT}`;
}

async function printOrderReceipt(order, { night = false, source = 'realtime' } = {}) {
  if (!isCurrentIstDay(order.created_at)) {
    console.log(`[print-agent] Skipping historical pantry order ${order.id}`);
    return;
  }

  // Regular cafeteria orders are printed through token_usage queue. If a token
  // has already been marked as printed/printing, skip duplicates; otherwise allow
  // the normal request flow to print once.
  if (order.token_usage_id && source !== 'token_usage') {
    try {
      const { data: usage } = await supabase
        .from('token_usage')
        .select('print_status')
        .eq('id', order.token_usage_id)
        .maybeSingle();

      if (usage && ['printed', 'printing'].includes(usage.print_status)) {
        return;
      }
    } catch (err) {
      console.error('[print-agent] Failed to check token_usage status before printing:', err.message);
    }
  }

  const orderId = getOrderNumber(order);
  const printClaim = claimOrderForPrinting(order);
  if (!printClaim) {
    console.log(`[print-agent] ⏭ Skipping duplicate/already-printing order #${orderId}`);
    return;
  }

  const label = night ? `night-#${orderId}` : `order-#${orderId}`;

  console.log(`[print-agent] 🔔 ${night ? 'Night shift recorded' : 'Order confirmed'} (${source}): #${orderId} — ${order.parsed_item || order.raw_text || 'order'}`);

  try {
    if (night) {
      const receipt = formatNightReceipt(order, await getReceiptDesign());
      await sendToPrinter(receipt, label);
    } else {
      await printReceipt(order);
    }

    if (order.id) printedIds.add(order.id);
    printedOrderNumbers.add(printClaim);
    savePrinted();
    releaseOrderPrintClaim(printClaim);
    if (order.token_usage_id) {
      await supabase.from('token_usage').update({
        print_status: 'printed',
        printed_at: new Date().toISOString(),
        print_error: null,
      }).eq('id', order.token_usage_id);
    }
    console.log(`[print-agent] ✅ Printed ${label}`);
  } catch (err) {
    releaseOrderPrintClaim(printClaim);
    console.error(`[print-agent] Failed to print ${label}:`, err.message);
    if (order.token_usage_id) {
      await supabase.from('token_usage').update({
        print_status: 'failed',
        print_retryable: true,
        print_error: err.message,
      }).eq('id', order.token_usage_id);
    }
  }
}

async function loadReceiptOrder(order) {
  if (!order?.id || isGuestBookedOrder(order)) return order;
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('id', order.id)
    .maybeSingle();
  if (error || !data) return order;
  return data;
}

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
        const order     = payload.new;

        // Daytime: confirming -> pending. Do not rely on payload.old; Supabase may
        // omit old row values unless REPLICA IDENTITY FULL is enabled.
        const becamePending =
          newStatus === 'pending' &&
          (oldStatus === 'confirming' || oldStatus == null);

        if (becamePending) {
          await printOrderReceipt(await loadReceiptOrder(order), { source: 'realtime' });
        }

        const becameRecorded =
          newStatus === 'done' &&
          newLive === 'Recorded' &&
          (oldStatus === 'confirming' || oldStatus == null);

        if (becameRecorded) {
          await printOrderReceipt(await loadReceiptOrder(order), { night: true, source: 'realtime' });
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'token_usage' },
      async (payload) => {
        const row = payload.new;
        if (!row || row.print_status !== 'pending') return;
        if (row.print_retryable === false) return;
        await drainTokenUsagePrints();
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

// ── Meal token duplicate protection ───────────────────────────────────────────
// Normal 11 AM batch printing is at-most-once per booking/token for a meal date.
// We use the existing meal_bookings.print_count column as the persistent claim.
// The claim is made BEFORE sending the receipt to the printer, which prevents a
// second job/restart from printing the same token again after an uncertain print.
// Explicit reprint jobs bypass this protection by design.
async function claimMealBookingForPrint(booking) {
  const { data: claimed, error } = await supabase
    .from('meal_bookings')
    .update({
      print_count: 1,
      last_printed_at: new Date().toISOString(),
    })
    .eq('id', booking.id)
    .eq('meal_date', booking.meal_date)
    .eq('cabin_name', booking.cabin_name)
    .eq('print_count', 0)
    .select('id, print_count, last_printed_at')
    .maybeSingle();

  if (error) {
    console.error(`[print-agent] Failed to claim meal token ${booking.token_number || booking.id}:`, error.message);
    return false;
  }

  if (!claimed) {
    console.log(`[print-agent] ⏭ Skipping already printed/claimed meal token #${booking.token_number || booking.id}`);
    return false;
  }

  return true;
}

async function rollbackMealBookingClaim(booking) {
  // Only roll back our initial claim. If another process has already changed the
  // count, leave it alone so we never accidentally erase a legitimate reprint.
  await supabase
    .from('meal_bookings')
    .update({
      print_count: 0,
      last_printed_at: null,
    })
    .eq('id', booking.id)
    .eq('print_count', 1);
}

async function claimMealPrintJob(job) {
  const { data: claimed, error } = await supabase
    .from('meal_print_jobs')
    .update({ status: 'printing', started_at: new Date().toISOString() })
    .eq('id', job.id)
    .in('status', ['pending', 'failed'])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(`[print-agent] Failed to claim meal print job ${job.id}:`, error.message);
    return false;
  }

  if (!claimed) {
    console.log(`[print-agent] Skipping already claimed meal print job ${job.id}`);
    return false;
  }

  return true;
}

async function executePrintJob(job) {

  console.log(`[print-agent] ▶ Starting print job: ${job.cabin_name} (${job.print_type})`);

  if (!(await claimMealPrintJob(job))) return;

  try {
    let bookings = [];

    if (job.print_type === 'reprint' && job.booking_user_id) {
      // Single reprint for one employee
      const { data } = await supabase
        .from('meal_bookings')
        .select('id, user_id, choice, token_number, cabin_name, print_count, meal_date, onion_slices, tokens_charged, booked_at, is_guest, guest_name')
        .eq('user_id', job.booking_user_id)
        .eq('meal_date', job.meal_date)
        .neq('choice', 'skip')
        .maybeSingle();
      if (data) bookings = [data];
    } else {
      // Cabin batch (cabin_batch or manual_cabin)
      const { data } = await supabase
        .from('meal_bookings')
        .select('id, user_id, choice, token_number, cabin_name, print_count, meal_date, onion_slices, tokens_charged, booked_at, is_guest, guest_name')
        .eq('meal_date', job.meal_date)
        .eq('cabin_name', job.cabin_name)
        .neq('choice', 'skip')
        .order('token_number');
      bookings = data || [];

      if (bookings.length > 0) {
        const { data: preferences } = await supabase
          .from('employee_cafeteria_preferences')
          .select('user_id, shift')
          .in('user_id', bookings.map((booking) => booking.user_id).filter(Boolean));
        const nightShiftUserIds = new Set(
          (preferences || [])
            .filter((preference) => preference.shift === 'night')
            .map((preference) => preference.user_id)
        );
        bookings = bookings.filter((booking) => !nightShiftUserIds.has(booking.user_id));
      }
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

    // For normal 11 AM cabin batches, de-duplicate by token number in the
    // fetched data as an additional safety check. Reprints intentionally bypass it.
    const seenTokens = new Set();

    for (const booking of bookings) {
      const tokenKey = String(booking.token_number || booking.id || '').trim().toUpperCase();

      if (!isDuplicate && tokenKey && seenTokens.has(tokenKey)) {
        console.log(`[print-agent] ⏭ Skipping duplicate meal token #${tokenKey}`);
        continue;
      }
      if (!isDuplicate && tokenKey) seenTokens.add(tokenKey);

      // Explicit reprints are allowed to print even when print_count > 0.
      // Normal 11 AM printing must successfully claim an unprinted booking first.
      if (!isDuplicate) {
        const claimed = await claimMealBookingForPrint(booking);
        if (!claimed) continue;
      }

      const profile = profileMap[booking.user_id] || null;
      const receipt = formatMealToken(booking, profile, isDuplicate, await getReceiptDesign());
      const label   = `meal-token-${booking.token_number || booking.id.slice(0, 6)}`;

      try {
        await sendToPrinter(receipt, label);
        printedCount++;

        // Reprints increment the existing count exactly as before.
        if (isDuplicate) {
          await supabase
            .from('meal_bookings')
            .update({
              print_count: (booking.print_count || 0) + 1,
              last_printed_at: new Date().toISOString(),
            })
            .eq('id', booking.id);
        }
      } catch (err) {
        // For a normal print, the claim is rolled back only when this attempt
        // definitely failed. If the process dies after the printer accepted the
        // data, the claim remains, preventing an accidental duplicate.
        if (!isDuplicate) {
          await rollbackMealBookingClaim(booking);
        }
        console.error(`[print-agent] ❌ Failed to print ${label}:`, err.message);
      }
    }

    const expectedPrintCount = isDuplicate
      ? bookings.length
      : new Set(
          bookings
            .map((booking) => String(booking.token_number || booking.id || '').trim().toUpperCase())
            .filter(Boolean)
        ).size;

    if (printedCount < expectedPrintCount) {
      await supabase
        .from('meal_print_jobs')
        .update({
          status: 'failed',
          retryable: true,
          error_message: `Printed ${printedCount}/${bookings.length}`,
          token_count: printedCount,
        })
        .eq('id', job.id);
      console.log(`[print-agent] ⚠ Print job partial: ${job.cabin_name} — ${printedCount}/${bookings.length}`);
      return;
    }

    await supabase
      .from('meal_print_jobs')
      .update({
        status:       'completed',
        completed_at: new Date().toISOString(),
        token_count:  printedCount,
        retryable: false,
      })
      .eq('id', job.id);

    console.log(`[print-agent] ✅ Print job done: ${job.cabin_name} — ${printedCount}/${bookings.length} tokens printed`);

  } catch (err) {
    console.error(`[print-agent] ❌ Print job failed:`, err.message);
    await supabase
      .from('meal_print_jobs')
      .update({ status: 'failed', retryable: true, error_message: err.message })
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

// ── Auto-print any missed pending orders (startup & safety net) ──────────────
async function printUnprintedPendingOrders() {
  try {
    // Only replay recent missed orders. This prevents a restart from reprinting
    // the entire morning queue when printed.json was deleted or the agent was down.
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: pendingOrders, error } = await supabase
      .from('requests')
      .select('*')
      .eq('status', 'pending')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const unprinted = (pendingOrders || []).filter((order) => {
      const orderNumber = getOrderNumber(order);
      return !printedIds.has(order.id) &&
             !printedOrderNumbers.has(orderNumber) &&
             !printingOrderNumbers.has(orderNumber);
    });
    if (unprinted.length === 0) return;

    console.log(`[print-agent] Found ${unprinted.length} recent unprinted pending orders...`);
    for (const order of unprinted) {
      await printOrderReceipt(order, { source: 'poll' });
    }
  } catch (err) {
    console.error('[print-agent] Failed to check missed pending orders:', err.message);
  }
}

// ── Auto-print any missed pending meal print jobs (startup & safety net) ──────
async function printUnprintedPendingMealJobs() {
  try {
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      .toISOString()
      .slice(0, 10);

    const { data: pendingJobs, error } = await supabase
      .from('meal_print_jobs')
      .select('*')
      .in('status', ['pending', 'failed'])
      .eq('meal_date', today)
      .or('retryable.is.null,retryable.eq.true');

    if (error) throw error;

    if (pendingJobs && pendingJobs.length > 0) {
      console.log(`[print-agent] Found ${pendingJobs.length} pending meal print jobs for today, executing...`);
      for (const job of pendingJobs) {
        // Execute immediately on startup
        await executePrintJob(job);
      }
    }
  } catch (err) {
    console.error('[print-agent] Failed to check missed pending meal jobs:', err.message);
  }
}

async function probePrinter() {
  const isLanIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(PRINTER_IP) && !PRINTER_IP.endsWith('.0');
  if (process.platform === 'win32' && (!isLanIp || process.env.PRINTER_NAME)) {
    return true;
  }
  return new Promise((resolve) => {
    const socket = net.createConnection(PRINTER_PORT, PRINTER_IP);
    const done = (ok) => {
      try { socket.destroy(); } catch {}
      resolve(ok);
    };
    socket.setTimeout(3000);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

let printerHealthy = true;

async function drainTokenUsagePrints() {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('token_usage')
      .select('*')
      .in('print_status', ['pending', 'failed'])
      .eq('print_retryable', true)
      .eq('reason', 'spend')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(25);
    if (error) throw error;
    if (!rows?.length) return;

    for (const row of rows) {
      const { data: claimed } = await supabase
        .from('token_usage')
        .update({
          print_status: 'printing',
          print_claimed_at: new Date().toISOString(),
          print_attempts: (row.print_attempts || 0) + 1,
        })
        .eq('id', row.id)
        .in('print_status', ['pending', 'failed'])
        .select()
        .maybeSingle();
      if (!claimed) continue;

      let order = null;
      if (row.ref_type === 'request' && row.ref_id) {
        const { data } = await supabase.from('requests').select('*').eq('id', row.ref_id).maybeSingle();
        order = data;
      }
      if (!order) {
        await supabase.from('token_usage').update({
          print_status: 'failed',
          print_retryable: false,
          print_error: 'Missing source order',
        }).eq('id', row.id);
        continue;
      }

      try {
        await printOrderReceipt(
          { ...order, tokens_charged: Math.abs(row.tokens_delta), token_usage_id: row.id },
          { source: 'token_usage' },
        );
      } catch (err) {
        await supabase.from('token_usage').update({
          print_status: 'failed',
          print_retryable: true,
          print_error: err.message,
        }).eq('id', row.id);
      }
    }
  } catch (err) {
    console.error('[print-agent] token_usage drain failed:', err.message);
  }
}

async function checkPrinterAndDrain() {
  const ok = await probePrinter();
  if (ok && !printerHealthy) {
    console.log('[print-agent] Printer recovered — draining pending / failed receipts');
    await supabase
      .from('token_usage')
      .update({ print_status: 'pending', print_claimed_at: null })
      .eq('print_status', 'failed')
      .eq('print_retryable', true);
    await supabase
      .from('meal_print_jobs')
      .update({ status: 'pending', claimed_at: null })
      .eq('status', 'failed')
      .eq('retryable', true);
  }
  printerHealthy = ok;
  if (ok) {
    await drainTokenUsagePrints();
    await printUnprintedPendingMealJobs();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const channel = startListening();

// Pull and print all pending orders and meal jobs on startup
printUnprintedPendingOrders().catch((err) => console.error('[print-agent] Startup missed print check failed:', err.message));
printUnprintedPendingMealJobs().catch((err) => console.error('[print-agent] Startup missed meal check failed:', err.message));
drainTokenUsagePrints().catch((err) => console.error('[print-agent] Startup token print drain failed:', err.message));

setInterval(() => {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`[print-agent] ♥ Heartbeat — ${now} — printer: ${getPrinterLabel()} healthy=${printerHealthy}`);
  autoConfirmStuck();
  printUnprintedPendingOrders().catch((err) => console.error('[print-agent] Interval missed print check failed:', err.message));
  checkPrinterAndDrain().catch((err) => console.error('[print-agent] Interval printer drain failed:', err.message));
}, 15_000);

console.log(`[print-agent] 🖨 Ready — Listening for orders, printing to ${getPrinterLabel()}`);

// Graceful shutdown
function shutdown() {
  console.log('\n[print-agent] Shutting down...');
  supabase.removeChannel(channel);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

