import 'dotenv/config';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PRINTER_IP    = process.env.PRINTER_IP || '192.168.1.100';
const PRINTER_PORT  = parseInt(process.env.PRINTER_PORT || '9100', 10);
const PRINTER_NAME  = process.env.PRINTER_NAME || '58mm Series Printer';

const ESC = '\x1B';
const GS  = '\x1D';

const CMD = {
  INIT:        `${ESC}\x40`,
  CENTER:      `${ESC}\x61\x01`,
  LEFT:        `${ESC}\x61\x00`,
  BOLD_ON:     `${ESC}\x45\x01`,
  BOLD_OFF:    `${ESC}\x45\x00`,
  DOUBLE_ON:   `${ESC}\x21\x30`,
  DOUBLE_OFF:  `${ESC}\x21\x00`,
  FEED:        '\n',
  CUT:         `${GS}\x56\x00`,
};

const LINE  = '================================';

const content = [
  CMD.INIT,
  CMD.CENTER,
  CMD.BOLD_ON,
  CMD.DOUBLE_ON,
  'TEST PRINT',
  CMD.DOUBLE_OFF,
  'SUCCESS',
  CMD.BOLD_OFF,
  CMD.FEED,
  LINE,
  CMD.LEFT,
  'Printer Name: ' + (process.env.PRINTER_NAME || PRINTER_NAME),
  'Time:         ' + new Date().toLocaleString(),
  LINE,
  CMD.FEED,
  CMD.FEED,
  CMD.FEED,
  CMD.CUT
].join('\n');

const isLanIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(PRINTER_IP) && !PRINTER_IP.endsWith('.0');

if (process.platform === 'win32' && (!isLanIp || process.env.PRINTER_NAME)) {
  const pName = process.env.PRINTER_NAME || PRINTER_NAME || '58mm Series Printer';
  console.log(`Sending test print via Windows Spooler to: ${pName}...`);
  try {
    const tempFile = path.join(__dirname, 'temp_test.bin');
    fs.writeFileSync(tempFile, Buffer.from(content, 'binary'));

    const psScriptPath = path.join(__dirname, 'test_print.ps1');
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
            DOCINFOA di = new DOCINFOA { pDocName = "ApplyWizz Test", pOutputFile = null, pDatatype = "RAW" };
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
[RawPrinterHelper]::SendBytesToPrinter('${pName}', $bytes)
`;

    fs.writeFileSync(psScriptPath, psScript, 'utf8');

    exec(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, (err) => {
      try { fs.unlinkSync(tempFile); } catch {}
      try { fs.unlinkSync(psScriptPath); } catch {}

      if (err) {
        console.error('❌ Spooler error:', err.message);
      } else {
        console.log('✅ Test receipt sent successfully!');
      }
    });
  } catch (err) {
    console.error('❌ Windows printing setup error:', err.message);
  }
} else {
  console.log(`Sending test print to ${PRINTER_IP}:${PRINTER_PORT}...`);
  const socket = net.createConnection(PRINTER_PORT, PRINTER_IP, () => {
    socket.write(content, 'binary', () => {
      socket.end();
      console.log('✅ Test receipt sent successfully!');
    });
  });

  socket.setTimeout(5000);
  socket.on('timeout', () => {
    socket.destroy();
    console.error('❌ Timeout connecting to printer. Check printer IP/connection.');
  });

  socket.on('error', (err) => {
    console.error('❌ Error sending to printer:', err.message);
  });
}
