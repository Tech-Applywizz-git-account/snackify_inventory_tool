import { Router } from 'express';
import multer from 'multer';
import { fileCompletion, fileUrlCompletion, visionCompletion } from '../lib/openai.js';
import { processInvoiceItems, saveConversions } from '../lib/productConversion.js';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const EXTRACTION_SYSTEM = `You are an Office Bill, Inventory, and Expense Extraction Assistant.
Extract only visible bill details. Do not guess missing values.
Return JSON only with vendor_name, bill_date, invoice_number, items, delivery_charges,
discount, grand_total, payment_status, confidence_score, needs_manual_review, and
manual_review_reason. Mark needs_manual_review true if any important value is unclear.`;

const DUPLICATE_MESSAGES = [
  'Bhai, ye bill pehle se system mein hai. Ek hi bill se do baar stock update nahi hoga.',
  'Waah, same bill dobara? System ne pakad liya. Duplicate blocked.',
  'Overacting ke 50 rupay kaat. Ye invoice already uploaded hai.',
  'Duplicate bill detected. Pantry stock ko double count nahi karne denge.',
];

function cleanJson(content) {
  return content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function safeName(name = 'bill') {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
}

async function uploadFile(file) {
  const path = `power-automate/${Date.now()}-${safeName(file.originalname)}`;
  const { error } = await supabaseAdmin.storage.from('bills').upload(path, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from('bills').getPublicUrl(path);
  return data.publicUrl;
}

async function findDuplicate(parsed) {
  if (!parsed?.invoice_number) return null;
  let q = supabaseAdmin
    .from('bill_uploads')
    .select('id, vendor_name, invoice_number, grand_total')
    .eq('invoice_number', parsed.invoice_number);

  if (parsed.vendor_name) q = q.ilike('vendor_name', parsed.vendor_name);

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function saveBill({ parsed, fileUrl }) {
  const { data: bill, error: billErr } = await supabaseAdmin
    .from('bill_uploads')
    .insert({
      vendor_name: parsed.vendor_name || null,
      bill_date: parsed.bill_date || null,
      invoice_number: parsed.invoice_number || null,
      uploaded_by_name: 'Power Automate',
      file_url: fileUrl,
      extraction_status: parsed.extraction_status || 'Extracted',
      verification_status: parsed.verification_status || 'Pending Admin Verification',
      approval_status: parsed.approval_status || 'Pending Accounts Approval',
      grand_total: normalizeNumber(parsed.grand_total),
      delivery_charges: normalizeNumber(parsed.delivery_charges) || 0,
      discount: normalizeNumber(parsed.discount) || 0,
      confidence_score: normalizeNumber(parsed.confidence_score),
      needs_manual_review: Boolean(parsed.needs_manual_review),
      manual_review_reason: parsed.manual_review_reason || null,
    })
    .select()
    .single();

  if (billErr) throw billErr;

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (items.length) {
    const rows = items.map((item) => ({
      bill_id: bill.id,
      item_name: item.item_name || 'Unknown item',
      category: item.category || null,
      quantity: normalizeNumber(item.quantity) || 0,
      unit: item.unit || null,
      unit_rate: normalizeNumber(item.unit_rate),
      tax: normalizeNumber(item.tax) || 0,
      total_amount: normalizeNumber(item.total_amount),
      inventory_action: item.inventory_action || null,
    }));

    const { data: insertedItems, error: itemsErr } = await supabaseAdmin
      .from('bill_items')
      .insert(rows)
      .select('id, item_name, quantity, unit');
    if (itemsErr) throw itemsErr;

    // Run conversion matching (non-blocking)
    const savedItems = insertedItems || [];
    processInvoiceItems(savedItems)
      .then((conversions) => saveConversions(savedItems, conversions))
      .catch(() => {});
  }

  return bill;
}

async function extractPdf({ file, fileUrl }) {
  if (file) {
    return fileCompletion({
      system: EXTRACTION_SYSTEM,
      user: 'Extract the details from this PDF vendor bill.',
      fileBuffer: file.buffer,
      filename: file.originalname || 'bill.pdf',
      mimeType: file.mimetype || 'application/pdf',
      model: 'gpt-4o',
    });
  }

  return fileUrlCompletion({
    system: EXTRACTION_SYSTEM,
    user: 'Extract the details from this PDF vendor bill.',
    fileUrl,
    model: 'gpt-4o',
  });
}

router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const expectedKey = process.env.BILL_WEBHOOK_KEY || 'app_wizz_secure_782';
    if (req.query.key !== expectedKey) {
      return res.status(401).json({ ok: false, error: 'Invalid webhook key' });
    }

    const fileUrl = req.file ? await uploadFile(req.file) : req.body?.file_url;
    if (!fileUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Missing bill file',
        message: 'Send multipart field "file" or JSON field "file_url".',
      });
    }

    const isPdf = req.file?.mimetype === 'application/pdf' || /\.pdf($|\?)/i.test(fileUrl);
    if (isPdf) {
      const { content, model } = await extractPdf({ file: req.file, fileUrl });
      const parsed = JSON.parse(cleanJson(content));

      const duplicate = await findDuplicate(parsed);
      if (duplicate) {
        const roast = DUPLICATE_MESSAGES[Math.floor(Math.random() * DUPLICATE_MESSAGES.length)];
        return res.json({
          ok: false,
          error: 'Duplicate Bill Detected',
          duplicate_bill_id: duplicate.id,
          vendor_name: duplicate.vendor_name,
          invoice_number: duplicate.invoice_number,
          grand_total: duplicate.grand_total,
          message: `Duplicate Bill Detected\nVendor: ${duplicate.vendor_name || '-'}\nInvoice: #${duplicate.invoice_number || '-'}\n\n${roast}`,
        });
      }

      const bill = await saveBill({ parsed, fileUrl });
      return res.json({
        ok: true,
        bill_id: bill.id,
        vendor_name: bill.vendor_name,
        invoice_number: bill.invoice_number,
        grand_total: bill.grand_total,
        needs_manual_review: bill.needs_manual_review,
        model,
        message: `PDF bill processed successfully. Vendor: ${bill.vendor_name || '-'}, Invoice: #${bill.invoice_number || '-'}, Total: ${bill.grand_total || '-'}. Sent for Admin verification.`,
      });
    }

    const { content, model } = await visionCompletion({
      system: EXTRACTION_SYSTEM,
      user: 'Extract the details from this bill image.',
      imageUrl: fileUrl,
    });

    const parsed = JSON.parse(cleanJson(content));
    const duplicate = await findDuplicate(parsed);
    if (duplicate) {
      const roast = DUPLICATE_MESSAGES[Math.floor(Math.random() * DUPLICATE_MESSAGES.length)];
      return res.json({
        ok: false,
        error: 'Duplicate Bill Detected',
        duplicate_bill_id: duplicate.id,
        vendor_name: duplicate.vendor_name,
        invoice_number: duplicate.invoice_number,
        grand_total: duplicate.grand_total,
        message: `Duplicate Bill Detected\nVendor: ${duplicate.vendor_name || '-'}\nInvoice: #${duplicate.invoice_number || '-'}\n\n${roast}`,
      });
    }

    const bill = await saveBill({ parsed, fileUrl });
    return res.json({
      ok: true,
      bill_id: bill.id,
      vendor_name: bill.vendor_name,
      invoice_number: bill.invoice_number,
      grand_total: bill.grand_total,
      needs_manual_review: bill.needs_manual_review,
      model,
      message: `Bill processed successfully. Vendor: ${bill.vendor_name || '-'}, Invoice: #${bill.invoice_number || '-'}, Total: ${bill.grand_total || '-'}. Sent for Admin verification.`,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
