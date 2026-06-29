import { Router } from 'express';
import { applyPurchaseToInventory } from '../lib/applyPurchase.js';
import { fileCompletion, visionCompletion } from '../lib/openai.js';
import { normalizeName } from '../lib/productConversion.js';
import {
  ALLOWED_SUBMITTERS,
  checkAutoApproval,
  classifyTelegramMessage,
  detectDuplicate,
  extractManualPurchase,
  parseUserCorrection,
} from '../lib/purchaseAI.js';
import { applyStockTake, discardStockTake, runStockTake } from '../lib/stockTake.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { postBillToTeams } from '../lib/teams.js';

const router = Router();

// Prevent same Telegram update from being processed twice
const recentUpdates = new Map();
function isDuplicate(updateId) {
  if (!updateId) return false;
  if (recentUpdates.has(updateId)) return true;
  recentUpdates.set(updateId, Date.now());
  setTimeout(() => recentUpdates.delete(updateId), 10 * 60 * 1000);
  return false;
}

// ── Manual purchase message buffer ───────────────────────────────────────────
// Groups text + photos from the same chat within a 2-minute window.
// Handles the pattern: user sends text first, then immediately sends a photo.
const messageBuffer = new Map();

// Tracks step-by-step confirmation state per chat (in-memory, lost on restart)
// chatId → { purchaseId, step, waitingFor, replyTo }
const confirmationState = new Map();

function bufferMessage(chatId, { text, photoFileId, replyTo, messageId }) {
  if (!messageBuffer.has(chatId)) {
    messageBuffer.set(chatId, { texts: [], photoFileIds: [], replyTo, firstMsgId: messageId });
  }
  const group = messageBuffer.get(chatId);
  if (text) group.texts.push(text);
  if (photoFileId) group.photoFileIds.push(photoFileId);

  // Reset timer on each new message — fires 2 min after the LAST message
  if (group.timerId) clearTimeout(group.timerId);
  group.timerId = setTimeout(
    () => {
      messageBuffer.delete(chatId);
      processBufferedPurchase(chatId, group).catch((e) =>
        console.error('[ManualPurchase] process error:', e.message)
      );
    },
    2 * 60 * 1000
  );
}

async function processBufferedPurchase(chatId, group) {
  const combinedText = group.texts.join('\n').trim();
  const replyTo = group.replyTo;

  // 1. Look up registered sender
  const { data: mapping } = await supabaseAdmin
    .from('telegram_user_map')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (!mapping) {
    await sendTelegramMessage(
      chatId,
      '❌ You are not registered. Send /register <your@company.com> to link your account.',
      replyTo
    );
    return;
  }

  // 2. Load profile for role + name
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, full_name')
    .eq('id', mapping.user_id)
    .maybeSingle();

  const senderRole = profile?.role;
  const senderName = profile?.full_name;

  if (!ALLOWED_SUBMITTERS.includes(senderRole)) {
    await sendTelegramMessage(
      chatId,
      '❌ Your role is not authorised to submit manual purchases.',
      replyTo
    );
    return;
  }

  // 3. Upload buffered photos → get public URLs
  const photoUrls = [];
  for (const fileId of group.photoFileIds) {
    try {
      const buf = await downloadTelegramFile(fileId);
      const url = await uploadFile({
        buffer: buf,
        fileName: `purchase-${chatId}-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
      });
      photoUrls.push(url);
    } catch (e) {
      console.error('[ManualPurchase] photo upload error:', e.message);
    }
  }

  // 4. AI extraction
  const extracted = await extractManualPurchase(combinedText, photoUrls);

  // 5. If AI extracted nothing at all, ask user to describe manually
  if (!extracted.item_name && !extracted.quantity && !extracted.amount) {
    await sendTelegramMessage(
      chatId,
      `❓ Could not read this image clearly.\n\nPlease type what you bought:\n"Item name, weight, price"\n\nExample: Bread, 400g, ₹60`,
      replyTo
    );
    return;
  }

  // 6. Save as pending_confirmation — awaiting step-by-step confirmation
  const { data: savedPurchase, error: saveError } = await supabaseAdmin
    .from('manual_purchases')
    .insert({
      telegram_chat_id: String(chatId),
      telegram_message_ids: [String(group.firstMsgId)],
      raw_telegram_text: combinedText,
      sender_user_id: mapping.user_id,
      sender_name: senderName,
      sender_role: senderRole,
      item_name: extracted.item_name,
      brand_name: extracted.brand_name || null,
      quantity: extracted.quantity,
      unit: extracted.unit,
      amount: extracted.amount,
      vendor_name: extracted.vendor_name,
      payment_method: extracted.payment_method,
      payment_reference: extracted.payment_reference,
      purchase_date: extracted.purchase_date,
      category: extracted.category,
      payment_screenshot_url: photoUrls[0] || null,
      item_photo_url: photoUrls[1] || null,
      ai_extracted_json: extracted,
      ai_confidence: extracted.confidence_score,
      status: 'pending_confirmation',
      confirmation_step: 'step_1',
      duplicate_risk: false,
    })
    .select('id')
    .single();

  if (saveError || !savedPurchase) {
    console.error(
      '[ManualPurchase] DB insert error:',
      saveError?.message,
      '|',
      saveError?.details,
      '|',
      saveError?.hint
    );
    await sendTelegramMessage(chatId, '❌ Could not save purchase. Please try again.', replyTo);
    return;
  }

  // 7. Store confirmation state and send Step 1
  confirmationState.set(String(chatId), {
    purchaseId: savedPurchase.id,
    step: 1,
    waitingFor: null,
    replyTo,
  });

  await sendConfirmationStep(chatId, 1, savedPurchase.id, extracted.item_name, replyTo);
}

async function sendConfirmationStep(chatId, step, purchaseId, value, replyTo) {
  const stepConfig = {
    1: {
      label: 'Item Name',
      emoji: '📦',
      prefix: '',
      fieldKey: 'item_name',
      prompt: 'Type the item name\n\nExample: Bread',
    },
    2: {
      label: 'Weight / Volume',
      emoji: '⚖️',
      prefix: '',
      fieldKey: 'quantity',
      prompt: 'Type the weight or volume\n\nExample: 400g  or  1L  or  6 pieces',
    },
    3: {
      label: 'Price Paid',
      emoji: '💰',
      prefix: '₹',
      fieldKey: 'amount',
      prompt: 'Type the price you paid\n\nExample: 60',
    },
  };
  const { label, emoji, prefix, fieldKey, prompt } = stepConfig[step];
  const hasValue = value != null && String(value).trim() !== '' && value !== 'null';

  if (!hasValue) {
    // Value missing — skip Yes/No, directly ask the user to type it
    const state = confirmationState.get(String(chatId)) || {};
    confirmationState.set(String(chatId), { ...state, waitingFor: fieldKey });
    await sendTelegramMessage(
      chatId,
      `Step ${step} of 3 · ${label}\n\n${emoji} ${prompt}`,
      replyTo
    );
    return;
  }

  // Value detected — show with Yes / No buttons
  const displayValue = prefix ? `${prefix}${value}` : value;
  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Yes', callback_data: `c${step}_yes:${purchaseId}` },
        { text: '✏️ No, correct it', callback_data: `c${step}_no:${purchaseId}` },
      ],
    ],
  };
  await sendTelegramMessage(
    chatId,
    `Step ${step} of 3 · ${label}\n\n${emoji} ${displayValue}\n\nIs this correct?`,
    replyTo,
    keyboard
  );
}

async function handleCallbackQuery(callbackQuery) {
  const chatId = String(callbackQuery.message?.chat?.id);
  const data = callbackQuery.data || '';
  const queryId = callbackQuery.id;
  const replyTo = callbackQuery.message?.message_id;

  await answerCallbackQuery(queryId);

  // ── Photo stock-take: Confirm / Discard ──────────────────────────────────
  const stMatch = data.match(/^st_(confirm|discard):(.+)$/);
  if (stMatch) {
    const stAction = stMatch[1];
    const stockTakeId = stMatch[2];

    const profile = await getProfileForChat(chatId);
    if (!profile || !STOCKTAKE_APPROVERS.includes(profile.role)) {
      await sendTelegramMessage(
        chatId,
        '❌ Only facility managers or leadership can confirm a stock-take.',
        replyTo
      );
      return;
    }

    if (stAction === 'discard') {
      const r = await discardStockTake(supabaseAdmin, { stockTakeId, confirmedBy: profile.userId });
      await sendTelegramMessage(
        chatId,
        r.alreadyDone
          ? 'ℹ️ This stock-take was already processed.'
          : '🗑 Stock-take discarded. Nothing changed.',
        replyTo
      );
      return;
    }

    const result = await applyStockTake(supabaseAdmin, {
      stockTakeId,
      confirmedBy: profile.userId,
    });
    await sendTelegramMessage(
      chatId,
      result.alreadyDone
        ? 'ℹ️ This stock-take was already processed.'
        : `✅ Stock-take applied — ${result.applied} item(s) adjusted${result.skipped ? `, ${result.skipped} unchanged` : ''}.`,
      replyTo
    );
    return;
  }

  const match = data.match(/^c([123])_(yes|no):(.+)$/);
  if (!match) return;

  const step = parseInt(match[1], 10);
  const action = match[2];
  const purchaseId = match[3];

  const state = confirmationState.get(chatId);
  if (!state || state.purchaseId !== purchaseId) return;

  if (action === 'yes') {
    if (step < 3) {
      const nextStep = step + 1;
      const { data: purchase } = await supabaseAdmin
        .from('manual_purchases')
        .select('item_name, quantity, unit, amount')
        .eq('id', purchaseId)
        .single();

      await supabaseAdmin
        .from('manual_purchases')
        .update({ confirmation_step: `step_${nextStep}` })
        .eq('id', purchaseId);

      confirmationState.set(chatId, { ...state, step: nextStep, waitingFor: null });

      const qtyDisplay =
        purchase.quantity != null ? `${purchase.quantity}${purchase.unit || ''}` : null;
      const values = [null, purchase.item_name, qtyDisplay, purchase.amount];
      await sendConfirmationStep(chatId, nextStep, purchaseId, values[nextStep], replyTo);
    } else {
      await finalisePurchase(chatId, purchaseId, state.replyTo);
      confirmationState.delete(chatId);
    }
  } else {
    const fieldMap = { 1: 'item_name', 2: 'quantity', 3: 'amount' };
    const prompts = {
      1: '📦 What is the correct item name?\n\nType it (e.g. "Milk")',
      2: '⚖️ What is the correct weight or volume?\n\nType it (e.g. "500g" or "1L")',
      3: '💰 What did you actually pay?\n\nType the amount (e.g. "55")',
    };
    confirmationState.set(chatId, { ...state, waitingFor: fieldMap[step] });
    await sendTelegramMessage(chatId, prompts[step], replyTo);
  }
}

async function finalisePurchase(chatId, purchaseId, replyTo) {
  const { data: purchase } = await supabaseAdmin
    .from('manual_purchases')
    .select('*')
    .eq('id', purchaseId)
    .single();

  if (!purchase) return;

  const approval = checkAutoApproval({
    senderRole: purchase.sender_role,
    amount: purchase.amount,
    category: purchase.category,
    confidence: purchase.ai_confidence,
    hasProof: !!(purchase.item_photo_url || purchase.payment_screenshot_url),
    duplicateRisk: false,
  });

  const dupeCheck = await detectDuplicate(supabaseAdmin, {
    telegramChatId: chatId,
    amount: purchase.amount,
    paymentReference: purchase.payment_reference,
  });

  const isClear = approval.approved && !dupeCheck.isDuplicate;

  await supabaseAdmin
    .from('manual_purchases')
    .update({
      status: isClear ? 'auto_approved' : 'pending_review',
      confirmation_step: 'done',
      auto_approval_reason: approval.reason,
      duplicate_risk: dupeCheck.isDuplicate,
      duplicate_reason: dupeCheck.reason,
    })
    .eq('id', purchaseId);

  // Clear purchase → push straight to inventory + finance (no web step needed).
  // Duplicate / unclear → stays 'pending_review' for leadership/finance to review.
  let syncedOk = false;
  if (isClear) {
    try {
      await applyPurchaseToInventory(purchase, { writeFinance: true });
      await supabaseAdmin
        .from('manual_purchases')
        .update({
          synced_to_inventory: true,
          synced_to_finance: true,
          synced_at: new Date().toISOString(),
          status: 'synced_to_inventory',
        })
        .eq('id', purchaseId);
      syncedOk = true;
    } catch (syncErr) {
      // Leave status 'auto_approved' so the web Sync can retry later.
      console.error(
        `[ManualPurchase] Telegram auto-sync failed for #${purchaseId.slice(0, 8)}:`,
        syncErr.message
      );
    }
  }

  const brandSuffix = purchase.brand_name ? ` (${purchase.brand_name})` : '';
  const unitStr = purchase.unit || '';

  let msg;
  if (isClear && syncedOk) {
    msg = `✅ Purchase Confirmed & Added to Stock!\n\n📦 ${purchase.item_name}${brandSuffix}\n⚖️ ${purchase.quantity}${unitStr}\n💰 ₹${purchase.amount}\n🏷 ${purchase.category || ''}\n\nAuto-approved and inventory updated.`;
  } else if (isClear) {
    msg = `✅ Purchase Confirmed!\n\n📦 ${purchase.item_name}${brandSuffix}\n⚖️ ${purchase.quantity}${unitStr}\n💰 ₹${purchase.amount}\n\nAuto-approved. Stock update pending — finance will sync it.`;
  } else {
    msg = `⏳ Purchase Submitted!\n\n📦 ${purchase.item_name}${brandSuffix}\n⚖️ ${purchase.quantity}${unitStr}\n💰 ₹${purchase.amount}\n\nSent to finance team for review.`;
  }

  await sendTelegramMessage(chatId, msg, replyTo);
}

async function handleConfirmationCorrection(chatId, text, replyTo) {
  const state = confirmationState.get(chatId);
  if (!state?.waitingFor) return false;

  const parsed = parseUserCorrection(state.waitingFor, text);
  if (!parsed) {
    await sendTelegramMessage(
      chatId,
      '❓ Could not understand that. Please try again.\nExamples: "Bread"  "500g"  "55"',
      replyTo
    );
    return true;
  }

  await supabaseAdmin.from('manual_purchases').update(parsed).eq('id', state.purchaseId);

  const fieldToStep = { item_name: 1, quantity: 2, amount: 3 };
  const step = fieldToStep[state.waitingFor];
  confirmationState.set(chatId, { ...state, waitingFor: null });

  let displayValue;
  if (state.waitingFor === 'item_name') displayValue = parsed.item_name;
  if (state.waitingFor === 'quantity') displayValue = `${parsed.quantity}${parsed.unit || ''}`;
  if (state.waitingFor === 'amount') displayValue = parsed.amount;

  await sendConfirmationStep(chatId, step, state.purchaseId, displayValue, replyTo);
  return true;
}

async function handleRegisterCommand(message, chatId, replyTo) {
  const parts = (message.text || '').trim().split(/\s+/);
  const email = parts[1]?.toLowerCase();

  if (!email?.includes('@')) {
    await sendTelegramMessage(chatId, '❌ Usage: /register your@company.com', replyTo);
    return;
  }

  // Look up Supabase auth user by email (listUsers works across all supabase-js v2 versions)
  const { data: usersData, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
  const authUser = usersData?.users?.find((u) => u.email?.toLowerCase() === email);
  if (authErr || !authUser) {
    await sendTelegramMessage(
      chatId,
      `❌ No account found for ${email}. Check the email or ask your admin.`,
      replyTo
    );
    return;
  }

  // Load profile for role + name
  const { data: regProfile } = await supabaseAdmin
    .from('profiles')
    .select('role, full_name')
    .eq('id', authUser.id)
    .maybeSingle();

  if (!regProfile) {
    await sendTelegramMessage(
      chatId,
      '❌ Profile not found. Ask your admin to complete your account setup.',
      replyTo
    );
    return;
  }

  if (!ALLOWED_SUBMITTERS.includes(regProfile.role)) {
    await sendTelegramMessage(
      chatId,
      `❌ Your role (${regProfile.role}) cannot submit purchases via Telegram.`,
      replyTo
    );
    return;
  }

  // Link Telegram chat_id → profile
  await supabaseAdmin.from('telegram_user_map').upsert(
    {
      telegram_chat_id: String(chatId),
      user_id: authUser.id,
      telegram_username: message.from?.username || null,
      mapped_at: new Date().toISOString(),
    },
    { onConflict: 'telegram_chat_id' }
  );

  await sendTelegramMessage(
    chatId,
    `✅ Registered!\n\nName: ${regProfile.full_name}\nRole: ${regProfile.role}\n\nYou can now send purchase details directly in this chat.`,
    replyTo
  );
}

async function handleRestockCommand(message, chatId, replyTo) {
  // 1. Look up registered sender
  const { data: mapping } = await supabaseAdmin
    .from('telegram_user_map')
    .select('user_id')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();

  if (!mapping) {
    await sendTelegramMessage(
      chatId,
      '❌ You are not registered. Send /register <your@company.com> to link your account.',
      replyTo
    );
    return;
  }

  // 2. Load profile for role checks
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, full_name')
    .eq('id', mapping.user_id)
    .maybeSingle();

  if (!profile || !['facility_manager', 'leadership'].includes(profile.role)) {
    await sendTelegramMessage(
      chatId,
      '❌ You are not authorized to use the /restock command.',
      replyTo
    );
    return;
  }

  const text = (message.text || message.caption || '').trim();
  const match = text.match(/^\/restock\s+(.+?)\s+(\d+(\.\d+)?)\s*([a-zA-Z]+)?$/i);
  if (!match) {
    await sendTelegramMessage(
      chatId,
      '❌ Usage: /restock <item name> <quantity>\nExample: /restock Milk 5',
      replyTo
    );
    return;
  }

  const itemName = match[1].trim();
  const qty = parseFloat(match[2]);

  if (qty <= 0) {
    await sendTelegramMessage(chatId, '❌ Restock quantity must be greater than zero.', replyTo);
    return;
  }

  // 3. Search product table
  const { data: prod, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('id, name, cost_per_unit, shelf_life_days, unit')
    .ilike('name', `%${itemName}%`)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (prodErr || !prod) {
    await sendTelegramMessage(
      chatId,
      `❌ Product matching '${itemName}' not found. Check spelling.`,
      replyTo
    );
    return;
  }

  // Perishable safeguard check
  const today = new Date();
  const options = { timeZone: 'Asia/Kolkata' };
  const istDate = new Date(today.toLocaleString('en-US', options));
  const dayOfWeek = istDate.getDay();
  const isWeekendUpcoming = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;
  let warningMessage = '';
  const isBread =
    prod.name.toLowerCase().includes('bread') || prod.name.toLowerCase().includes('brd');
  const isPerishable = isBread || (prod.shelf_life_days && prod.shelf_life_days <= 4);
  if (isPerishable && isWeekendUpcoming) {
    let dailyUsageRate = 1.0;
    if (isBread) {
      dailyUsageRate = 1.5;
    }

    const shelfLife = prod.shelf_life_days || 4;
    let workingDaysLeft = 0;
    for (let i = 1; i <= shelfLife; i++) {
      const nextDay = new Date(istDate.getTime() + i * 24 * 60 * 60 * 1000);
      const day = nextDay.getDay();
      if (day >= 1 && day <= 5) {
        workingDaysLeft++;
      }
    }

    const expectedCons = dailyUsageRate * workingDaysLeft;
    if (qty > expectedCons) {
      const wasted = (qty - expectedCons).toFixed(1);
      const expiresOnDayName = new Date(
        istDate.getTime() + shelfLife * 24 * 60 * 60 * 1000
      ).toLocaleDateString('en-US', { weekday: 'long' });

      warningMessage = `\n\n⚠️ *Perishable Warning:* Today is Friday/Weekend. ${prod.name} expires in ${shelfLife} days. Over the weekend, the office is closed (0 headcount). With morning shift (70 people) and evening shift (20 people), you will only consume ~${expectedCons.toFixed(1)} ${prod.unit || 'units'} before expiration on ${expiresOnDayName}. *Restocking ${qty} ${prod.unit || 'units'} could waste ~${wasted} ${prod.unit || 'units'}.*`;
    }
  }

  // 4. Update current_stock
  const { data: inv, error: invErr } = await supabaseAdmin
    .from('inventory')
    .select('current_stock')
    .eq('product_id', prod.id)
    .maybeSingle();

  if (invErr) {
    await sendTelegramMessage(chatId, `❌ Database error: ${invErr.message}`, replyTo);
    return;
  }

  const currentVal = inv ? Number(inv.current_stock) : 0;
  const newVal = currentVal + qty;

  if (inv) {
    const { error: updErr } = await supabaseAdmin
      .from('inventory')
      .update({ current_stock: newVal, last_updated_by: mapping.user_id })
      .eq('product_id', prod.id);
    if (updErr) {
      await sendTelegramMessage(chatId, `❌ Database update error: ${updErr.message}`, replyTo);
      return;
    }
  } else {
    const { error: insErr } = await supabaseAdmin.from('inventory').insert({
      product_id: prod.id,
      current_stock: newVal,
      min_threshold: 0,
      last_updated_by: mapping.user_id,
    });
    if (insErr) {
      await sendTelegramMessage(chatId, `❌ Database insert error: ${insErr.message}`, replyTo);
      return;
    }
  }

  // 5. Log transaction
  const { error: txErr } = await supabaseAdmin.from('transactions').insert({
    product_id: prod.id,
    type: 'add',
    quantity: qty,
    unit_cost: prod.cost_per_unit || 0,
    total_cost: Number((qty * (prod.cost_per_unit || 0)).toFixed(2)),
    facility_manager_id: mapping.user_id,
    notes: 'restocked via Telegram bot',
  });

  if (txErr) {
    console.error('[StockAlerts] txn log error:', txErr.message);
  }

  await sendTelegramMessage(
    chatId,
    `✅ *${prod.name} restocked!*\nNew stock: *${newVal} ${prod.unit || 'units'}* (added ${qty})${warningMessage}`,
    replyTo,
    null,
    'Markdown'
  );
}

// Roles allowed to START a stock-take (send the photo).
const STOCKTAKE_SUBMITTERS = ['office_boy', 'facility_manager', 'leadership'];
// Roles allowed to CONFIRM/DISCARD an applied stock-take.
const STOCKTAKE_APPROVERS = ['facility_manager', 'leadership'];

// Look up the profile linked to a Telegram chat. Returns null if unregistered.
async function getProfileForChat(chatId) {
  const { data: mapping } = await supabaseAdmin
    .from('telegram_user_map')
    .select('user_id')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();
  if (!mapping) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, full_name')
    .eq('id', mapping.user_id)
    .maybeSingle();
  if (!profile) return null;

  return { userId: mapping.user_id, role: profile.role, name: profile.full_name };
}

function formatStockTakeMessage(diff, unmatched) {
  const lines = diff.map((r) => {
    const arrow = r.delta === 0 ? '＝' : r.delta > 0 ? '🔺' : '🔻';
    const deltaStr = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
    return `${arrow} *${r.name}* — system ${r.system}, counted ${r.counted} (${deltaStr} ${r.unit})`;
  });
  let msg = `📸 *Photo Stock-take*\n\n${lines.join('\n')}`;
  if (unmatched.length) {
    msg += `\n\n⚠️ Couldn't match: ${unmatched.join(', ')}`;
  }
  msg += `\n\n_AI estimate — confirm to apply, or discard._`;
  return msg;
}

async function handleStockTakeCommand(message, chatId, replyTo) {
  const profile = await getProfileForChat(chatId);
  if (!profile) {
    await sendTelegramMessage(
      chatId,
      '❌ You are not registered. Send /register <your@company.com> to link your account.',
      replyTo
    );
    return;
  }
  if (!STOCKTAKE_SUBMITTERS.includes(profile.role)) {
    await sendTelegramMessage(
      chatId,
      '❌ Your role is not authorised to run a stock-take.',
      replyTo
    );
    return;
  }

  if (!message.photo?.length) {
    await sendTelegramMessage(
      chatId,
      '📸 To do a stock-take, send /stocktake as the *caption* of a clear shelf photo.',
      replyTo,
      null,
      'Markdown'
    );
    return;
  }

  // Largest photo size = best resolution for counting.
  const best = [...message.photo].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
  let photoUrl;
  try {
    const buf = await downloadTelegramFile(best.file_id);
    photoUrl = await uploadFile({
      buffer: buf,
      fileName: `stocktake-${chatId}-${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
    });
  } catch (e) {
    console.error('[StockTake] photo upload error:', e.message);
    await sendTelegramMessage(chatId, '❌ Could not read that photo. Please try again.', replyTo);
    return;
  }

  const { id, diff, unmatched } = await runStockTake(supabaseAdmin, {
    photoUrls: [photoUrl],
    createdBy: profile.userId,
    createdByName: profile.name,
  });

  if (!id || diff.length === 0) {
    await sendTelegramMessage(
      chatId,
      `🤔 Couldn't count any known products in that photo.${unmatched.length ? `\n\nSaw but couldn't match: ${unmatched.join(', ')}` : ''}\n\nTry a clearer, well-lit shelf photo.`,
      replyTo
    );
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Confirm', callback_data: `st_confirm:${id}` },
        { text: '🗑 Discard', callback_data: `st_discard:${id}` },
      ],
    ],
  };
  await sendTelegramMessage(
    chatId,
    formatStockTakeMessage(diff, unmatched),
    replyTo,
    keyboard,
    'Markdown'
  );
}

async function handleClarificationReply(message, chatId, replyTo, text) {
  // Only handle replies aimed at the bot itself
  if (message.reply_to_message?.from?.is_bot !== true) return false;

  // Look up the registered sender
  const { data: mapping } = await supabaseAdmin
    .from('telegram_user_map')
    .select('user_id')
    .eq('telegram_chat_id', String(chatId))
    .maybeSingle();

  if (!mapping) return false;

  // Find the most recent purchase awaiting clarification from this sender
  const { data: purchase } = await supabaseAdmin
    .from('manual_purchases')
    .select('id, item_name')
    .eq('sender_user_id', mapping.user_id)
    .eq('status', 'draft_needs_clarification')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!purchase) return false; // No pending clarification — let normal flow continue

  // Save answer and advance status to pending_review
  await supabaseAdmin
    .from('manual_purchases')
    .update({
      clarification_answer: text,
      status: 'pending_review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', purchase.id);

  const itemHint = purchase.item_name ? ` for "${purchase.item_name}"` : '';
  await sendTelegramMessage(
    chatId,
    `✅ Answer received${itemHint}!\n\nYour purchase has been sent to the finance team for review.`,
    replyTo
  ).catch(() => {});

  return true;
}

const EXTRACTION_SYSTEM = `You are an Office Bill, Inventory, and Expense Extraction Assistant.
Extract only visible bill details from the document. Do not guess missing values.
Return ONLY valid JSON (no markdown, no backticks) with this exact structure:

{
  "vendor_name": "string",
  "bill_date": "string",
  "invoice_number": "string",
  "items": [
    {
      "item_name": "product name as shown on bill",
      "quantity": number,
      "unit": "pcs/kg/ml/Count/etc",
      "unit_rate": number,
      "tax": number,
      "total_amount": number,
      "emoji": "single emoji like ☕🍵🥛🍪🧹🍋🫖🍞🥜🫙🧈🍫🥤💧🧻🧴📎🍓🍍",
      "cafeteria_category": "beverage|food|snack|cleaning|stationery|other"
    }
  ],
  "delivery_charges": number or null,
  "discount": number or null,
  "grand_total": number,
  "payment_status": "string or null",
  "confidence_score": number between 0 and 1,
  "needs_manual_review": boolean,
  "manual_review_reason": "string or null"
}

CRITICAL RULES:
- Every item MUST have "item_name" (never use "name" or "product")
- Every item MUST have "quantity" (never use "qty")
- Extract ALL line items from the bill, even if there are many
- Use the actual product name from the bill, never return "Unknown"
- Mark needs_manual_review true if any important value is unclear`;

const DUPLICATE_MESSAGES = [
  'Bhai, ye bill pehle se system mein hai. Ek hi bill se do baar stock update nahi hoga.',
  'Waah, same bill dobara? System ne pakad liya. Duplicate blocked.',
  'Overacting ke 50 rupay kaat. Ye invoice already uploaded hai.',
  'Duplicate bill detected. Pantry stock ko double count nahi karne denge.',
];

function apiBase() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing');
  return `https://api.telegram.org/bot${token}`;
}

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

// Strip brand names, weights, and pack sizes for customer-facing display
const KNOWN_BRANDS = [
  "mala's",
  'malas',
  'tata',
  'amul',
  'nescafe',
  'bru',
  'britannia',
  'parle',
  'haldiram',
  'mdh',
  'everest',
  'dabur',
  'patanjali',
  'lipton',
  'brooke bond',
  'red label',
  'society',
];

function _generateDisplayName(rawName) {
  if (!rawName) return null;
  let name = rawName.trim();
  // Remove leading brand + separator: "Mala's - Mix Fruit Jam" → "Mix Fruit Jam"
  for (const brand of KNOWN_BRANDS) {
    const re = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:]\\s*`, 'i');
    name = name.replace(re, '');
  }
  // Remove trailing weight/pack info: ", 4 Kg", "(Pack of 500)", "500g", "1 Kg"
  name = name.replace(
    /[,\s]*\d+(\.\d+)?\s*(kg|g|gm|gms|ml|l|ltr|litre|litres|pcs|pack|count)\b.*$/i,
    ''
  );
  // Remove parenthetical info: "(Pack of 500)", "(250ml)"
  name = name.replace(/\s*\([^)]*\)\s*/g, ' ');
  // Clean up extra spaces and dashes
  name = name
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name || rawName.trim();
}

function _calculateServings(quantity, unit) {
  if (!quantity || quantity <= 0) return quantity || 0;
  const u = (unit || '').toLowerCase().trim();
  if (['kg', 'kgs'].includes(u)) return Math.round(quantity * 25); // 40g per serving
  if (['g', 'gm', 'gms', 'gram', 'grams'].includes(u)) return Math.round(quantity / 40);
  if (['l', 'ltr', 'litre', 'litres', 'liter'].includes(u)) return Math.round(quantity * 20); // 50ml per serving
  if (['ml'].includes(u)) return Math.round(quantity / 50);
  // pcs, count, pack, or anything else → use as-is
  return quantity;
}

function isSupportedFile(fileName = '', mimeType = '') {
  return (
    /\.(pdf|jpe?g|png)$/i.test(fileName) ||
    ['application/pdf', 'image/jpeg', 'image/png'].includes(mimeType)
  );
}

function getTelegramFile(message) {
  if (message.document) {
    return {
      fileId: message.document.file_id,
      fileName: message.document.file_name || 'telegram-bill',
      mimeType: message.document.mime_type || '',
    };
  }

  if (message.photo?.length) {
    const photo = [...message.photo].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
    return {
      fileId: photo.file_id,
      fileName: `telegram-photo-${photo.file_unique_id || Date.now()}.jpg`,
      mimeType: 'image/jpeg',
    };
  }

  return null;
}

async function telegramRequest(method, body) {
  const res = await fetch(`${apiBase()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram ${method} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function sendTelegramMessage(
  chatId,
  text,
  replyToMessageId,
  replyMarkup = null,
  parseMode = null
) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text,
    reply_to_message_id: replyToMessageId,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    ...(parseMode ? { parse_mode: parseMode } : {}),
  });
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch((e) => console.error('[Telegram] answerCallbackQuery error:', e.message));
}

async function downloadTelegramFile(fileId) {
  const fileInfo = await telegramRequest('getFile', { file_id: fileId });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) throw new Error('Telegram did not return file_path');

  const res = await fetch(
    `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram file download ${res.status}: ${text.slice(0, 200)}`);
  }

  const bytes = await res.arrayBuffer();
  return Buffer.from(bytes);
}

async function uploadFile({ buffer, fileName, mimeType }) {
  const path = `telegram/${Date.now()}-${safeName(fileName)}`;
  const { error } = await supabaseAdmin.storage.from('bills').upload(path, buffer, {
    contentType: mimeType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from('bills').getPublicUrl(path);
  return data.publicUrl;
}

async function findDuplicate(parsed) {
  if (!parsed?.invoice_number) return null;

  // Match on invoice number only — vendor name can vary between AI extractions
  // Use ilike for case-insensitive + trim whitespace
  const invoiceNum = String(parsed.invoice_number).trim();
  if (!invoiceNum) return null;

  const { data, error } = await supabaseAdmin
    .from('bill_uploads')
    .select('id, vendor_name, invoice_number, grand_total, created_at')
    .eq('invoice_number', invoiceNum)
    .limit(1)
    .maybeSingle();

  if (error) {
    // If maybeSingle fails because multiple rows match, still treat as duplicate
    if (error.code === 'PGRST116') {
      const { data: first } = await supabaseAdmin
        .from('bill_uploads')
        .select('id, vendor_name, invoice_number, grand_total, created_at')
        .eq('invoice_number', invoiceNum)
        .limit(1)
        .single();
      return first;
    }
    throw error;
  }
  return data;
}

// Normalize date from any format (DD-MM-YYYY, DD/MM/YYYY, etc.) to YYYY-MM-DD
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // DD-MM-YYYY or DD/MM/YYYY
  const m = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // MM-DD-YYYY (unlikely for Indian bills but handle it)
  const m2 = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  // Try JS Date parse as last resort
  const d = new Date(dateStr);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

async function saveBill({ parsed, fileUrl }) {
  // Auto-approve: bills from Telegram are auto-verified (only admins upload via Telegram)
  const { data: bill, error: billErr } = await supabaseAdmin
    .from('bill_uploads')
    .insert({
      vendor_name: parsed.vendor_name || null,
      bill_date: normalizeDate(parsed.bill_date),
      invoice_number: parsed.invoice_number || null,
      uploaded_by_name: 'Telegram Bot',
      file_url: fileUrl,
      extraction_status: 'Extracted',
      verification_status: 'Admin Verified',
      approval_status: 'Auto-Approved',
      grand_total: normalizeNumber(parsed.grand_total),
      delivery_charges: normalizeNumber(parsed.delivery_charges) || 0,
      discount: normalizeNumber(parsed.discount) || 0,
      confidence_score: normalizeNumber(parsed.confidence_score),
      needs_manual_review: Boolean(parsed.needs_manual_review),
      manual_review_reason: parsed.manual_review_reason || null,
      verified_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (billErr) throw billErr;

  // Normalize item fields — AI may return different field names
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems.map((item) => ({
    item_name: item.item_name || item.name || item.product_name || item.product || 'Unknown',
    category: item.category || item.type || null,
    quantity: normalizeNumber(item.quantity || item.qty) || 0,
    unit: item.unit || item.uom || 'pcs',
    unit_rate: normalizeNumber(item.unit_rate || item.rate || item.price || item.unit_price),
    tax: normalizeNumber(item.tax || item.gst) || 0,
    total_amount: normalizeNumber(item.total_amount || item.total || item.amount),
    inventory_action: item.inventory_action || null,
    emoji: item.emoji || '📦',
    cafeteria_category: item.cafeteria_category || 'other',
  }));

  console.log(
    '[Telegram] Normalized items:',
    JSON.stringify(items.map((i) => ({ name: i.item_name, qty: i.quantity, emoji: i.emoji })))
  );

  if (items.length) {
    const rows = items.map((item) => ({
      bill_id: bill.id,
      item_name: item.item_name,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      unit_rate: item.unit_rate,
      tax: item.tax,
      total_amount: item.total_amount,
      inventory_action: item.inventory_action,
    }));

    const { error: itemsErr } = await supabaseAdmin.from('bill_items').insert(rows);
    if (itemsErr) throw itemsErr;
  }

  // ── Auto-sync: Update inventory + cafeteria items ──
  for (const item of items) {
    const qty = item.quantity;
    const itemName = item.item_name;
    const _emoji = item.emoji;
    const _cafeCat = item.cafeteria_category;

    // 1. Upsert into products table
    const { data: existingProduct } = await supabaseAdmin
      .from('products')
      .select('id')
      .ilike('name', itemName)
      .maybeSingle();

    let productId;
    if (existingProduct) {
      productId = existingProduct.id;
    } else {
      const { data: newProduct } = await supabaseAdmin
        .from('products')
        .insert({
          name: itemName,
          category: item.category || 'Pantry',
          unit: item.unit || 'pcs',
        })
        .select('id')
        .single();
      productId = newProduct?.id;
    }

    // 2. Update inventory stock
    if (productId) {
      const { data: inv } = await supabaseAdmin
        .from('inventory')
        .select('current_stock')
        .eq('product_id', productId)
        .maybeSingle();

      if (inv) {
        await supabaseAdmin
          .from('inventory')
          .update({ current_stock: (inv.current_stock || 0) + qty })
          .eq('product_id', productId);
      } else {
        await supabaseAdmin.from('inventory').insert({ product_id: productId, current_stock: qty });
      }

      // 3. Log transaction
      await supabaseAdmin.from('transactions').insert({
        product_id: productId,
        type: 'add',
        quantity: qty,
        unit_cost: normalizeNumber(item.unit_rate),
        total_cost: normalizeNumber(item.total_amount),
        notes: `Auto from Bill #${bill.invoice_number} (${bill.vendor_name})`,
      });
    }

    // 4. Upsert into cafeteria_items — uses master record for conversion
    const normalized = normalizeName(itemName);
    const { data: master } = await supabaseAdmin
      .from('product_conversion_master')
      .select('*')
      .eq('active', true)
      .eq('approval_status', 'approved')
      .contains('aliases', [normalized])
      .maybeSingle();

    // Only update cafeteria stock for approved direct-menu items
    const skipClasses = new Set(['internal_supply', 'equipment_asset', 'finance_expense']);
    if (master?.cafeteria_item_name && !skipClasses.has(master.classification)) {
      const servings =
        master.units_per_purchase_unit != null ? qty * master.units_per_purchase_unit : null;

      const { data: existingCafe } = await supabaseAdmin
        .from('cafeteria_items')
        .select('id, stock_today, stock_servings')
        .eq('item_name', master.cafeteria_item_name)
        .maybeSingle();

      if (existingCafe) {
        await supabaseAdmin
          .from('cafeteria_items')
          .update({
            stock_today: (existingCafe.stock_today || 0) + qty,
            stock_servings:
              servings !== null
                ? (existingCafe.stock_servings || 0) + servings
                : existingCafe.stock_servings,
            available: true,
          })
          .eq('id', existingCafe.id);
      }
      // Never auto-create cafeteria items — admin must add them manually
    }
    // Unknown items are silently skipped; admin adds them to the master when ready
  }

  return { bill, itemCount: items.length, normalizedItems: items };
}

async function extractBill({ buffer, fileName, mimeType, fileUrl }) {
  const isPdf = mimeType === 'application/pdf' || /\.pdf$/i.test(fileName);
  if (isPdf) {
    return fileCompletion({
      system: EXTRACTION_SYSTEM,
      user: 'Extract all details from this vendor bill PDF. List every single item with its item_name, quantity, unit_rate, tax, and total_amount. Return valid JSON only.',
      fileBuffer: buffer,
      filename: fileName,
      mimeType: mimeType || 'application/pdf',
      model: 'gpt-4o',
    });
  }

  return visionCompletion({
    system: EXTRACTION_SYSTEM,
    user: 'Extract all details from this bill image. List every single item with its item_name, quantity, unit_rate, tax, and total_amount. Return valid JSON only.',
    imageUrl: fileUrl,
    model: 'gpt-4o',
  });
}

router.post('/', (req, res) => {
  const expectedKey = process.env.TELEGRAM_WEBHOOK_KEY || 'app_wizz_telegram_secret';
  if (req.query.key !== expectedKey) {
    return res.status(401).json({ ok: false, error: 'Invalid telegram webhook key' });
  }

  // Respond immediately so Telegram stops retrying
  res.json({ ok: true });

  // Skip if this update was already processed
  if (isDuplicate(req.body?.update_id)) return;

  // Handle inline keyboard button press
  if (req.body.callback_query) {
    handleCallbackQuery(req.body.callback_query).catch((e) =>
      console.error('[Telegram] callback_query error:', e.message)
    );
    return;
  }

  const message = req.body?.message || req.body?.channel_post;
  const chatId = message?.chat?.id;
  const replyTo = message?.message_id;

  if (!message || !chatId) return;

  const text = message.text || message.caption || '';
  const hasPhoto = Boolean(message.photo?.length);
  const hasDocument = Boolean(message.document);

  // /register must be handled synchronously (before the async IIFE) so the
  // early return prevents falling into the invoice flow below.
  if (text.toLowerCase().startsWith('/register')) {
    handleRegisterCommand(message, chatId, replyTo).catch((e) =>
      console.error('[ManualPurchase] register error:', e.message)
    );
    return;
  }

  if (text.toLowerCase().startsWith('/restock')) {
    handleRestockCommand(message, chatId, replyTo).catch((e) =>
      console.error('[ManualPurchase] restock error:', e.message)
    );
    return;
  }

  if (text.toLowerCase().startsWith('/stocktake')) {
    handleStockTakeCommand(message, chatId, replyTo).catch((e) =>
      console.error('[StockTake] command error:', e.message)
    );
    return;
  }

  // Process in background after responding
  (async () => {
    try {
      // If the user is replying to a bot clarification question, handle that first
      if (message.reply_to_message && text && !hasDocument) {
        const handled = await handleClarificationReply(message, chatId, replyTo, text);
        if (handled) return;
      }

      // Handle correction text during step-by-step confirmation
      if (text && !hasPhoto && !hasDocument) {
        const handled = await handleConfirmationCorrection(String(chatId), text, replyTo);
        if (handled) return;
      }

      // Classify the message before touching files
      const msgType = await classifyTelegramMessage(text, hasPhoto, hasDocument);

      if (msgType === 'manual_no_invoice_purchase') {
        const bestPhoto = hasPhoto
          ? [...message.photo].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0]
          : null;

        if (hasPhoto) {
          // Photo present — process immediately, no buffer needed
          processBufferedPurchase(String(chatId), {
            texts: text ? [text] : [],
            photoFileIds: bestPhoto?.file_id ? [bestPhoto.file_id] : [],
            replyTo,
            firstMsgId: replyTo,
          }).catch((e) => console.error('[ManualPurchase] process error:', e.message));
        } else {
          // Text only — buffer briefly in case photo follows
          bufferMessage(String(chatId), {
            text,
            photoFileId: null,
            replyTo,
            messageId: replyTo,
          });
        }
        return;
      }

      if (msgType === 'personal_or_irrelevant') return;

      if (msgType === 'unclear' && !hasDocument) {
        await sendTelegramMessage(
          chatId,
          '🤔 Not sure what this is. To submit a purchase, describe what you bought and the amount (e.g. "bought 2kg sugar ₹80"). To upload a bill, send the PDF or image.',
          replyTo
        ).catch(() => {});
        return;
      }

      // invoice_bill or document → existing flow (unchanged below)
      const file = getTelegramFile(message);
      if (!file || !isSupportedFile(file.fileName, file.mimeType)) return;

      const buffer = await downloadTelegramFile(file.fileId);
      const fileUrl = await uploadFile({
        buffer,
        fileName: file.fileName,
        mimeType: file.mimeType,
      });
      const { content } = await extractBill({ ...file, buffer, fileUrl });
      console.log('[Telegram] Raw AI response (first 500 chars):', content.slice(0, 500));
      let parsed;
      try {
        parsed = JSON.parse(cleanJson(content));
      } catch {
        await sendTelegramMessage(
          chatId,
          '📸 This doesn\'t look like a bill or invoice.\n\nIf this is a purchase without a receipt, send a message describing what you bought, the amount, and where — e.g. "bought bread ₹60 from local shop, cash".',
          replyTo
        ).catch(() => {});
        return;
      }
      console.log(
        '[Telegram] Parsed items count:',
        parsed.items?.length,
        'First item keys:',
        parsed.items?.[0] ? Object.keys(parsed.items[0]) : 'none'
      );

      const duplicate = await findDuplicate(parsed);
      if (duplicate) {
        // If the bill was uploaded within the last 15 minutes, this is a Telegram
        // webhook retry (e.g. after a server restart) — NOT a user intentionally
        // re-uploading the same bill. Silently skip so no false roast is sent.
        const ageMs = duplicate.created_at
          ? Date.now() - new Date(duplicate.created_at).getTime()
          : Infinity;
        const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
        if (ageMs < FIFTEEN_MINUTES_MS) {
          console.log(
            '[Telegram] Suppressing duplicate roast — likely Telegram retry within 15 min for invoice',
            duplicate.invoice_number
          );
          return; // silent skip
        }
        // Bill is older — user is intentionally re-uploading. Show the roast.
        const roast = DUPLICATE_MESSAGES[Math.floor(Math.random() * DUPLICATE_MESSAGES.length)];
        await sendTelegramMessage(
          chatId,
          `Duplicate Bill Detected\n\nVendor: ${duplicate.vendor_name || '-'}\nInvoice: #${duplicate.invoice_number || '-'}\nTotal: ₹${duplicate.grand_total || '-'}\n\n${roast}`,
          replyTo
        );
        return;
      }

      const { bill, itemCount, normalizedItems } = await saveBill({ parsed, fileUrl });

      // Build items summary from normalized data
      const itemsList = (normalizedItems || [])
        .map((i) => `  ${i.emoji} ${i.item_name} — ${i.quantity} ${i.unit}`)
        .join('\n');

      await sendTelegramMessage(
        chatId,
        `✅ Bill Auto-Approved & Inventory Updated!\n\n🏢 Vendor: ${bill.vendor_name || '-'}\n🧾 Invoice: #${bill.invoice_number || '-'}\n💰 Total: ₹${bill.grand_total || '-'}\n\n📦 ${itemCount} items added to stock:\n${itemsList}\n\n🟢 Status: Auto-Verified\n🔄 Cafeteria menu & inventory updated automatically!`,
        replyTo
      );

      // Teams notification for bill upload
      postBillToTeams({
        vendor_name: bill.vendor_name,
        invoice_number: bill.invoice_number,
        grand_total: bill.grand_total,
        items_count: itemCount,
        uploaded_by: 'Telegram Bot',
      }).catch((e) => console.error('[Teams bill]', e.message));
    } catch (e) {
      await sendTelegramMessage(
        chatId,
        `Bill processing failed\n\n${e.message || 'Unknown error'}\n\nPlease upload a clear PDF, JPG, JPEG, or PNG bill.`,
        replyTo
      ).catch(() => {});
    }
  })();
});

export default router;
