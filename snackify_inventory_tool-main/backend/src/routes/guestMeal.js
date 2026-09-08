import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { sendGuestMealNotificationEmail } from '../lib/microsoftGraph.js';
import { CABIN_PRINT_ORDER } from './cron.js';

const router = Router();

// Pool of guest user profile UUIDs.
// We start with the profile ID you created. You can add more guest profile UUIDs here if needed.
const GUEST_POOL = [
  '3d168a5b-ea4c-4622-a02c-a4d36edd9da2'
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function getISTDateString() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString()
    .slice(0, 10);
}

function generateTokenNumber(mealDate, cabinAbbr, sequenceNum) {
  const d = new Date(`${mealDate}T00:00:00+05:30`);
  const day = String(d.getDate()).padStart(2, '0');
  const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const month = monthNames[d.getMonth()];
  const seq = String(sequenceNum).padStart(3, '0');
  return `${day}${month}-${cabinAbbr}-${seq}`;
}

// ── POST /api/guest-meal/book ──────────────────────────────────────────────────
// Finds a free Guest Profile ID for today and inserts the booking into meal_bookings.
router.post(
  '/book',
  authMiddleware,
  requireRole('leadership', 'office_boy', 'facility_manager', 'finance'),
  async (req, res, next) => {
    try {
      const { guest_name, meal_type } = req.body || {};

      if (!guest_name || typeof guest_name !== 'string' || guest_name.trim().length === 0) {
        return res.status(400).json({ error: 'guest_name is required' });
      }
      if (!['veg', 'non_veg'].includes(meal_type)) {
        return res.status(400).json({ error: 'meal_type must be "veg" or "non_veg"' });
      }

      const mealDate = getISTDateString();

      // Find which Guest profile IDs are already booked for today
      const { data: todayBookings, error: fetchErr } = await supabaseAdmin
        .from('meal_bookings')
        .select('user_id')
        .eq('meal_date', mealDate)
        .in('user_id', GUEST_POOL);

      if (fetchErr) throw fetchErr;

      const bookedIds = new Set((todayBookings || []).map(b => b.user_id));
      const freeGuestId = GUEST_POOL.find(id => !bookedIds.has(id));

      if (!freeGuestId) {
        return res.status(400).json({
          error: 'No guest booking slots available for today. Please contact administrator.'
        });
      }

      // Insert guest meal booking into database
      const { data: booking, error: insertErr } = await supabaseAdmin
        .from('meal_bookings')
        .insert({
          user_id: freeGuestId,
          meal_date: mealDate,
          choice: meal_type,
          is_guest: true,
          guest_name: guest_name.trim(),
          booked_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;

      // Fetch leadership + finance emails for notification
      const { data: recipients } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .in('role', ['leadership', 'finance'])
        .eq('active', true);

      // Build the accept URL
      const baseUrl = process.env.APP_URL || 'https://snackify-inventory-tool.onrender.com';
      const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';
      const acceptUrl = `${baseUrl}/api/guest-meal/accept?bookingId=${booking.id}&secret=${cronSecret}`;

      const bookedBy = req.user.full_name || req.user.preferred_name || req.user.email || 'Staff';

      // Send notification email (non-blocking)
      sendGuestMealNotificationEmail({
        bookingId: booking.id,
        guestName: guest_name.trim(),
        mealType: meal_type,
        bookedBy,
        mealDate,
        acceptUrl,
        recipients: recipients || [],
      }).catch((e) => {
        console.error('[GuestMeal] Failed to send notification email:', e.message);
      });

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

// ── GET /api/guest-meal/accept ──────────────────────────────────────────────────
// Finds the booking by ID, assigns cabin + token, updates the database, and prints.
router.get('/accept', async (req, res, next) => {
  try {
    const { bookingId, secret } = req.query;
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (!secret || secret !== cronSecret) {
      return res.status(401).send('<h2>Unauthorized — invalid secret.</h2>');
    }
    if (!bookingId) {
      return res.status(400).send('<h2>Missing bookingId parameter.</h2>');
    }

    // Fetch the booking from database
    const { data: booking, error: fetchErr } = await supabaseAdmin
      .from('meal_bookings')
      .select('id, guest_name, choice, meal_date, token_number, cabin_name, is_guest')
      .eq('id', bookingId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!booking) {
      return res.status(404).send('<h2>Booking not found.</h2>');
    }

    // If already accepted, show print receipt directly
    if (booking.token_number && booking.cabin_name) {
      return res.send(buildAcceptedPage(booking, true));
    }

    // Assign cabin — guests go to Balaji Cabin (first cabin)
    const guestCabin = CABIN_PRINT_ORDER[0];

    // Find the next sequence number for this date + cabin
    const { count: existingCount } = await supabaseAdmin
      .from('meal_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('meal_date', booking.meal_date)
      .eq('cabin_name', guestCabin.name)
      .not('token_number', 'is', null);

    const seqNum = (existingCount || 0) + 1;
    const tokenNumber = generateTokenNumber(booking.meal_date, 'GUEST', seqNum);

    // Update the booking row in meal_bookings
    const { error: updateErr } = await supabaseAdmin
      .from('meal_bookings')
      .update({ token_number: tokenNumber, cabin_name: guestCabin.name })
      .eq('id', bookingId);

    if (updateErr) throw updateErr;

    const updatedBooking = {
      ...booking,
      token_number: tokenNumber,
      cabin_name: guestCabin.name,
    };

    res.send(buildAcceptedPage(updatedBooking, false));
  } catch (e) {
    next(e);
  }
});

// ── Build HTML page shown after clicking Accept ────────────────────────────────
function buildAcceptedPage(booking, alreadyAccepted) {
  const mealLabel = booking.choice === 'veg' ? '🥦 Veg' : '🍗 Non-Veg';
  const bannerMsg = alreadyAccepted
    ? '⚠️ This booking was already accepted. Showing existing token.'
    : '✅ Guest meal accepted! Token and cabin have been assigned.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Guest Meal Token — Snackify</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f6f9fc; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 40px 20px; }
    .card { background: #fff; border-radius: 16px; padding: 36px; max-width: 440px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .banner { background: ${alreadyAccepted ? '#fef9c3' : '#ecfdf5'}; border: 1px solid ${alreadyAccepted ? '#fde047' : '#86efac'}; border-radius: 10px; padding: 12px 16px; font-size: 14px; font-weight: 600; color: ${alreadyAccepted ? '#713f12' : '#166534'}; margin-bottom: 24px; }
    h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
    .sub { font-size: 14px; color: #64748b; margin-bottom: 28px; }
    .token-box { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border-radius: 12px; padding: 20px 24px; text-align: center; margin-bottom: 20px; }
    .token-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.8; margin-bottom: 6px; }
    .token-number { font-size: 28px; font-weight: 800; letter-spacing: 0.04em; }
    .details { border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px; }
    .detail-row { display: flex; justify-content: space-between; padding: 12px 16px; font-size: 14px; }
    .detail-row:not(:last-child) { border-bottom: 1px solid #f1f5f9; }
    .detail-label { color: #64748b; }
    .detail-value { font-weight: 600; color: #0f172a; }
    .print-btn { display: block; width: 100%; padding: 14px; background: #6366f1; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; text-align: center; }
    .print-btn:hover { background: #4f46e5; }

    @media print {
      body { background: #fff; padding: 0; }
      .card { display: none; }
      .receipt { display: block !important; }
    }
    .receipt { display: none; }
    @page { size: 80mm auto; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="banner">${bannerMsg}</div>
    <h1>🍽️ Guest Meal Token</h1>
    <p class="sub">Token and cabin have been assigned for this guest.</p>

    <div class="token-box">
      <div class="token-label">Token Number</div>
      <div class="token-number">${booking.token_number}</div>
    </div>

    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Guest Name</span>
        <span class="detail-value">${booking.guest_name}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Meal Type</span>
        <span class="detail-value">${mealLabel}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Meal Date</span>
        <span class="detail-value">${booking.meal_date}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Cabin</span>
        <span class="detail-value">${booking.cabin_name}</span>
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">🖨️ Print Receipt</button>
  </div>

  <!-- Print receipt (80mm thermal style) -->
  <div class="receipt">
    <div style="font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; padding: 4mm 2mm; color: #000;">
      <div style="text-align: center; font-weight: bold; font-size: 14px;">APPLYWIZZ OFFICE PANTRY</div>
      <div style="border-top: 1px dashed #000; margin: 4px 0;"></div>
      <div style="display: flex; justify-content: space-between; padding: 1px 0;"><span>Type</span><span style="font-weight:bold;">GUEST MEAL</span></div>
      <div style="display: flex; justify-content: space-between; padding: 1px 0;"><span>Date</span><span>${booking.meal_date}</span></div>
      <div style="border-top: 1px dashed #000; margin: 4px 0;"></div>
      <div style="display: flex; justify-content: space-between; padding: 1px 0;"><span>Guest</span><span style="font-weight:bold;">${booking.guest_name}</span></div>
      <div style="display: flex; justify-content: space-between; padding: 1px 0;"><span>Meal</span><span>${booking.choice === 'veg' ? 'Veg' : 'Non-Veg'}</span></div>
      <div style="display: flex; justify-content: space-between; padding: 1px 0;"><span>Cabin</span><span>${booking.cabin_name}</span></div>
      <div style="border-top: 1px dashed #000; margin: 4px 0;"></div>
      <div style="text-align: center; font-size: 16px; font-weight: bold; margin-top: 8px;">TOKEN: ${booking.token_number}</div>
      <div style="text-align: center; font-size: 9px; margin-top: 6px;">Powered by ApplyWizz Snackify</div>
    </div>
  </div>

  <script>
    // Auto-trigger print dialog on page load
    ${alreadyAccepted ? '// Already accepted — no auto print' : 'window.addEventListener("load", () => { setTimeout(() => window.print(), 800); });'}
  </script>
</body>
</html>`;
}

export default router;
