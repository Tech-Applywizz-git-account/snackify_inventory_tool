// ============================================================
//  ApplyWizz Office Pantry - Auto Receipt Print Agent
//  Runs on the Office PC, watches Supabase, prints on order
// ============================================================

const { createClient }                 = require('@supabase/supabase-js');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const fs                               = require('fs');
const path                             = require('path');
const { exec }                         = require('child_process');

// -- Config ----------------------------------------------------
const SUPABASE_URL = 'https://twmadauhauuypioznpus.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3bWFkYXVoYXV1eXBpb3pucHVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Mzk1MCwiZXhwIjoyMDk0MzE1NTUwfQ.0zDhGqnWUZAMHaR8rcPc1OkPHjpwWbKQy3SRoCwJGYk';
const PRINTER_NAME = '58mm Series Printer';
const POLL_SECONDS = 10;
const PRINTED_LOG  = path.join(__dirname, 'printed.json');

// -- Supabase client ------------------------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// -- Load already-printed order IDs from disk -----------------
let printedIds = new Set();
if (fs.existsSync(PRINTED_LOG)) {
  try {
    const saved = JSON.parse(fs.readFileSync(PRINTED_LOG, 'utf8'));
    printedIds = new Set(saved);
    console.log(`Loaded ${printedIds.size} previously printed orders`);
  } catch {
    // Ignore corrupt file.
  }
}

function savePrinted() {
  fs.writeFileSync(PRINTED_LOG, JSON.stringify([...printedIds]));
}

// -- Receipt helpers ------------------------------------------
function stripEmojis(str) {
  if (!str) return '';
  return String(str).replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
}

function formatReceiptDate(iso) {
  return new Date(iso || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day:      '2-digit',
    month:    'short',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
  });
}

function getOrderNumber(order) {
  return order.user_order_number || (order.id || '').slice(0, 8).toUpperCase();
}

function getQty(order) {
  return parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
}

function getEmployeeName(order) {
  return stripEmojis(
    order.parsed_employee_name ||
    order.submitter_name ||
    order.full_name ||
    'Unknown'
  );
}

function getQuote(order) {
  const name = getEmployeeName(order);
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

// -- Print one order receipt ----------------------------------
async function printReceipt(order) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: 'dummy',
    characterSet: 'PC437_USA',
    removeSpecialCharacters: false,
    lineCharacter: '=',
  });

  const isNightShift = order.status === 'done' && order.live_status === 'Recorded';

  const orderId  = getOrderNumber(order);
  const qty      = getQty(order);
  const item     = stripEmojis(order.parsed_item || order.raw_text || 'Unknown Item');
  const employee = getEmployeeName(order);
  const location = stripEmojis(order.parsed_location || 'Not specified');
  const dateStr  = formatReceiptDate(order.created_at);
  const note     = stripEmojis(order.instruction || '');
  const quote    = getQuote(order);

  // Header
  printer.alignCenter();
  printer.drawLine();
  printer.bold(true);
  printer.setTextSize(1, 1);
  printer.println('APPLYWIZZ');
  printer.setTextSize(0, 0);
  printer.println('OFFICE PANTRY');
  printer.bold(false);
  printer.drawLine();

  // Order details
  printer.alignLeft();
  printer.println(`Order  #${orderId}`);
  printer.println(`Date   ${dateStr}`);
  printer.drawLine();
  printer.println(`Employee  ${employee}`);
  printer.println(`Location  ${location}`);
  printer.drawLine();

  // Item and note
  printer.bold(true);
  printer.println(`  ${qty}x ${item}`);
  printer.bold(false);

  if (note) {
    printer.println(`  Note: ${note}`);
  }

  // Tone quote
  if (quote) {
    printer.drawLine();
    printer.alignCenter();
    printer.println(`"${quote}"`);
  }

  // Footer
  printer.drawLine();
  printer.alignCenter();

  if (isNightShift) {
    printer.newLine();
    printer.bold(true);
    printer.println('*** NIGHT SHIFT ***');
    printer.println('RECORDED ONLY');
    printer.bold(false);
    printer.println('No delivery - Self Pickup');
    printer.println('Applywizz Office Pantry');
  } else {
    printer.bold(true);
    printer.println('DELIVER ASAP!');
    printer.bold(false);
  }

  printer.drawLine();
  printer.newLine();
  printer.newLine();
  printer.cut();

  // Print using Windows Spooler API via PowerShell
  try {
    const buffer = printer.getBuffer();
    const tempFile = path.join(__dirname, 'temp_print.bin');
    fs.writeFileSync(tempFile, buffer);

    const psScriptPath = path.join(__dirname, 'print.ps1');
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
[RawPrinterHelper]::SendBytesToPrinter('${PRINTER_NAME}', $bytes)
`;

    fs.writeFileSync(psScriptPath, psScript, 'utf8');

    return new Promise((resolve) => {
      exec(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, (err) => {
        try { fs.unlinkSync(tempFile); } catch {}
        try { fs.unlinkSync(psScriptPath); } catch {}

        if (err) {
          console.error(`Print error: ${err.message}`);
          resolve(false);
        } else {
          console.log(`Printed: #${orderId} ${item} for ${employee} (${isNightShift ? 'NIGHT SHIFT' : 'DAY SHIFT'})`);
          resolve(true);
        }
      });
    });
  } catch (err) {
    console.error(`Spooling error: ${err.message}`);
    return false;
  }
}

// -- Poll Supabase for new orders -----------------------------
async function checkOrders() {
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await supabase
    .from('v_request_queue')
    .select('*')
    .in('status', ['pending', 'done'])
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Supabase error:', error.message);
    return;
  }

  const fresh = (orders || []).filter(o => {
    if (printedIds.has(o.id)) return false;
    if (o.status === 'pending') return true;
    if (o.status === 'done' && o.live_status === 'Recorded') return true;
    return false;
  });

  if (fresh.length > 0) {
    console.log(`${fresh.length} new order(s) to print`);
  }

  for (const order of fresh) {
    const success = await printReceipt(order);
    if (success) {
      printedIds.add(order.id);
      savePrinted();
    }
  }
}

// -- Start -----------------------------------------------------
console.log('');
console.log('ApplyWizz Print Agent');
console.log('----------------------------------');
console.log(`Polling Supabase every ${POLL_SECONDS}s`);
console.log(`Printer Name: ${PRINTER_NAME}`);
console.log('----------------------------------');
console.log('');

checkOrders();
setInterval(checkOrders, POLL_SECONDS * 1000);
