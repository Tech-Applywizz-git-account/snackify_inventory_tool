import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

function getISTDateString() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString()
    .slice(0, 10);
}

function getCabinName(bookingCabin, preferredLocation) {
  if (bookingCabin) return bookingCabin;
  const locationToCabin = {
    'Balaji Cabin': 'Balaji Cabin',
    'RK Cabin': 'Rama Krishna Cabin',
    'Manisha Cabin': 'Manisha Cabin',
    'Resume Cabin': 'Resume Cabin',
    'Tech Team': 'Tech Cabin',
    'Marketing Team': 'Marketing Cabin',
  };
  return locationToCabin[preferredLocation] || preferredLocation || 'Unassigned';
}

router.post('/sync-missing-cabins', async (req, res, next) => {
  try {
    const secret = req.query.secret || req.body?.secret || req.headers['x-cron-secret'];
    const cronSecret = process.env.CRON_SECRET || 'app_wizz_cron_secret_change_in_production';

    if (secret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const todayStr = getISTDateString();

    // 1. Fetch bookings where cabin_name is null and choice != 'skip' for today and future
    const { data: bookings, error: bookingsErr } = await supabaseAdmin
      .from('meal_bookings')
      .select('id, user_id, meal_date')
      .is('cabin_name', null)
      .neq('choice', 'skip')
      .gte('meal_date', todayStr);

    if (bookingsErr) throw bookingsErr;

    if (!bookings || bookings.length === 0) {
      return res.json({ ok: true, message: 'No bookings found with missing cabin names.', synced: 0 });
    }

    // 2. Fetch employee preferences for the users
    const userIds = [...new Set(bookings.map((b) => b.user_id))];
    const { data: prefs, error: prefsErr } = await supabaseAdmin
      .from('employee_cafeteria_preferences')
      .select('user_id, cabin, preferred_location')
      .in('user_id', userIds);

    if (prefsErr) throw prefsErr;

    const userCabinMap = {};
    for (const p of prefs || []) {
      userCabinMap[p.user_id] = getCabinName(p.cabin, p.preferred_location);
    }

    // 3. Update bookings sequentially to prevent conflicts
    let syncedCount = 0;
    const syncedDetails = [];

    for (const booking of bookings) {
      const resolvedCabin = userCabinMap[booking.user_id];
      if (resolvedCabin) {
        const { error: updateErr } = await supabaseAdmin
          .from('meal_bookings')
          .update({ cabin_name: resolvedCabin })
          .eq('id', booking.id);

        if (updateErr) {
          console.error(`[SyncCabinCron] Failed to update booking ${booking.id}:`, updateErr.message);
        } else {
          syncedCount++;
          syncedDetails.push({ bookingId: booking.id, userId: booking.user_id, cabinName: resolvedCabin });
        }
      }
    }

    res.json({
      ok: true,
      message: `Successfully synchronized ${syncedCount} booking(s) with missing cabin names.`,
      synced: syncedCount,
      details: syncedDetails,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
