import { Router } from 'express';
import { z } from 'zod';
import { learnFromRating } from '../lib/learning.js';
import { chatCompletion } from '../lib/openai.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { postCancelToTeams, postOrderToTeams, postStockAlertToTeams } from '../lib/teams.js';
import { sendPushToUsers } from './push.js';

const router = Router();

function isMorningShift(dateTimeStr) {
  const date = dateTimeStr ? new Date(dateTimeStr) : new Date();
  const options = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false };
  const istStr = date.toLocaleTimeString('en-US', options);
  const [hour, minute] = istStr.split(':').map(Number);
  const timeInMinutes = hour * 60 + minute;
  const startMinutes = 8 * 60 + 30; // 08:30
  const endMinutes = 17 * 60; // 17:00
  return timeInMinutes >= startMinutes && timeInMinutes <= endMinutes;
}

function mapFulfillmentType(reqRow) {
  if (!reqRow) return null;
  return {
    ...reqRow,
    fulfillmentType: reqRow.delivery_mode === 'self_pickup' ? 'pickup' : 'delivery',
  };
}

// Map well-known cafeteria items to categories
const ITEM_CATEGORY = {
  'ccd coffee': 'beverage',
  'regular tea': 'beverage',
  'lemon tea': 'beverage',
  'water bottle': 'beverage',
  water: 'beverage',
  tea: 'beverage',
  coffee: 'beverage',
  'bread + peanut butter': 'food',
  'bread + jam': 'food',
  bread: 'food',
  'peanut butter sandwich': 'food',
  'mix fruit jam sandwich': 'food',
  'pineapple jam sandwich': 'food',
  biscuits: 'snack',
  stationery: 'stationery',
  cleaning: 'cleaning',
  maintenance: 'maintenance',
  'meeting room setup': 'other',
  // INDUS+ Machine drinks (virtual — backed by Coffee Beans, Tea bags, or Milk)
  espresso: 'beverage',
  latte: 'beverage',
  cappuccino: 'beverage',
  'milk coffee': 'beverage',
  americano: 'beverage',
  'strong coffee': 'beverage',
  'black coffee': 'beverage',
  'half cup': 'beverage',
  brew: 'beverage',
  'hot water': 'beverage',
  'strong tea': 'beverage',
  'black tea': 'beverage',
  'dip tea': 'beverage',
  milk: 'beverage',
};

const SANDWICH_SPREADS = [
  {
    displayName: 'Peanut Butter Sandwich',
    lookupPatterns: ['peanut butter'],
    matches: (text) => text.includes('peanut butter'),
  },
  {
    displayName: 'Pineapple Jam Sandwich',
    lookupPatterns: ['pineapple jam'],
    matches: (text) => text.includes('pineapple') && text.includes('jam'),
  },
  {
    displayName: 'Mix Fruit Jam Sandwich',
    lookupPatterns: ['mix fruit jam', 'mixed fruit jam', 'fruit jam', 'jam'],
    matches: (text) =>
      text.includes('jam') &&
      (text.includes('mix fruit') ||
        text.includes('mixed fruit') ||
        text.includes('fruit jam') ||
        text.trim() === 'jam'),
  },
];

function orderSearchText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.toLowerCase();
  return [value.item_name, value.display_name, value.frontend_name, value.sandwich_type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getSandwichSpreadConfig(value) {
  const text = orderSearchText(value);
  return SANDWICH_SPREADS.find((config) => config.matches(text)) || null;
}

function isSandwichSpread(value) {
  return Boolean(getSandwichSpreadConfig(value));
}

function displayOrderItemName(itemName, itemRow = null) {
  return (
    getSandwichSpreadConfig(itemName)?.displayName ||
    getSandwichSpreadConfig(itemRow)?.displayName ||
    itemRow?.frontend_name ||
    itemRow?.display_name ||
    itemName
  );
}

function hasBreadDependency(dependencies) {
  return (
    Array.isArray(dependencies) && dependencies.some((dep) => String(dep).toLowerCase() === 'bread')
  );
}

function isBreadName(name) {
  const n = String(name || '').toLowerCase();
  return n === 'bread' || n.includes('bread') || n.includes('brd');
}

async function findCafeteriaItemForOrder(itemName, columns) {
  const exact = String(itemName || '').trim();
  if (!exact) return null;

  for (const column of ['item_name', 'display_name', 'frontend_name']) {
    const { data } = await supabaseAdmin
      .from('cafeteria_items')
      .select(columns)
      .ilike(column, exact)
      .limit(1);
    if (data?.[0]) return data[0];
  }

  const sandwichConfig = getSandwichSpreadConfig(itemName);
  if (!sandwichConfig) return null;

  for (const pattern of sandwichConfig.lookupPatterns) {
    for (const column of ['item_name', 'display_name', 'frontend_name']) {
      const { data } = await supabaseAdmin
        .from('cafeteria_items')
        .select(columns)
        .ilike(column, `%${pattern}%`)
        .limit(1);
      if (data?.[0]) return data[0];
    }
  }

  return null;
}

// Map virtual menu drink names → array of backing ingredients with servings per cup.
// This drives BOTH stock checks AND stock deductions.
// Multi-ingredient drinks (Cappuccino = Coffee Beans + Milk) must list ALL ingredients.
// servings: 1 = full cup deduction, 0.5 = half (Half Cup)
const VIRTUAL_DRINK_MAP = {
  // Coffee (Only 4 options)
  espresso: [{ item: 'Coffee Beans', servings: 1 }],
  americano: [{ item: 'Coffee Beans', servings: 1 }],
  cappuccino: [
    { item: 'Coffee Beans', servings: 1 },
    { item: 'Milk', servings: 1 },
  ],
  latte: [
    { item: 'Coffee Beans', servings: 1 },
    { item: 'Milk', servings: 1 },
  ],
  // Tea (Only 4 options)
  'assam tea': [
    { item: 'Assam tea', servings: 1 },
    { item: 'Milk', servings: 1 },
  ],
  'elaichi tea': [
    { item: 'Elaichi tea', servings: 1 },
    { item: 'Milk', servings: 1 },
  ],
  'ginger tea': [
    { item: 'Ginger tea', servings: 1 },
    { item: 'Milk', servings: 1 },
  ],
  'lemon tea': [{ item: 'Lemon sachets', servings: 1 }],
  // Hot Mixes
  'hot chocolate': [
    { item: 'Hot chocolate', servings: 1 },
    { item: 'Milk', servings: 1 },
  ],
  'badam mix': [
    { item: 'Badam Sachets', servings: 1 },
    { item: 'Milk', servings: 1 },
  ],
};

// ── Tone-aware dependency messages ──────────────────────────────────────────
const DEPENDENCY_MESSAGES = {
  'Mom Mode': {
    _default: (item, dep) =>
      `Beta, ${item} toh hai but ${dep} khatam ho gaya 🍞😅 Office boy ko bol diya hai!`,
  },
  gen_z: {
    _default: (item, dep) =>
      `Bruh, ${dep}'s MIA 💀 ${item} without ${dep} is just chaotic. Restocking!`,
  },
  Friendly: {
    _default: (item, dep) => `Oops! We have ${item} but ${dep} ran out! We'll restock soon 😊`,
  },
  Professional: {
    _default: (item, dep) => `${dep} is currently unavailable. ${item} requires ${dep} to serve.`,
  },
  Funny: {
    _default: (item, dep) =>
      `${item} bina ${dep} ke? Bhai, ye toh crime hai 😂 ${dep} ka stock khatam. Patience!`,
  },
  Minimal: {
    _default: (item, dep) => `${dep} out of stock. Can't serve ${item}.`,
  },
  boyfriend: {
    _default: (item, dep) =>
      `Hey babe, ${dep} is out right now 🥺 Can't make your ${item} without it. We'll restock! 💕`,
  },
  girlfriend: {
    _default: (item, dep) =>
      `Hey handsome, ${dep} ka stock khatam ho gaya 🥺 ${item} nahi ban payega abhi. Jaldi laate hain! 💕`,
  },
};

function getDependencyMessage(tone, itemName, depName) {
  const toneMessages = DEPENDENCY_MESSAGES[tone] || DEPENDENCY_MESSAGES.Friendly;
  const fn = toneMessages[depName] || toneMessages._default;
  return fn(itemName, depName);
}

const PARSER_SYSTEM = `You are the "Applywizz Office Concierge" AI.
Your tone is WITTY, ENERGETIC, and PERSONABLE (like Zomato push notifications).
The office team is aged 23-25, so use emojis and Gen-Z friendly language.

OFFICE CULTURE:
- Working Hours: 9 AM – 5 PM, Mon–Fri.
- Assets: CCD Coffee Machine, Fresh Bread, Peanut Butter, Mixed Fruit Jam.
- Locations: Balaji Cabin, RK Cabin, Manisha Cabin, Resume Cabin, Tech Team, Marketing Team, Conference Room.

Extract these fields and return ONLY valid JSON:
1. "employee_name": Name from the request or the authenticated submitter name.
2. "request_type": "beverage" | "cleaning" | "food" | "stationery" | "other".
3. "item": What they want (e.g. "CCD Coffee", "Lemon Tea", "Bread with PB&J").
4. "quantity": Number or description (default "1" if not stated).
5. "location": Delivery location. If not stated, leave as null.
6. "priority": "Urgent" | "Normal" | "Low".
7. "instruction": A SHORT, WITTY, emoji-filled instruction for the Office Boy (1–2 sentences max).
8. "missing_details": [] (empty array unless item is completely unknown).
9. "follow_up_question": null (see rules below).

CRITICAL RULES FOR follow_up_question:
- Set follow_up_question to null for ALL clear requests. Process them immediately.
- ONLY set a non-null follow_up_question if the item is completely unidentifiable (e.g. user typed "bring me something" with zero context).
- NEVER block a request to ask about health, variety, or suggestions. Put those thoughts in the instruction text instead.
- If location is missing, still process the order — just set location to null.
- "Usual", "my regular", "the normal thing" = process it as their typical item (Coffee if no history).

Example Witty Instruction:
"🚀 Rama's brain needs fuel! Rush a CCD Coffee to Balaji Cabin — productivity depends on it!"

Return JSON ONLY. No markdown, no explanation.`;

async function parseWithGPT({ rawText, submitterName }) {
  const userPrompt = `Submitter (already authenticated, may be the same as employee): ${submitterName || 'unknown'}\n\nRequest:\n"${rawText}"`;
  const { content, model, usage } = await chatCompletion({
    system: PARSER_SYSTEM,
    user: userPrompt,
    model: 'gpt-4o-mini',
    temperature: 0.1,
  });
  let parsed;
  try {
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (_e) {
    throw new Error(`GPT returned non-JSON: ${content.slice(0, 200)}`);
  }
  return { parsed, model, usage };
}

const QUICK_ORDER_INSTRUCTION_TEMPLATES = {
  'Mom Mode': [
    (name, item, qty, loc, notes) =>
      `Beta ${name} needs ${qty}x ${item}${loc}. Please deliver with love!${notes}`,
    (name, item, qty, loc, notes) =>
      `Aapke pyare bache ${name} ke liye ${qty}x ${item}${loc} jaldi bhej do. ${notes}`,
    (name, item, qty, loc, notes) =>
      `Beta ${name} is working hard and needs ${qty}x ${item}${loc}. Deliver it hot!${notes}`,
  ],
  gen_z: [
    (name, item, qty, loc, notes) =>
      `${name} wants ${qty}x ${item}${loc}. Drop it ASAP, it's urgent!${notes}`,
    (name, item, qty, loc, notes) =>
      `Vibe check! ${name} needs ${qty}x ${item}${loc} immediately. No cap.${notes}`,
    (name, item, qty, loc, notes) =>
      `Emergency fuel for ${name}: ${qty}x ${item}${loc}. Slay!${notes}`,
  ],
  Funny: [
    (name, item, qty, loc, notes) =>
      `Emergency refueling: ${qty}x ${item}${loc} for ${name}! Please save them!${notes}`,
    (name, item, qty, loc, notes) =>
      `Critical energy alert! Deploy ${qty}x ${item}${loc} to ${name} immediately!${notes}`,
    (name, item, qty, loc, notes) =>
      `Brain crash imminent! Rush ${qty}x ${item}${loc} to ${name} now!${notes}`,
  ],
  boyfriend: [
    (name, item, qty, loc, notes) =>
      `Babe ${name} needs ${qty}x ${item}${loc} right now. Deliver it promptly!${notes}`,
    (name, item, qty, loc, notes) =>
      `Hey, please deliver ${qty}x ${item}${loc} for my favorite ${name}!${notes}`,
    (name, item, qty, loc, notes) =>
      `My sweet ${name} needs ${qty}x ${item}${loc}. Bring it soon! 💕${notes}`,
  ],
  girlfriend: [
    (name, item, qty, loc, notes) =>
      `Hey, please deliver ${qty}x ${item}${loc} to ${name}. Thank you!${notes}`,
    (name, item, qty, loc, notes) =>
      `Deliver ${qty}x ${item}${loc} to ${name} with extra care!${notes}`,
    (name, item, qty, loc, notes) =>
      `Special ${qty}x ${item}${loc} for handsome ${name}. Go deliver it! 💖${notes}`,
  ],
  Professional: [
    (name, item, qty, loc, notes) =>
      `Deliver ${qty}x ${item}${loc} for ${name}. Please deliver promptly.${notes}`,
    (name, item, qty, loc, notes) =>
      `Request for ${qty}x ${item}${loc} by ${name}. Processing delivery.${notes}`,
  ],
  Minimal: [
    (name, item, qty, loc, notes) => `${qty}x ${item}${loc} for ${name}.${notes}`,
    (name, item, qty, loc, notes) => `${name}: ${qty}x ${item}${loc}.${notes}`,
  ],
  Friendly: [
    (name, item, qty, loc, notes) =>
      `🚀 ${name} needs ${qty}x ${item}${loc}. Please deliver promptly!${notes}`,
    (name, item, qty, loc, notes) =>
      `✨ Fresh ${qty}x ${item}${loc} for ${name}. Deliver with a smile!${notes}`,
    (name, item, qty, loc, notes) =>
      `🎉 Let's get ${qty}x ${item}${loc} to ${name}! Thanks for the help!${notes}`,
  ],
};

async function generateQuickOrderInstruction(user, item, qty, location, notes) {
  const firstName =
    user.preferred_name || (user.full_name || user.email || 'Someone').split(' ')[0];
  const userTone = await getUserTone(user.id);
  const templates =
    QUICK_ORDER_INSTRUCTION_TEMPLATES[userTone] || QUICK_ORDER_INSTRUCTION_TEMPLATES.Friendly;
  const fn = templates[Math.floor(Math.random() * templates.length)];
  const locPart = location ? ` to ${location}` : '';
  const notePart = notes ? ` Note: ${notes}.` : '';
  return fn(firstName, item, qty, locPart, notePart);
}

const createSchema = z.object({
  raw_text: z.string().min(3).max(500),
});

router.post('/', async (req, res, next) => {
  try {
    // ── Quick order (cafeteria tap — no AI needed) ───────────────
    const {
      quick_item,
      quick_location,
      quick_quantity = 1,
      quick_instruction = '',
      quick_bread_type = '',
    } = req.body;
    if (quick_item) {
      const qty = parseInt(quick_quantity, 10) || 1;
      const instruction = await generateQuickOrderInstruction(
        req.user,
        quick_item,
        qty,
        quick_location,
        quick_instruction
      );
      const category =
        ITEM_CATEGORY[quick_item.toLowerCase()] ||
        (isSandwichSpread(quick_item) ? 'food' : 'other');

      // Normalize delivery mode before composing raw_text.
      let deliveryMode = req.body.delivery_mode;
      if (!deliveryMode) {
        if (req.body.fulfillmentType === 'pickup') deliveryMode = 'self_pickup';
        else if (req.body.fulfillmentType === 'delivery') deliveryMode = 'get_it_here';
        else deliveryMode = 'get_it_here';
      }
      if (!['get_it_here', 'self_pickup'].includes(deliveryMode)) {
        deliveryMode = 'get_it_here';
      }

      const locPart =
        deliveryMode === 'self_pickup' || !quick_location ? '' : ` to ${quick_location}`;
      const breadPart = quick_bread_type ? ` [bread:${quick_bread_type}]` : '';
      const rawText = `${qty}x ${quick_item}${locPart}${breadPart}`;

      // Stock check and decrement happens after local formatting succeeds.
      try {
        await deductStockForRequest(req.user, quick_item, qty, quick_instruction, quick_bread_type);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      const { data: qData, error: qErr } = await supabaseAdmin
        .from('requests')
        .insert({
          raw_text: rawText,
          category,
          parsed_item: quick_item,
          parsed_location: deliveryMode === 'self_pickup' ? null : quick_location || null,
          instruction,
          submitted_by: req.user.id,
          live_status: 'confirming',
          status: 'confirming',
          delivery_mode: deliveryMode,
        })
        .select()
        .single();
      if (qErr) throw qErr;

      // NOTE: Teams + push notifications are NOT sent here.
      // They fire only after the 30s cancel window via POST /:id/confirm.

      return res.status(201).json({ needs_followup: false, request: mapFulfillmentType(qData) });
    }

    // ── Standard AI-parsed request ────────────────────────────────
    const { raw_text } = createSchema.parse(req.body);

    const { parsed, model } = await parseWithGPT({
      rawText: raw_text,
      submitterName: req.user.full_name || req.user.email,
    });

    // Only block if item is genuinely unknown (cannot make the order at all)
    const itemMissing = !parsed.item || parsed.item.trim() === '';
    const hasRealFollowup = parsed.follow_up_question && itemMissing;
    if (hasRealFollowup) {
      return res.status(200).json({
        needs_followup: true,
        followup: parsed.follow_up_question,
        parsed,
        model,
      });
    }

    // Deduct stock for AI-parsed item
    if (parsed.item) {
      try {
        const qty = parseInt(parsed.quantity, 10) || 1;
        const breadTypeMatch =
          raw_text.match(/\[bread:(.+?)\]/) || raw_text.match(/\b(atta|milk|wheat|brown)\b/i);
        let breadType = '';
        if (breadTypeMatch) {
          const bt = breadTypeMatch[1]
            ? breadTypeMatch[1].toLowerCase()
            : breadTypeMatch[0].toLowerCase();
          if (bt.includes('atta') || bt.includes('wheat')) breadType = 'MDRN AT SHK BRD400G';
          else if (
            bt.includes('milk') ||
            bt.includes('white') ||
            bt.includes('brown') ||
            bt.includes('bread')
          )
            breadType = 'Bread';
        }
        await deductStockForRequest(
          req.user,
          parsed.item,
          qty,
          parsed.instruction || '',
          breadType
        );
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    let deliveryMode = req.body.delivery_mode;
    if (!deliveryMode) {
      if (req.body.fulfillmentType === 'pickup') deliveryMode = 'self_pickup';
      else if (req.body.fulfillmentType === 'delivery') deliveryMode = 'get_it_here';
      else deliveryMode = 'get_it_here';
    }
    if (!['get_it_here', 'self_pickup'].includes(deliveryMode)) {
      deliveryMode = 'get_it_here';
    }

    const { data, error } = await supabaseAdmin
      .from('requests')
      .insert({
        raw_text,
        category: parsed.request_type || 'other',
        parsed_item: parsed.item || parsed.request_details || parsed.request_type || null,
        parsed_employee_name: parsed.employee_name || req.user.full_name || req.user.email,
        parsed_location: parsed.location || null,
        instruction: parsed.instruction,
        submitted_by: req.user.id,
        live_status: 'confirming',
        status: 'confirming',
        delivery_mode: deliveryMode,
      })
      .select()
      .single();
    if (error) throw error;

    // NOTE: Teams + push notifications are NOT sent here.
    // They fire only after the 30s cancel window via POST /:id/confirm.

    res.status(201).json({
      needs_followup: false,
      request: mapFulfillmentType(data),
      model,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/requests/queue-count — count of active orders (for ETA calculation)
router.get('/queue-count', async (_req, res, next) => {
  try {
    const { count: pending, error: e1 } = await supabaseAdmin
      .from('requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .eq('category', 'beverage');
    if (e1) throw e1;

    const { count: in_progress, error: e2 } = await supabaseAdmin
      .from('requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'in_progress')
      .eq('category', 'beverage');
    if (e2) throw e2;

    res.json({ pending: pending || 0, in_progress: in_progress || 0 });
  } catch (e) {
    next(e);
  }
});

// POST /api/requests/:id/confirm — called after 30s cancel window expires
// Moves order from confirming → pending/placed and fires notifications
router.post('/:id/confirm', async (req, res, next) => {
  try {
    // Fetch the order
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('requests')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !order) return res.status(404).json({ error: 'Order not found' });

    // Only the submitter can confirm their own order
    if (order.submitted_by !== req.user.id) {
      return res.status(403).json({ error: 'Not your order' });
    }

    // Only confirm if still in confirming state (not already cancelled)
    if (order.status !== 'confirming') {
      return res.json(order); // Already confirmed or cancelled — no-op
    }

    // Move to pending/placed (or auto-approve if night shift)
    const morning = isMorningShift(order.created_at);
    const updateData = morning
      ? { status: 'pending', live_status: 'placed' }
      : { status: 'done', live_status: 'Recorded', fulfilled_at: new Date().toISOString() };

    const { data, error } = await supabaseAdmin
      .from('requests')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    // NOW fire notifications if morning shift (active delivery/pickup workflow)
    if (morning) {
      const qty = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
      const itemName = order.parsed_item || order.raw_text || 'New order';
      const locPart = order.parsed_location ? ` to ${order.parsed_location}` : '';

      postOrderToTeams({ ...data, priority: 'Normal', quantity: String(qty) }).catch((e) =>
        console.error('[Teams confirm-order]', e.message)
      );

      // Notify the employee that their order is confirmed and placed
      sendPushToUsers([order.submitted_by], {
        title: '✅ Order Placed!',
        body: `Your ${itemName} is confirmed and the office boy has been notified.`,
        url: `/track/${data.id}`,
        tag: `placed-${data.id}`,
      }).catch(() => {});

      // Push notification to office boy / facility manager
      supabaseAdmin
        .from('profiles')
        .select('id')
        .in('role', ['office_boy', 'facility_manager'])
        .then(({ data: staffRows }) => {
          if (staffRows?.length)
            sendPushToUsers(
              staffRows.map((u) => u.id),
              {
                title: '🔔 New Order',
                body: `${order.parsed_employee_name || 'Someone'}: ${qty}x ${itemName}${locPart}`,
                url: '/queue',
                tag: `order-${data.id}`,
              }
            ).catch(() => {});
        });
    } else {
      // Send Recorded status confirmation push notification to employee
      const itemName = order.parsed_item || order.raw_text || 'Your order';
      sendPushToUsers([order.submitted_by], {
        title: '🌙 Order Recorded',
        body: `Your order for ${itemName} has been recorded for night shift.`,
        url: `/track/${data.id}`,
        tag: `status-${data.id}`,
      }).catch(() => {});
    }

    res.json(mapFulfillmentType(data));
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status;
    const isStaff = ['office_boy', 'facility_manager', 'leadership'].includes(req.user.role);

    let q = supabaseAdmin
      .from('v_request_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (!isStaff) q = q.eq('submitted_by', req.user.id);
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) throw error;
    res.json((data || []).map(mapFulfillmentType));
  } catch (e) {
    next(e);
  }
});

// GET /api/requests/:id — for live tracking
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('v_request_queue')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Request not found' });
    // Only the submitter or staff can view
    const isStaff = ['office_boy', 'facility_manager', 'leadership'].includes(req.user.role);
    if (!isStaff && data.submitted_by !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(mapFulfillmentType(data));
  } catch (e) {
    next(e);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    // 1. Fetch the request to check ownership and status
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('requests')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !order) return res.status(404).json({ error: 'Order not found' });

    // 2. Perform role/ownership check
    const isStaff = ['office_boy', 'facility_manager', 'leadership'].includes(req.user.role);
    const isOwner = order.submitted_by === req.user.id;

    // Submitters can only mark their own self-pickup orders as done when they are ready for pickup
    const isAllowedOwnerAction =
      isOwner &&
      order.delivery_mode === 'self_pickup' &&
      order.live_status === 'ready_for_pickup' &&
      req.body.status === 'done';

    if (!isStaff && !isAllowedOwnerAction) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const statusSchema = z.object({
      status: z.enum(['pending', 'in_progress', 'done', 'cancelled']),
      live_status: z.string().optional(),
      notes: z.string().optional(),
    });
    const { status, live_status, notes } = statusSchema.parse(req.body);

    const update = { status };
    if (live_status) update.live_status = live_status;
    if (notes !== undefined) update.notes = notes;

    if (status === 'in_progress' && !live_status) update.live_status = 'accepted';

    if (live_status === 'accepted') update.accepted_at = new Date().toISOString();
    if (live_status === 'preparing') update.started_at = new Date().toISOString();
    if (live_status === 'on_the_way') update.on_the_way_at = new Date().toISOString();
    if (live_status === 'ready_for_pickup')
      update.started_at = update.started_at || new Date().toISOString();
    if (status === 'done') {
      update.fulfilled_by = req.user.id;
      update.fulfilled_at = new Date().toISOString();
      update.live_status = 'done';
    }
    if (status === 'cancelled') {
      update.cancelled_at = new Date().toISOString();
      update.live_status = 'cancelled';
    }

    const { data, error } = await supabaseAdmin
      .from('requests')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    // ── Teams notification on staff cancel ─────────────────────────────────
    if (status === 'cancelled' && data) {
      postCancelToTeams(data, 'staff').catch((e) => console.error('[Teams cancel]', e.message));
    }

    // ── Restore stock on staff cancel ─────────────────────────────────────
    if (status === 'cancelled' && data) {
      await restoreStockForRequest(data);
    }

    // ── Push notification to the employee who placed the order ──────────────
    if (data?.submitted_by) {
      const effectiveStatus = update.live_status || live_status || status;
      const item = data.parsed_item || data.raw_text || 'your order';

      // Calculate delivery time for done status
      let deliveryTime = '';
      if (effectiveStatus === 'done' && data.created_at) {
        const mins = Math.round((Date.now() - new Date(data.created_at).getTime()) / 60000);
        deliveryTime = mins <= 1 ? 'in under a minute' : `in ${mins} min`;
      }

      // Load user tone for all status notifications (not just delivered)
      let userTone = 'Friendly';
      try {
        const { data: toneRow } = await supabaseAdmin
          .from('employee_cafeteria_preferences')
          .select('notification_tone')
          .eq('user_id', data.submitted_by)
          .maybeSingle();
        if (toneRow?.notification_tone) userTone = toneRow.notification_tone;
      } catch (_) {}

      // Witty delivery quotes by tone
      const DELIVERY_QUOTES = {
        Friendly: [
          `Enjoy your ${item}! ${deliveryTime} 🎉`,
          `${item} delivered ${deliveryTime}! Hope it makes your day ☀️`,
          `Here's your ${item} ${deliveryTime}! Rate it? ⭐`,
        ],
        Funny: [
          `${item} aa gaya ${deliveryTime}! Ab kaam karo 😂`,
          `Delivery done ${deliveryTime}! ${item} ke liye standing ovation 👏`,
          `${item} has landed ${deliveryTime}! Better than Zomato 💅`,
        ],
        'Mom Mode': [
          `Beta, ${item} aa gaya ${deliveryTime} 💝 Thanda mat hone dena!`,
          `${item} ready hai ${deliveryTime}! Dhyan se khana beta 🥰`,
          `Aa gaya ${item} ${deliveryTime}! Maa kasam mast hai 😊`,
        ],
        Professional: [
          `${item} delivered ${deliveryTime}. Please rate your experience.`,
          `Your ${item} is ready ${deliveryTime}. Enjoy.`,
        ],
        Minimal: [`${item} delivered ${deliveryTime}.`, `Done ${deliveryTime}. Enjoy.`],
        gen_z: [
          `${item} just dropped ${deliveryTime} no cap 🔥`,
          `slay bestie your ${item} is here ${deliveryTime} 💅✨`,
          `${item} ${deliveryTime}! its giving efficiency 💀`,
        ],
        boyfriend: [
          `Hey cutie, ${item} aa gaya ${deliveryTime} 💖 Enjoy karo!`,
          `Your ${item} is here ${deliveryTime} babe! Made with love 💕`,
          `${item} delivered ${deliveryTime}! Miss me while eating? 😘`,
        ],
        girlfriend: [
          `Hey handsome, ${item} ready hai ${deliveryTime} 💖`,
          `${item} aa gaya ${deliveryTime}! Tumhare liye special 🥰`,
          `Delivered ${deliveryTime}! Ab ${item} enjoy karo cutie 💕`,
        ],
      };

      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

      // Tone-aware messages for every order status
      const TONE_MESSAGES = {
        accepted: {
          Friendly: [`Your ${item} is accepted! 🙌 We're on it.`],
          Funny: [`${item} accepted! Office boy ne haath hilaya 🖐️`],
          'Mom Mode': [`Beta, ${item} aa raha hai 💝 Thoda wait karo!`],
          Professional: [`Order confirmed. ${item} is being processed.`],
          Minimal: [`${item} accepted.`],
          gen_z: [`ur ${item} got accepted bestie ✅ we're on it fr`],
          boyfriend: [`Hey babe, ${item} accepted! 💕 Coming right up~`],
          girlfriend: [`${item} accepted cutie! 💖 Won't be long!`],
        },
        preparing: {
          Friendly: [`${item} is being prepared fresh for you! 🍽️`],
          Funny: [`${item} ban raha hai! Suspense mat lo 😂`],
          'Mom Mode': [`Beta, ${item} tayar ho raha hai ghar jaisi care ke saath 🥰`],
          Professional: [`${item} is currently being prepared.`],
          Minimal: [`Preparing ${item}.`],
          gen_z: [`ur ${item} is literally being made rn 👀`],
          boyfriend: [`Making your ${item} with extra love 💕`],
          girlfriend: [`${item} coming up! Made just for you 🥰`],
        },
        on_the_way: {
          Friendly: [`${item} is on its way to you! 🛵`],
          Funny: [`${item} nikal pada! Better than Zomato 💅`],
          'Mom Mode': [`Beta, ${item} aa raha hai! Dhyan se lena 💝`],
          Professional: [`${item} is en route to your location.`],
          Minimal: [`${item} on the way.`],
          gen_z: [`${item} is literally coming to u rn no cap 🛵`],
          boyfriend: [`On my way with your ${item} babe! 🛵💕`],
          girlfriend: [`${item} is coming your way cutie! 💖`],
        },
        cancelled: {
          Friendly: [`Your ${item} was cancelled. Place a new order anytime! 😊`],
          Funny: [`Arre yaar! ${item} cancel ho gaya 😅 Try again!`],
          'Mom Mode': [`Beta, ${item} cancel ho gaya 😔 Kuch aur mangao!`],
          Professional: [`Order cancelled: ${item}. Please place a new order if needed.`],
          Minimal: [`${item} cancelled.`],
          gen_z: [`ur ${item} got cancelled bestie 💀 it's giving chaos`],
          boyfriend: [`Oops babe, ${item} cancelled 😢 Order again?`],
          girlfriend: [`${item} cancelled cutie 😔 Want to try again?`],
        },
      };

      const PUSH_MESSAGES = {
        accepted: {
          title: '✅ Order Accepted!',
          body: pick(TONE_MESSAGES.accepted[userTone] || TONE_MESSAGES.accepted.Friendly),
        },
        preparing: {
          title: '☕ Being Prepared!',
          body: pick(TONE_MESSAGES.preparing[userTone] || TONE_MESSAGES.preparing.Friendly),
        },
        on_the_way: {
          title: '🛵 On the Way!',
          body: pick(TONE_MESSAGES.on_the_way[userTone] || TONE_MESSAGES.on_the_way.Friendly),
        },
        ready_for_pickup: {
          title: '🏃 Ready for Pickup!',
          body:
            data.delivery_mode === 'self_pickup'
              ? 'Your food/drink is prepared. Please pick it up from the Cafeteria.'
              : `${item} is ready at the pantry counter. Come grab it! 🎉`,
        },
        done: {
          title: '🎉 Delivered!',
          body: pick(DELIVERY_QUOTES[userTone] || DELIVERY_QUOTES.Friendly),
        },
        cancelled: {
          title: '❌ Order Cancelled',
          body: pick(TONE_MESSAGES.cancelled[userTone] || TONE_MESSAGES.cancelled.Friendly),
        },
      };

      const msg = PUSH_MESSAGES[effectiveStatus];
      if (msg) {
        sendPushToUsers([data.submitted_by], {
          ...msg,
          url: `/track/${data.id}`,
          tag: `status-${data.id}`,
        }).catch(() => {});
      }
    }

    res.json(mapFulfillmentType(data));
  } catch (e) {
    next(e);
  }
});

// POST /api/requests/:id/cancel — self-cancel by order owner within 30s
router.post('/:id/cancel', async (req, res, next) => {
  try {
    // Fetch the order
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('requests')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr) throw fetchErr;
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Must be the owner
    if (order.submitted_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own orders' });
    }

    // Must be confirming or pending+placed (not yet accepted by office boy)
    const canCancel =
      order.status === 'confirming' ||
      (order.status === 'pending' && (!order.live_status || order.live_status === 'placed'));
    if (!canCancel) {
      return res
        .status(400)
        .json({ error: 'Order has already been accepted and cannot be cancelled' });
    }

    // Must be within 30 seconds
    const createdAt = new Date(order.created_at).getTime();
    const elapsed = (Date.now() - createdAt) / 1000;
    if (elapsed > 35) {
      // 5s grace for network latency
      return res.status(400).json({ error: 'Cancel window has expired' });
    }

    const { data, error } = await supabaseAdmin
      .from('requests')
      .update({
        status: 'cancelled',
        live_status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        notes: 'Cancelled by user',
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    // ── Teams notification on self-cancel (only if order was already confirmed/sent to office boy)
    if (order.status !== 'confirming') {
      postCancelToTeams(data, 'self').catch((e) => console.error('[Teams self-cancel]', e.message));
    }

    // ── Restore stock on cancel ──────────────────────────────────────
    await restoreStockForRequest(order);

    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /api/requests/:id/rate
// Writes to service_ratings (1-5 scale) — requests table has NO rating/feedback columns.
// Also stamps rating_status='done' on the request row so the UI knows it's rated.
router.post('/:id/rate', async (req, res, next) => {
  try {
    const { rating, feedback } = req.body;

    // Fetch the request to get office boy info
    const { data: reqRow } = await supabaseAdmin
      .from('requests')
      .select('id, submitted_by, fulfilled_by, assigned_to, rating_status')
      .eq('id', req.params.id)
      .maybeSingle();

    // Map 1-10 frontend rating → 1-5 DB scale (service_ratings.rating is int 1-5)
    const mappedRating = Math.max(1, Math.min(5, Math.round((rating || 1) / 2)));

    // Insert into service_ratings
    await supabaseAdmin.from('service_ratings').insert({
      request_id: req.params.id,
      employee_id: req.user.id,
      office_boy_id: reqRow?.fulfilled_by || reqRow?.assigned_to || null,
      rating: mappedRating,
      review_comment: feedback || null,
    });

    // Stamp rating, feedback, and rating_status on the requests table
    const { data, error } = await supabaseAdmin
      .from('requests')
      .update({
        rating_status: 'done',
        rating: rating,
        feedback: feedback || null,
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    // Trigger AI Learning async (pass numeric values, not the request id)
    learnFromRating(req.user.id, mappedRating, feedback || '').catch(console.error);

    // Return the request row enriched with the display-scale rating
    res.json({ ...data, rating: rating, feedback: feedback || null });
  } catch (e) {
    next(e);
  }
});

// Helper functions for stock depletion, restoration, and tone-aware notifications
function isBeverageUsingStirrer(itemName) {
  const nameLower = (itemName || '').toLowerCase();
  if (nameLower.includes('water')) return false;
  return (
    nameLower.includes('tea') ||
    nameLower.includes('coffee') ||
    nameLower.includes('latte') ||
    nameLower.includes('cappuccino') ||
    nameLower.includes('espresso') ||
    nameLower.includes('chocolate') ||
    nameLower.includes('badam') ||
    nameLower.includes('chai') ||
    nameLower.includes('macchiato')
  );
}

async function getUserTone(userId) {
  try {
    const { data: toneRow } = await supabaseAdmin
      .from('employee_cafeteria_preferences')
      .select('notification_tone')
      .eq('user_id', userId)
      .maybeSingle();
    if (toneRow?.notification_tone) return toneRow.notification_tone;
  } catch (_) {}
  return 'Friendly';
}

function getOOSMessage(_userTone, itemName) {
  return `${itemName} is currently out of stock.`;
}

async function deductStockForRequest(user, itemName, qty, instruction, breadType) {
  const nameLower = (itemName || '').toLowerCase();

  // Check if this is a virtual drink with a multi-ingredient backing map
  const virtualIngredients = VIRTUAL_DRINK_MAP[nameLower];

  if (virtualIngredients !== undefined) {
    // ── Virtual drink path ────────────────────────────────────────────────────
    // Could be multi-ingredient (e.g. Cappuccino = Coffee Beans + Milk)
    // Hot Water has empty array — no stock deduction needed
    if (virtualIngredients.length === 0) return; // Hot Water — no deduction

    for (const { item: backingItemName, servings: servingsPerCup } of virtualIngredients) {
      const deductAmt = Math.ceil(qty * servingsPerCup); // round up, always integer

      const { data: backingRow } = await supabaseAdmin
        .from('cafeteria_items')
        .select('id, item_name, stock_today, stock_servings')
        .ilike('item_name', backingItemName)
        .maybeSingle();

      if (!backingRow) {
        if (backingItemName === 'Milk') {
          const userTone = await getUserTone(user.id);
          throw new Error(getOOSMessage(userTone, `${itemName} (Milk ran out)`));
        }
        continue; // ingredient not tracked — skip silently
      }

      const effectiveStock = backingRow.stock_servings ?? backingRow.stock_today;
      if (effectiveStock !== null && effectiveStock !== undefined && effectiveStock < deductAmt) {
        const userTone = await getUserTone(user.id);
        // Use the virtual drink name for the error, ingredient name as context
        throw new Error(getOOSMessage(userTone, `${itemName} (${backingItemName} ran out)`));
      }

      // Deduct
      const updatePayload = {};
      if (backingRow.stock_servings !== null) {
        updatePayload.stock_servings = Math.max(0, (backingRow.stock_servings || 0) - deductAmt);
      } else if (backingRow.stock_today !== null) {
        updatePayload.stock_today = Math.max(0, (backingRow.stock_today || 0) - deductAmt);
      }
      if (Object.keys(updatePayload).length > 0) {
        await supabaseAdmin.from('cafeteria_items').update(updatePayload).eq('id', backingRow.id);
      }
    }

    // Also deduct stirrers for virtual beverages that need them
    if (isBeverageUsingStirrer(itemName)) {
      const stirrerNeeded = Math.round(qty * 1.5);
      const { data: stirItem } = await supabaseAdmin
        .from('cafeteria_items')
        .select('id, stock_servings')
        .ilike('item_name', 'Stirrers')
        .maybeSingle();
      if (stirItem && stirItem.stock_servings !== null) {
        if (stirItem.stock_servings < stirrerNeeded) {
          throw new Error(`Sorry, not enough stirrers left to prepare your ${itemName}.`);
        }
        await supabaseAdmin
          .from('cafeteria_items')
          .update({ stock_servings: (stirItem.stock_servings || 0) - stirrerNeeded })
          .eq('id', stirItem.id);
      }
    }
    return; // done with virtual drink
  }

  // ── Regular (non-virtual) item path ──────────────────────────────────────

  // 1b. Fetch the real DB row for this item
  const itemRow = await findCafeteriaItemForOrder(
    itemName,
    'id, item_name, display_name, frontend_name, stock_today, stock_servings, sides_option, dependencies'
  );

  if (!itemRow) {
    if (isSandwichSpread(itemName)) {
      const userTone = await getUserTone(user.id);
      throw new Error(getOOSMessage(userTone, displayOrderItemName(itemName)));
    }
    // Item not found in DB — allow order through but skip stock deduction
    return;
  }

  // 2. Check if we need to deduct stirrers
  const needsStirrers = isBeverageUsingStirrer(itemName);
  let stirrerItem = null;
  // Round to integer: column is INTEGER type. 1 beverage = Math.round(1.5) = 2 stirrers.
  const stirrerNeeded = Math.round(qty * 1.5);
  if (needsStirrers) {
    const { data: stir } = await supabaseAdmin
      .from('cafeteria_items')
      .select('id, stock_servings')
      .ilike('item_name', 'Stirrers')
      .maybeSingle();
    stirrerItem = stir;
    if (
      stirrerItem &&
      stirrerItem.stock_servings !== null &&
      stirrerItem.stock_servings < stirrerNeeded
    ) {
      throw new Error(`Sorry, not enough stirrers left to prepare your beverage.`);
    }
  }

  // 3. Determine sides multiplier and needed main servings.
  // Sandwiches always use 2 bread slices; both-sides only doubles the spread serving.
  const displayItemName = displayOrderItemName(itemName, itemRow);
  const isSandwich = isSandwichSpread(itemName) || isSandwichSpread(itemRow);
  const isBothSides = /both\s*(side|slice)/i.test(instruction);
  const sidesMultiplier = (itemRow.sides_option || isSandwich) && isBothSides ? 2 : 1;
  const neededForMain = itemRow.stock_servings !== null ? qty * sidesMultiplier : qty;

  const effectiveStock = itemRow.stock_servings ?? itemRow.stock_today;
  if (effectiveStock !== null && effectiveStock !== undefined && effectiveStock < neededForMain) {
    const userTone = await getUserTone(user.id);
    const msgs = getOOSMessage(userTone, displayItemName);
    throw new Error(msgs);
  }

  // 4. Check dependencies (like bread)
  const baseDeps = Array.isArray(itemRow.dependencies) ? itemRow.dependencies : [];
  const requiresBread = isSandwich || hasBreadDependency(baseDeps);
  if (requiresBread && !breadType) {
    const userTone = await getUserTone(user.id);
    throw new Error(getDependencyMessage(userTone, displayItemName, 'Bread'));
  }
  const deps = requiresBread && !hasBreadDependency(baseDeps) ? [...baseDeps, 'Bread'] : baseDeps;
  const depUpdates = [];
  if (Array.isArray(deps) && deps.length > 0) {
    for (const depName of deps) {
      const lookupName =
        String(depName).toLowerCase() === 'bread' && breadType ? breadType : depName;
      const depItem = await findCafeteriaItemForOrder(
        lookupName,
        'id, item_name, display_name, frontend_name, stock_today, stock_servings'
      );

      if (!depItem) {
        if (String(depName).toLowerCase() === 'bread') {
          const userTone = await getUserTone(user.id);
          throw new Error(getDependencyMessage(userTone, displayItemName, 'Bread'));
        }
        continue;
      }

      const isBread = isBreadName(depItem.item_name) || isBreadName(depName);
      const neededDepServings = isBread ? qty * 2 : qty * sidesMultiplier;

      const depStock = depItem.stock_today;
      const depServings = depItem.stock_servings;

      if (depServings !== null && depServings < neededDepServings) {
        const userTone = await getUserTone(user.id);
        const displayDep = depItem.display_name || depItem.item_name;
        throw new Error(getDependencyMessage(userTone, displayItemName, displayDep));
      }
      if (depStock !== null && depServings === null && depStock < neededDepServings) {
        const userTone = await getUserTone(user.id);
        const displayDep = depItem.display_name || depItem.item_name;
        throw new Error(getDependencyMessage(userTone, displayItemName, displayDep));
      }

      const depUpdate = { id: depItem.id, fields: {} };
      if (depServings !== null) {
        depUpdate.fields.stock_servings = depServings - neededDepServings;
      } else if (depStock !== null) {
        depUpdate.fields.stock_today = depStock - neededDepServings;
      }
      depUpdates.push(depUpdate);
    }
  }

  // 5. Apply all updates
  const mainUpdate = {};
  if (itemRow.stock_servings !== null) {
    mainUpdate.stock_servings = itemRow.stock_servings - neededForMain;
  } else if (itemRow.stock_today !== null) {
    mainUpdate.stock_today = itemRow.stock_today - neededForMain;
  }
  if (Object.keys(mainUpdate).length > 0) {
    await supabaseAdmin.from('cafeteria_items').update(mainUpdate).eq('id', itemRow.id);
    const alertServings = mainUpdate.stock_servings ?? mainUpdate.stock_today;
    if (alertServings !== null && alertServings <= 3 && alertServings >= 0) {
      postStockAlertToTeams({ ...itemRow, stock_servings: alertServings }).catch(() => {});
    }
  }

  for (const dep of depUpdates) {
    await supabaseAdmin.from('cafeteria_items').update(dep.fields).eq('id', dep.id);
  }

  if (needsStirrers && stirrerItem && stirrerItem.stock_servings !== null) {
    await supabaseAdmin
      .from('cafeteria_items')
      .update({ stock_servings: stirrerItem.stock_servings - stirrerNeeded })
      .eq('id', stirrerItem.id);
  }
}

async function restoreStockForRequest(order) {
  if (!order?.parsed_item) return;

  const itemName = order.parsed_item;
  const rawQty = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
  const isBoth = /both\s*(side|slice)/i.test(order.instruction || '');

  const nameLower = (itemName || '').toLowerCase();
  const virtualIngredients = VIRTUAL_DRINK_MAP[nameLower];

  if (virtualIngredients !== undefined) {
    // ── Virtual drink restore path ────────────────────────────────────────────
    if (virtualIngredients.length === 0) return; // Hot Water — nothing to restore

    for (const { item: backingItemName, servings: servingsPerCup } of virtualIngredients) {
      const restoreAmt = Math.ceil(rawQty * servingsPerCup);

      const { data: backingRow } = await supabaseAdmin
        .from('cafeteria_items')
        .select('id, stock_today, stock_servings')
        .ilike('item_name', backingItemName)
        .maybeSingle();

      if (!backingRow) continue;

      const updatePayload = {};
      if (backingRow.stock_servings !== null) {
        updatePayload.stock_servings = (backingRow.stock_servings || 0) + restoreAmt;
      } else if (backingRow.stock_today !== null) {
        updatePayload.stock_today = (backingRow.stock_today || 0) + restoreAmt;
      }
      if (Object.keys(updatePayload).length > 0) {
        await supabaseAdmin.from('cafeteria_items').update(updatePayload).eq('id', backingRow.id);
      }
    }

    // Restore stirrers for virtual beverages
    if (isBeverageUsingStirrer(itemName)) {
      const { data: stirItem } = await supabaseAdmin
        .from('cafeteria_items')
        .select('id, stock_servings')
        .ilike('item_name', 'Stirrers')
        .maybeSingle();
      if (stirItem && stirItem.stock_servings !== null) {
        await supabaseAdmin
          .from('cafeteria_items')
          .update({ stock_servings: (stirItem.stock_servings || 0) + Math.round(rawQty * 1.5) })
          .eq('id', stirItem.id);
      }
    }
    return;
  }

  // ── Regular (non-virtual) restore path ───────────────────────────────────

  const itemRow = await findCafeteriaItemForOrder(
    itemName,
    'id, item_name, display_name, frontend_name, stock_today, stock_servings, sides_option, dependencies'
  );

  if (!itemRow) {
    return;
  }

  // 1. Restore stirrers
  if (isBeverageUsingStirrer(itemName)) {
    const { data: stirItem } = await supabaseAdmin
      .from('cafeteria_items')
      .select('id, stock_servings')
      .ilike('item_name', 'Stirrers')
      .maybeSingle();
    if (stirItem && stirItem.stock_servings !== null) {
      // Use Math.round to match deduction: integer column can't store floats
      await supabaseAdmin
        .from('cafeteria_items')
        .update({ stock_servings: (stirItem.stock_servings || 0) + Math.round(rawQty * 1.5) })
        .eq('id', stirItem.id);
    }
  }

  const isSandwich = isSandwichSpread(itemName) || isSandwichSpread(itemRow);
  const sidesM = (itemRow.sides_option || isSandwich) && isBoth ? 2 : 1;

  // 2. Restore main item servings/stock
  const neededForMain = itemRow.stock_servings !== null ? rawQty * sidesM : rawQty;
  const restoreMain = {};
  if (itemRow.stock_servings !== null) {
    restoreMain.stock_servings = (itemRow.stock_servings || 0) + neededForMain;
  } else if (itemRow.stock_today !== null) {
    restoreMain.stock_today = (itemRow.stock_today || 0) + neededForMain;
  }
  if (Object.keys(restoreMain).length > 0) {
    await supabaseAdmin.from('cafeteria_items').update(restoreMain).eq('id', itemRow.id);
  }

  // 3. Restore dependencies
  const staffBreadMatch = order.raw_text?.match(/\[bread:(.+?)\]/);
  const breadType = staffBreadMatch ? staffBreadMatch[1] : null;
  const baseDeps = Array.isArray(itemRow.dependencies) ? itemRow.dependencies : [];
  const requiresBread = isSandwich || hasBreadDependency(baseDeps);
  const deps = requiresBread && !hasBreadDependency(baseDeps) ? [...baseDeps, 'Bread'] : baseDeps;

  if (Array.isArray(deps) && deps.length > 0) {
    for (const depName of deps) {
      const lookupName =
        String(depName).toLowerCase() === 'bread' && breadType ? breadType : depName;
      const depItem = await findCafeteriaItemForOrder(
        lookupName,
        'id, item_name, display_name, frontend_name, stock_today, stock_servings'
      );

      if (!depItem) continue;

      const isBread = isBreadName(depItem.item_name) || isBreadName(depName);
      const neededDepServings = isBread ? rawQty * 2 : rawQty * sidesM;

      const restoreDep = {};
      if (depItem.stock_servings !== null) {
        restoreDep.stock_servings = (depItem.stock_servings || 0) + neededDepServings;
      } else if (depItem.stock_today !== null) {
        restoreDep.stock_today = (depItem.stock_today || 0) + neededDepServings;
      }

      if (Object.keys(restoreDep).length > 0) {
        await supabaseAdmin.from('cafeteria_items').update(restoreDep).eq('id', depItem.id);
      }
    }
  }
}

export default router;
