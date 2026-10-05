import { Router } from 'express';
import QRCode from 'qrcode';
import { supabaseAdmin } from '../../lib/supabase.js';
import { requireRole } from '../../middleware/auth.js';
import {
  attachMealCheckins,
  createMealQrToken,
  filterBookingsByShift,
  isMealDate,
  isMealServiceClosed,
  istDateAndMinutes,
  mealQrSecret,
  registerMealCheckin,
  summarizeDailyServings,
  summarizeMealBookings,
} from './service.js';

const router = Router();
const CHECKIN_ROLES = ['leadership', 'office_boy', 'admin', 'vendor'];
const MEAL_CHOICES = ['veg', 'non_veg', 'egg'];

function todayInIst() {
  return istDateAndMinutes().date;
}

function serviceCutoff(shift = 'day') {
  if (shift === 'night') return '24:00';
  return process.env.MEAL_CHECKIN_SERVICE_CLOSE_IST || '14:00';
}

function profileName(profile) {
  return profile?.preferred_name || profile?.full_name || 'Unknown';
}

async function profileForBooking(userId) {
  const result = await supabaseAdmin
    .from('profiles')
    .select('preferred_name, full_name, employee_code')
    .eq('id', userId)
    .maybeSingle();

  if (result.error && /employee_code/i.test(result.error.message || '')) {
    const fallback = await supabaseAdmin
      .from('profiles')
      .select('preferred_name, full_name')
      .eq('id', userId)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    return fallback.data;
  }
  if (result.error) throw result.error;
  return result.data;
}

async function shiftForUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('employee_cafeteria_preferences')
    .select('shift')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.shift === 'night' ? 'night' : 'day';
}

router.get('/my-qr', async (req, res, next) => {
  try {
    const mealDate = req.query.date || todayInIst();
    if (!isMealDate(mealDate))
      return res.status(400).json({ error: 'A valid meal date is required.' });

    const { data: booking, error } = await supabaseAdmin
      .from('meal_bookings')
      .select('id, meal_date, choice')
      .eq('user_id', req.user.id)
      .eq('meal_date', mealDate)
      .maybeSingle();

    if (error) throw error;
    if (!booking || !MEAL_CHOICES.includes(booking.choice)) {
      return res.status(404).json({ error: 'No eligible meal booking found for this date.' });
    }

    const token = createMealQrToken({
      bookingId: booking.id,
      mealDate: booking.meal_date,
      secret: mealQrSecret(),
    });
    const qrCode = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
    });
    res.json({ meal_date: booking.meal_date, choice: booking.choice, token, qr_code: qrCode });
  } catch (error) {
    next(error);
  }
});

router.post('/scan', requireRole(...CHECKIN_ROLES), async (req, res, next) => {
  try {
    const { token, date } = req.body || {};
    const result = await registerMealCheckin({
      token,
      selectedDate: date,
      todayDate: todayInIst(),
      actorId: req.user.id,
      secret: mealQrSecret(),
      repository: {
        async checkInMeal({ bookingId, mealDate, actorId }) {
          const { data: booking, error } = await supabaseAdmin
            .from('meal_bookings')
            .select('id, user_id, meal_date, choice')
            .eq('id', bookingId)
            .eq('meal_date', mealDate)
            .maybeSingle();
          if (error) throw error;
          if (!booking) return { status: 'invalid', booking_id: bookingId };
          if (!MEAL_CHOICES.includes(booking.choice)) {
            return { status: 'skipped', booking_id: bookingId };
          }
          const [profile, shift] = await Promise.all([
            profileForBooking(booking.user_id),
            shiftForUser(booking.user_id),
          ]);
          const { data: checkin, error: checkinError } = await supabaseAdmin
            .from('meal_checkins')
            .upsert(
              {
                meal_booking_id: bookingId,
                meal_date: mealDate,
                meal_choice: booking.choice,
                checked_in_by: actorId,
              },
              { onConflict: 'meal_booking_id', ignoreDuplicates: true }
            )
            .select('id, checked_in_at')
            .maybeSingle();
          if (checkinError) throw checkinError;

          let result;
          if (checkin) {
            result = {
              status: 'served',
              booking_id: bookingId,
              checked_in_at: checkin.checked_in_at,
            };
          } else {
            const { data: existingCheckin, error: existingError } = await supabaseAdmin
              .from('meal_checkins')
              .select('checked_in_at')
              .eq('meal_booking_id', bookingId)
              .maybeSingle();
            if (existingError) throw existingError;
            if (!existingCheckin) {
              throw new Error('Meal check-in was ignored but no existing check-in was found.');
            }
            result = {
              status: 'already_served',
              booking_id: bookingId,
              checked_in_at: existingCheckin.checked_in_at,
            };
          }
          return {
            ...result,
            employee: {
              name: profileName(profile),
              employee_code: profile?.employee_code || '',
              choice: booking.choice,
              shift,
            },
          };
        },
      },
    });

    const errors = {
      invalid_date: [400, 'A valid service date is required.'],
      invalid_token: [400, 'This meal QR is invalid.'],
      wrong_date: [409, 'This QR is not valid for today’s meal service.'],
      invalid: [404, 'No eligible meal booking was found.'],
      skipped: [409, 'This meal booking was skipped and cannot be served.'],
    };
    if (errors[result?.status]) {
      const [status, message] = errors[result.status];
      return res.status(status).json({ status: result.status, error: message });
    }

    if (!result?.booking_id)
      return res.status(500).json({ error: 'Check-in response did not include a booking.' });

    res.json({
      status: result.status,
      already_served: result.status === 'already_served',
      checked_in_at: result.checked_in_at,
      employee: result.employee,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/summary', requireRole(...CHECKIN_ROLES), async (req, res, next) => {
  try {
    const mealDate = req.query.date || todayInIst();
    const shift = req.query.shift || 'all';
    if (!isMealDate(mealDate))
      return res.status(400).json({ error: 'A valid meal date is required.' });
    if (!['all', 'day', 'night'].includes(shift))
      return res.status(400).json({ error: 'Shift must be all, day, or night.' });

    const { data: allBookings, error } = await supabaseAdmin
      .from('meal_bookings')
      .select('id, user_id, choice')
      .eq('meal_date', mealDate)
      .in('choice', MEAL_CHOICES)
      .order('booked_at', { ascending: true });
    if (error) throw error;

    const bookings = allBookings || [];
    const bookingUserIds = [...new Set(bookings.map((booking) => booking.user_id))];
    let preferences = [];
    if (bookingUserIds.length) {
      const { data, error: preferencesError } = await supabaseAdmin
        .from('employee_cafeteria_preferences')
        .select('user_id, shift')
        .in('user_id', bookingUserIds);
      if (preferencesError) throw preferencesError;
      preferences = data || [];
    }

    const rows = filterBookingsByShift(bookings, preferences, shift);
    const bookingIds = rows.map((booking) => booking.id);
    let checkins = [];
    if (bookingIds.length) {
      const { data, error: checkinError } = await supabaseAdmin
        .from('meal_checkins')
        .select('meal_booking_id, meal_date, meal_choice, checked_in_at, checked_in_by')
        .eq('meal_date', mealDate)
        .in('meal_booking_id', bookingIds)
        .order('checked_in_at', { ascending: true });
      if (checkinError) throw checkinError;
      checkins = data || [];
    }
    const dailyServings = summarizeDailyServings(checkins, mealDate);

    const rowsWithCheckins = attachMealCheckins(rows, checkins);
    const cutoff = serviceCutoff(shift);
    const summary = summarizeMealBookings(rowsWithCheckins, { mealDate, cutoff });
    const closed = isMealServiceClosed(mealDate, new Date(), cutoff);
    const profileIds = [
      ...new Set([
        ...rows.map((booking) => booking.user_id),
        ...checkins.map((checkin) => checkin.checked_in_by).filter(Boolean),
      ]),
    ];
    let profileById = new Map();
    if (profileIds.length) {
      const { data: profiles, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, preferred_name, employee_code')
        .in('id', profileIds);
      if (profileError) throw profileError;
      profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    }

    const checkinByBooking = new Map(checkins.map((checkin) => [checkin.meal_booking_id, checkin]));
    const shiftByUserId = new Map(
      preferences.map((preference) => [preference.user_id, preference.shift])
    );
    const details = rows.map((booking) => {
      const checkin = checkinByBooking.get(booking.id);
      const served = Boolean(checkin?.checked_in_at);
      const profile = profileById.get(booking.user_id);
      const checker = checkin?.checked_in_by ? profileById.get(checkin.checked_in_by) : null;
      return {
        booking_id: booking.id,
        employee_name: profileName(profile),
        employee_code: profile?.employee_code || '',
        shift: shiftByUserId.get(booking.user_id) === 'night' ? 'night' : 'day',
        choice: booking.choice,
        status: served ? 'served' : closed ? 'no_show' : 'not_yet_served',
        checked_in_at: checkin?.checked_in_at || null,
        checked_in_by: served ? profileName(checker) : null,
      };
    });

    res.json({
      ...summary,
      shift,
      service_cutoff_ist: cutoff,
      service_closed: closed,
      daily_servings: dailyServings,
      bookings: details,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
