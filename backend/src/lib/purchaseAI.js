/**
 * Purchase AI — Classification, extraction, and auto-approval logic
 * for Telegram Manual Purchase Intelligence.
 *
 * Uses the existing openai.js wrapper (chatCompletion + visionCompletion).
 */

import { chatCompletion, visionCompletion } from './openai.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const AUTO_APPROVAL_LIMITS = {
  leadership: 5000,
  facility_manager: 2000,
  office_boy: 500,
};

export const ALLOWED_SUBMITTERS = ['office_boy', 'leadership'];

export const ALLOWED_AUTO_CATEGORIES = [
  'Pantry Food',
  'Beverages',
  'Cleaning Supplies',
  'Office Supplies',
  'Maintenance',
];

export const BLOCKED_AUTO_CATEGORIES = [
  'Employee Accessories',
  'Electronics',
  'Personal Items',
  'Other',
  'Unknown',
];

export const ALL_CATEGORIES = [...ALLOWED_AUTO_CATEGORIES, ...BLOCKED_AUTO_CATEGORIES];

// ── Classify a Telegram message ──────────────────────────────────────────────
// Returns: 'invoice_bill' | 'manual_no_invoice_purchase' | 'payment_screenshot'
//        | 'item_photo' | 'personal_or_irrelevant' | 'unclear'

export async function classifyTelegramMessage(text, hasPhoto, hasDocument) {
  // Fast path: PDF/document → almost certainly an invoice
  if (hasDocument) return 'invoice_bill';

  // Fast path: no text and no photo → nothing to do
  if (!text && !hasPhoto) return 'unclear';

  // Text-based heuristics (cheap, no AI call needed)
  const lower = (text || '').toLowerCase();

  // Strong invoice indicators
  if (/invoice|bill\s*no|gst|gstin|tax\s*invoice/i.test(lower)) {
    return 'invoice_bill';
  }

  // Strong manual purchase indicators
  const purchaseKeywords =
    /bought|kharida|liya|purchase|no\s*bill|bina\s*bill|local\s*shop|market\s*se|₹|rs\.\s*\d|rupees?\s*\d/i;
  if (purchaseKeywords.test(lower)) {
    return 'manual_no_invoice_purchase';
  }

  // Photo only, no text → treat as manual purchase; vision AI in the pipeline will read the image
  if (hasPhoto && !text) {
    return 'manual_no_invoice_purchase';
  }

  // Text only, no strong signals → use AI
  if (text && !purchaseKeywords.test(lower)) {
    try {
      const { content } = await chatCompletion({
        system: `You classify Telegram messages sent to an office supply bot.
Return ONLY one of these values (no quotes, no explanation):
invoice_bill
manual_no_invoice_purchase
payment_screenshot
personal_or_irrelevant
unclear`,
        user: `Message: "${text}"\nHas photo: ${hasPhoto}`,
        model: 'gpt-4o-mini',
        temperature: 0.1,
      });
      const result = content
        .trim()
        .toLowerCase()
        .replace(/[^a-z_]/g, '');
      if (
        [
          'invoice_bill',
          'manual_no_invoice_purchase',
          'payment_screenshot',
          'personal_or_irrelevant',
          'unclear',
        ].includes(result)
      ) {
        return result;
      }
    } catch (e) {
      console.error('[PurchaseAI] classify error:', e.message);
    }
    return 'unclear';
  }

  return 'manual_no_invoice_purchase';
}

// ── Extract purchase details from text + images ──────────────────────────────

const EXTRACTION_PROMPT = `You are an office purchase extraction assistant.
The user (an office boy, facility manager, or leader) has submitted a local purchase
WITHOUT a formal invoice. They may send text, a payment app screenshot (PhonePe/GPay/Paytm),
and/or a photo of the item bought.

Extract these fields from whatever is available. Return ONLY valid JSON:

{
  "item_name": "string — COMMON name only: Bread, Milk, Oil, Sugar. NOT the brand. NOT pack size.",
  "brand_name": "string or null — brand name only if clearly visible: Modern, Amul, Fortune, Tata",
  "quantity": number or null,
  "unit": "g|kg|ml|L|pieces|packets — use g for solid weight, ml for liquid volume, pieces for countable items",
  "amount": number — total amount paid (MUST be a number, not string),
  "vendor_name": "string or null — shop name if visible",
  "payment_method": "PhonePe|GPay|Paytm|Cash|Unknown",
  "payment_reference": "string or null — UPI/transaction reference if visible",
  "purchase_date": "YYYY-MM-DD or null",
  "category": "one of: Pantry Food, Beverages, Cleaning Supplies, Office Supplies, Maintenance, Employee Accessories, Electronics, Personal Items, Other, Unknown",
  "confidence_score": number between 0 and 1,
  "clarification_needed": boolean,
  "clarification_question": "string or null — what to ask the user if details are missing"
}

Rules:
- item_name must be a simple common noun: "Bread" not "Modern Atta Bread 400g". "Milk" not "Amul Full Cream Milk 500ml".
- brand_name is separate: if packet shows "Amul Milk", item_name="Milk", brand_name="Amul".
- unit detection: if product is solid (bread, biscuits, flour), use g or kg. If liquid (milk, juice, oil), use ml or L. If countable (eggs, pens), use pieces.
- If amount is not visible in text or screenshot, set clarification_needed=true and ask for amount.
- If item is unclear, ask what the item is.
- Read payment app screenshots carefully for amount, UPI reference, and date.
- Do NOT guess amounts. If unsure, ask.
- For Indian purchases, assume INR.`;

export async function extractManualPurchase(text, imageUrls) {
  const userParts = [];

  if (text) {
    userParts.push({ type: 'text', text: `Message from office staff: "${text}"` });
  }

  for (const url of imageUrls || []) {
    userParts.push({
      type: 'image_url',
      image_url: { url, detail: 'high' },
    });
  }

  if (userParts.length === 0) {
    return {
      confidence_score: 0,
      clarification_needed: true,
      clarification_question:
        'No text or images received. Please describe what you bought and the amount.',
    };
  }

  try {
    // Use vision completion for multi-modal (text + image)
    // visionCompletion signature: { system, user: string, imageUrl: string }
    if (imageUrls?.length) {
      const userText = text
        ? `Message from office staff: "${text}"`
        : 'Extract purchase details from this photo of the item.';

      const { content } = await visionCompletion({
        system: EXTRACTION_PROMPT,
        user: userText,
        imageUrl: imageUrls[0],
        model: 'gpt-4o',
        temperature: 0.1,
      });

      const cleaned = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      return JSON.parse(cleaned);
    }

    // Text-only extraction
    const { content } = await chatCompletion({
      system: EXTRACTION_PROMPT,
      user: `Message from office staff: "${text}"`,
      model: 'gpt-4o-mini',
      temperature: 0.1,
    });

    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[PurchaseAI] extract error:', e.message);
    return {
      item_name: text || null,
      confidence_score: 0,
      clarification_needed: true,
      clarification_question:
        'I could not understand this purchase. Please describe the item, amount, and payment method.',
    };
  }
}

// ── Auto-approval decision ───────────────────────────────────────────────────

export function checkAutoApproval({
  senderRole,
  amount,
  category,
  confidence,
  hasProof,
  duplicateRisk,
}) {
  const reasons = [];

  // Must be a trusted submitter
  if (!ALLOWED_SUBMITTERS.includes(senderRole)) {
    return { approved: false, reason: 'Sender role is not authorized for auto-approval' };
  }

  // Check amount limit
  const limit = AUTO_APPROVAL_LIMITS[senderRole] || 0;
  if (!amount || amount <= 0) {
    return { approved: false, reason: 'Amount is missing or zero' };
  }
  if (amount > limit) {
    return { approved: false, reason: `Amount exceeds ${senderRole} limit` };
  }
  reasons.push(`Amount within ${senderRole} limit`);

  // Check category
  if (!category || BLOCKED_AUTO_CATEGORIES.includes(category)) {
    return {
      approved: false,
      reason: `Category "${category || 'Unknown'}" is not eligible for auto-approval`,
    };
  }
  if (!ALLOWED_AUTO_CATEGORIES.includes(category)) {
    return { approved: false, reason: `Category "${category}" is not in the allowed list` };
  }
  reasons.push(`Category "${category}" is allowed`);

  // Check AI confidence
  if (!confidence || confidence < 0.8) {
    return {
      approved: false,
      reason: `AI confidence ${((confidence || 0) * 100).toFixed(0)}% is below 80% threshold`,
    };
  }
  reasons.push(`AI confidence ${(confidence * 100).toFixed(0)}%`);

  // Check proof
  if (!hasProof) {
    return { approved: false, reason: 'No payment proof or item photo provided' };
  }
  reasons.push('Proof available');

  // Check duplicate risk
  if (duplicateRisk) {
    return { approved: false, reason: 'Possible duplicate detected' };
  }

  return {
    approved: true,
    reason: `Auto-approved: ${reasons.join(', ')}`,
  };
}

// ── Duplicate detection ──────────────────────────────────────────────────────

export async function detectDuplicate(supabase, { telegramChatId, amount, paymentReference }) {
  // Check 1: Same payment reference
  if (paymentReference) {
    const { data } = await supabase
      .from('manual_purchases')
      .select('id, item_name, amount')
      .eq('payment_reference', paymentReference)
      .limit(1)
      .maybeSingle();

    if (data) {
      return { isDuplicate: true, reason: `Same payment reference already exists` };
    }
  }

  // Check 2: Same sender + same amount within 30 minutes
  if (telegramChatId && amount) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data } = await supabase
      .from('manual_purchases')
      .select('id, item_name, amount')
      .eq('telegram_chat_id', telegramChatId)
      .eq('amount', amount)
      .gte('created_at', thirtyMinAgo)
      .limit(1)
      .maybeSingle();

    if (data) {
      return { isDuplicate: true, reason: `Same sender sent same amount within last 30 minutes` };
    }
  }

  return { isDuplicate: false, reason: null };
}

// ── Parse user correction text during step-by-step confirmation ───────────────
// fieldType: 'item_name' | 'quantity' | 'amount'
// Returns an object with the corrected field(s), or null if unparseable.

export function parseUserCorrection(fieldType, text) {
  const clean = (text || '').trim();
  if (!clean) return null;

  if (fieldType === 'item_name') {
    return { item_name: clean };
  }

  if (fieldType === 'quantity') {
    const match = clean.match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|L|pieces?|packets?|units?)?/i);
    if (!match) return null;
    const unit = (match[2] || 'pieces').toLowerCase().replace(/s$/, '');
    return { quantity: parseFloat(match[1]), unit };
  }

  if (fieldType === 'amount') {
    const digits = clean.replace(/[₹rRsS\s,]/g, '').match(/\d+(?:\.\d+)?/);
    return digits ? { amount: parseFloat(digits[0]) } : null;
  }

  return null;
}
