import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronLeft, ChevronRight, History, Ticket, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

function getISTParts(dateObj = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(dateObj);
    const m = {};
    for (const p of parts) {
      m[p.type] = p.value;
    }
    return {
      year: parseInt(m.year, 10),
      month: parseInt(m.month, 10) - 1, // 0-indexed
      day: parseInt(m.day, 10),
      hour: parseInt(m.hour, 10),
      minute: parseInt(m.minute, 10),
      second: parseInt(m.second, 10),
    };
  } catch (e) {
    console.error('Error formatting IST parts, falling back to local system:', e);
    return {
      year: dateObj.getFullYear(),
      month: dateObj.getMonth(),
      day: dateObj.getDate(),
      hour: dateObj.getHours(),
      minute: dateObj.getMinutes(),
      second: dateObj.getSeconds(),
    };
  }
}

function getOpeningTimeLabel(mealDateStr, shift) {
  const [year, month, day] = mealDateStr.split('-').map(Number);
  const mealDateObj = new Date(Date.UTC(year, month - 1, day));
  const dow = mealDateObj.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  const openDate = new Date(mealDateObj);
  if (shift === 'morning') {
    // Morning shift opens at 9:00 AM on the day before, except Monday which opens on Friday
    if (dow === 1) {
      // Monday
      openDate.setUTCDate(mealDateObj.getUTCDate() - 3); // Friday
    } else {
      openDate.setUTCDate(mealDateObj.getUTCDate() - 1); // Day before
    }
    const formatter = new Intl.DateTimeFormat('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
    const dayName = formatter.format(openDate);
    return `${dayName} at 9:00 AM`;
  } else {
    // Night shift opens at 8:00 PM on the day before (since dinner is same day and they work previous night)
    openDate.setUTCDate(mealDateObj.getUTCDate() - 1); // Day before
    const formatter = new Intl.DateTimeFormat('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
    const dayName = formatter.format(openDate);
    return `${dayName} at 8:00 PM`;
  }
}

function getToneMessage(tone, shift, openTimeLabel) {
  const isMorning = shift === 'morning';

  const messages = {
    gen_z: isMorning
      ? `No cap bestie, this lunch opens on ${openTimeLabel} 🤫. Don't sleep on it! 🍱🔥`
      : `Hold up bestie, dinner bookings unlock on ${openTimeLabel} 🌙. Stay tuned! 🍕✨`,
    Friendly: isMorning
      ? `This lunch isn't open for booking yet! It will open on ${openTimeLabel} 😊. See you then!`
      : `Almost ready! You can book this dinner starting ${openTimeLabel} 🌙. Have a wonderful day!`,
    Professional: isMorning
      ? `Booking for this lunch is currently unavailable. It will open on ${openTimeLabel}.`
      : `This dinner booking session is locked. The window opens on ${openTimeLabel}.`,
    Funny: isMorning
      ? `Patience, hungry human! 🤤 Lunch booking starts on ${openTimeLabel}. Don't eat your screen until then!`
      : `The kitchen is sleeping! 😴 Dinner booking opens on ${openTimeLabel}. Keep those cravings in check!`,
    'Mom Mode': isMorning
      ? `Beta, please wait! 💝 The lunch booking isn't open yet. It will open on ${openTimeLabel}. I'll make sure you get a hot meal! 🥰`
      : `Mera pyara baccha, dinner booking starts on ${openTimeLabel} 🌙. Don't worry, mom will remind you to book on time! 😘`,
    boyfriend: isMorning
      ? `Hey cutie, the kitchen isn't ready for us yet! 😉 Lunch booking opens on ${openTimeLabel}. I'll make sure we book together! 💕`
      : `Dinner's on me, but we have to wait until ${openTimeLabel} to book it! 😘 Stay sweet, cutie! 💖`,
    girlfriend: isMorning
      ? `Hey handsome, don't be in such a rush! 😜 Lunch booking starts on ${openTimeLabel}. Can't wait for us to have lunch! 💖`
      : `Patience, handsome! Dinner booking opens on ${openTimeLabel} 🌙. Make sure you book on time so you don't go hungry! 💕`,
    Minimal: isMorning
      ? `Lunch booking opens ${openTimeLabel}.`
      : `Dinner booking opens ${openTimeLabel}.`,
  };

  return messages[tone] || messages.Friendly;
}

function getBookingStatus(dateStr, shift = 'morning', todayDateObj) {
  const nowObj = todayDateObj || new Date();

  if (Number.isNaN(nowObj.getTime())) {
    return { canBook: false, canSkip: false, reason: 'error' };
  }

  const parts = getISTParts(nowObj);
  const currentHour = parts.hour + parts.minute / 60;

  const [tYear, tMonth, tDay] = dateStr.split('-').map(Number);
  if (!tYear || !tMonth || !tDay) {
    return { canBook: false, canSkip: false, reason: 'error' };
  }

  const targetDateUTC = Date.UTC(tYear, tMonth - 1, tDay);
  const todayDateUTC = Date.UTC(parts.year, parts.month, parts.day);
  const diffDays = Math.round((targetDateUTC - todayDateUTC) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { canBook: false, canSkip: false, reason: 'past' };
  }

  function getNextWorkingDay(y, m, d) {
    const temp = new Date(Date.UTC(y, m, d));
    temp.setUTCDate(temp.getUTCDate() + 1);
    while (temp.getUTCDay() === 0 || temp.getUTCDay() === 6) {
      temp.setUTCDate(temp.getUTCDate() + 1);
    }
    return `${temp.getUTCFullYear()}-${String(temp.getUTCMonth() + 1).padStart(2, '0')}-${String(temp.getUTCDate()).padStart(2, '0')}`;
  }

  if (shift === 'morning') {
    const nextWD = getNextWorkingDay(parts.year, parts.month, parts.day);
    if (dateStr !== nextWD) {
      return {
        canBook: false,
        canSkip: false,
        reason: dateStr < nextWD ? 'past' : 'future_locked',
      };
    }

    const targetDateObj = new Date(Date.UTC(tYear, tMonth - 1, tDay));
    const dow = targetDateObj.getUTCDay();
    const todayDay = new Date(Date.UTC(parts.year, parts.month, parts.day)).getUTCDay();

    // Weekend logic for Monday's meal: opens Friday at 9 AM, closes Sunday at 8 PM.
    if (dow === 1 && (todayDay === 5 || todayDay === 6 || todayDay === 0)) {
      if (todayDay === 5 && currentHour < 9) {
        return { canBook: false, canSkip: false, reason: 'not_open_yet' };
      }
      if (todayDay === 0) {
        if (currentHour >= 20) return { canBook: false, canSkip: false, reason: 'locked' };
        if (currentHour >= 18) return { canBook: false, canSkip: true, reason: 'skip_only' };
      }
      return { canBook: true, canSkip: true, reason: 'open' };
    }

    if (currentHour < 9) {
      return { canBook: false, canSkip: false, reason: 'not_open_yet' };
    }
    if (currentHour >= 20) {
      return { canBook: false, canSkip: false, reason: 'locked' };
    }
    if (currentHour >= 18) {
      return { canBook: false, canSkip: true, reason: 'skip_only' };
    }
    return { canBook: true, canSkip: true, reason: 'open' };
  } else {
    // Night Shift
    if (diffDays === 1) {
      if (currentHour >= 20) {
        return { canBook: true, canSkip: true, reason: 'open' };
      }
      return { canBook: false, canSkip: false, reason: 'not_open_yet' };
    }

    if (diffDays === 0) {
      if (currentHour >= 17) {
        return { canBook: false, canSkip: false, reason: 'locked' };
      }
      if (currentHour >= 14) {
        return { canBook: false, canSkip: true, reason: 'skip_only' };
      }
      return { canBook: true, canSkip: true, reason: 'open' };
    }

    return { canBook: false, canSkip: false, reason: 'future_locked' };
  }
}

const CHOICE_UI = {
  veg: {
    emoji: '🥬',
    label: 'Veg',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    ring: 'ring-emerald-400',
    badge: 'bg-emerald-100 text-emerald-700',
  },
  non_veg: {
    emoji: '🍗',
    label: 'Non-Veg',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    ring: 'ring-red-400',
    badge: 'bg-red-100 text-red-700',
  },
  egg: {
    emoji: '🥚',
    label: 'Egg',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    ring: 'ring-amber-400',
    badge: 'bg-amber-100 text-amber-700',
  },
  skip: {
    emoji: '🚫',
    label: 'Skip',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-500',
    ring: 'ring-slate-400',
    badge: 'bg-slate-100 text-slate-500',
  },
};

const DAY_OPTIONS = {
  1: ['veg'], // Mon
  2: ['veg', 'egg'], // Tue
  3: ['veg', 'non_veg'], // Wed
  4: ['veg', 'egg'], // Thu
  5: ['veg', 'non_veg'], // Fri
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function getMonthStr(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

// ── Toast notification ────────────────────────────────────────────────────────
function Toast({ message, type, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const isError = type === 'error';
  return (
    <motion.div
      initial={{ y: -60, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -60, opacity: 0, scale: 0.95 }}
      className="fixed top-4 left-4 right-4 z-[100] flex justify-center pointer-events-none"
    >
      <div
        className={`pointer-events-auto max-w-sm w-full rounded-2xl shadow-2xl border-2 p-4 flex items-center gap-3 backdrop-blur-sm ${
          isError
            ? 'bg-rose-50/95 border-rose-200 shadow-rose-100/50'
            : 'bg-emerald-50/95 border-emerald-200 shadow-emerald-100/50'
        }`}
      >
        <div
          className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
            isError ? 'bg-rose-100' : 'bg-emerald-100'
          }`}
        >
          {isError ? (
            <XCircle size={20} className="text-rose-600" />
          ) : (
            <CheckCircle2 size={20} className="text-emerald-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-bold text-sm ${isError ? 'text-rose-800' : 'text-emerald-800'}`}>
            {isError ? 'Oops!' : 'Done!'}
          </div>
          <div className={`text-xs leading-snug ${isError ? 'text-rose-600' : 'text-emerald-600'}`}>
            {message}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className={`text-xs font-bold px-2 py-1 rounded-lg transition-all ${
            isError ? 'text-rose-400 hover:bg-rose-100' : 'text-emerald-400 hover:bg-emerald-100'
          }`}
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
}

// ── Confirmation bottom sheet ─────────────────────────────────────────────────
function ConfirmSheet({ dateStr, choice, existingChoice, busy, onConfirm, onClose }) {
  const ui = CHOICE_UI[choice];
  const existingUi = existingChoice ? CHOICE_UI[existingChoice] : null;
  const isChange = existingChoice && existingChoice !== choice;
  const dateLabel = new Date(`${dateStr}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">{ui.emoji}</div>
          {isChange ? (
            <>
              <h2 className="font-extrabold text-slate-900 text-lg">Change your booking?</h2>
              <div className="flex items-center justify-center gap-2 mt-3">
                <span
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold ${existingUi.badge}`}
                >
                  {existingUi.emoji} {existingUi.label}
                </span>
                <span className="text-slate-400 font-bold">→</span>
                <span
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold ${ui.badge}`}
                >
                  {ui.emoji} {ui.label}
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-2">{dateLabel}</p>
            </>
          ) : (
            <>
              <h2 className="font-extrabold text-slate-900 text-lg">
                {choice === 'skip' ? 'Skip this day?' : `Book ${ui.label}?`}
              </h2>
              <p className="text-sm text-slate-500 mt-1">{dateLabel}</p>
            </>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-3.5 rounded-2xl border-2 border-slate-200 font-bold text-sm text-slate-500 hover:bg-slate-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 py-3.5 rounded-2xl border-2 font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              choice === 'skip'
                ? 'bg-slate-600 border-slate-600 text-white hover:bg-slate-700'
                : 'bg-brand border-brand text-white hover:bg-brand/90'
            } ${busy ? 'opacity-50' : ''}`}
          >
            {busy ? (
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 size={16} />
                {isChange ? 'Change' : 'Confirm'}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function MealBooking() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isManager = ['facility_manager', 'finance', 'leadership'].includes(profile?.role);

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [bookings, setBookings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [booking, setBooking] = useState(false);
  const [_loading, setLoading] = useState(true);
  const [userPrefs, setUserPrefs] = useState({ shift: 'morning', notification_tone: 'Friendly' });

  // Confirmation sheet state
  const [confirmData, setConfirmData] = useState(null); // { dateStr, choice, existingChoice }

  // Per-date "change mode" — when true, show booking buttons so user can change existing booking
  const [changingDate, setChangingDate] = useState(null);

  // Toast state
  const [toast, setToast] = useState(null); // { message, type }

  const monthStr = getMonthStr(year, month);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('employee_cafeteria_preferences')
      .select('shift, notification_tone')
      .eq('user_id', profile.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setUserPrefs({
            shift: data.shift || 'morning',
            notification_tone: data.notification_tone || 'Friendly',
          });
        }
      })
      .catch((e) => console.error('Failed to load user preferences', e));
  }, [profile?.id]);

  useEffect(() => {
    setLoading(true);
    api
      .myMealBookings(monthStr)
      .then(setBookings)
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  }, [monthStr]);

  useEffect(() => {
    if (!selectedDate || !isManager) {
      setSummary(null);
      return;
    }
    api
      .mealSummary(selectedDate)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [selectedDate, isManager]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }

  function getBookingForDate(dateStr) {
    return bookings.find((b) => b.meal_date === dateStr);
  }

  function openMealTicket(dateStr) {
    navigate(`/my-meal-box?date=${dateStr}`);
  }

  function getNextWorkingDay() {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const _nextWorkingDay = getNextWorkingDay();

  // Step 1: User taps a choice → show confirmation sheet
  function requestBook(dateStr, choice) {
    const existing = getBookingForDate(dateStr);
    setConfirmData({ dateStr, choice, existingChoice: existing?.choice || null });
  }

  // Step 2: User confirms → call API
  async function confirmBook() {
    if (!confirmData) return;
    const { dateStr, choice } = confirmData;
    setBooking(true);
    try {
      const result = await api.bookMeal({ date: dateStr, choice });
      const updated = await api.myMealBookings(monthStr);
      setBookings(updated);
      setConfirmData(null);
      setChangingDate(null); // return to "already booked" banner after successful change
      setToast({
        message:
          result.message || `${CHOICE_UI[choice]?.emoji} ${CHOICE_UI[choice]?.label} booked!`,
        type: 'success',
      });
      if (isManager && selectedDate === dateStr) {
        api
          .mealSummary(dateStr)
          .then(setSummary)
          .catch(() => {});
      }
    } catch (e) {
      setConfirmData(null);
      setToast({ message: e.message || 'Something went wrong', type: 'error' });
    } finally {
      setBooking(false);
    }
  }

  // Calendar grid
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
        )}
      </AnimatePresence>

      {/* Confirmation Sheet */}
      <AnimatePresence>
        {confirmData && (
          <ConfirmSheet
            dateStr={confirmData.dateStr}
            choice={confirmData.choice}
            existingChoice={confirmData.existingChoice}
            busy={booking}
            onConfirm={confirmBook}
            onClose={() => !booking && setConfirmData(null)}
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">🍱 Meal Booking</h1>
          <p className="text-sm text-slate-500">Book your lunch for upcoming days</p>
        </div>
        <button
          onClick={() => navigate('/meal-history')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-all"
        >
          <History size={14} />
          History
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(CHOICE_UI).map(([key, ui]) => (
          <div key={key} className="flex items-center gap-1">
            <span>{ui.emoji}</span>
            <span className="text-slate-500">{ui.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-slate-300" />
          <span className="text-slate-400">Not booked</span>
        </div>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-100 p-3">
        <button
          onClick={prevMonth}
          className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-all"
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className="font-bold text-slate-800">
          {MONTH_NAMES[month]} {year}
        </h2>
        <button
          onClick={nextMonth}
          className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-all"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4">
        <div className="grid grid-cols-5 gap-1 mb-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
            <div key={d} className="text-center text-xs font-bold text-slate-400 py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-1">
          {Array.from({ length: Math.min(startOffset, 4) }).map((_, i) => (
            <div key={`empty-${i}`} className="h-16" />
          ))}

          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateObj = new Date(year, month, day);
            const dow = dateObj.getDay();
            if (dow === 0 || dow === 6) return null;

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const b = getBookingForDate(dateStr);
            const isPast = dateObj < today || dateObj.getTime() === today.getTime();
            const isToday = dateObj.getTime() === today.getTime();
            const isSelected = selectedDate === dateStr;
            const bStatus = getBookingStatus(dateStr, userPrefs.shift, now);
            const isBookable = bStatus.canBook || bStatus.canSkip;
            const ui = b ? CHOICE_UI[b.choice] : null;

            return (
              <motion.button
                key={dateStr}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-all text-xs
                  ${isSelected ? 'border-brand bg-brand/5' : 'border-transparent'}
                  ${isPast ? 'opacity-40' : ''}
                  ${!isPast && !isBookable ? 'opacity-60' : ''}
                  ${isBookable ? 'bg-brand/5 hover:bg-brand/10 ring-2 ring-brand/20' : 'hover:bg-slate-50'}
                  ${isToday ? 'ring-2 ring-slate-300' : ''}
                `}
              >
                <span
                  className={`font-bold ${isBookable ? 'text-brand' : isToday ? 'text-slate-500' : 'text-slate-700'}`}
                >
                  {day}
                </span>
                {b ? (
                  <span className="text-base">{ui?.emoji}</span>
                ) : isBookable ? (
                  <span className="text-[9px] text-brand font-bold">Book</span>
                ) : (
                  <span className="w-2 h-2 rounded-full bg-slate-200" />
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Selected Date Detail */}
      {selectedDate && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800">
              {new Date(`${selectedDate}T00:00:00+05:30`).toLocaleDateString('en-IN', {
                weekday: 'long',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: 'Asia/Kolkata',
              })}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              ✕ Close
            </button>
          </div>

          {(() => {
            const b = getBookingForDate(selectedDate);
            const dateObj = new Date(`${selectedDate}T00:00:00+05:30`);
            const dow = dateObj.getDay();
            const dayOpts = DAY_OPTIONS[dow] || [];
            const isPast = dateObj < today || dateObj.getTime() === today.getTime();
            const bStatus = getBookingStatus(selectedDate, userPrefs.shift, now);
            const canBook = bStatus.canBook;
            const canSkip = bStatus.canSkip;
            const isBookable = canBook || canSkip;

            // Past or today — view only
            if (isPast) {
              return (
                <div
                  className={`p-4 rounded-xl flex items-center justify-between gap-3 ${b ? `${CHOICE_UI[b.choice]?.bg} border ${CHOICE_UI[b.choice]?.border}` : 'bg-slate-50 border border-slate-200'}`}
                >
                  {b ? (
                    <>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl">{CHOICE_UI[b.choice]?.emoji}</span>
                        <div>
                          <span className="font-bold text-sm">{CHOICE_UI[b.choice]?.label}</span>
                          {b.booked_at && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              Booked at{' '}
                              {new Date(b.booked_at).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Asia/Kolkata',
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      {b.choice !== 'skip' && (
                        <button
                          type="button"
                          onClick={() => openMealTicket(selectedDate)}
                          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/80 border border-slate-200 text-xs font-bold text-brand hover:bg-white"
                        >
                          <Ticket size={13} />
                          View Ticket
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-2xl">⚫</span>
                      <span className="text-sm font-semibold text-slate-500">Not booked</span>
                    </>
                  )}
                </div>
              );
            }

            // Future but NOT next working day — locked
            if (!isBookable) {
              const openTimeLabel = getOpeningTimeLabel(selectedDate, userPrefs.shift);
              const toneMsg = getToneMessage(
                userPrefs.notification_tone,
                userPrefs.shift,
                openTimeLabel
              );
              return (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-1">
                  <span className="text-lg">🔒</span>
                  <div className="text-sm font-semibold text-slate-500">Not available yet</div>
                  <div className="text-xs text-slate-500 font-medium leading-relaxed px-2 py-1">
                    {toneMsg}
                  </div>
                  {b && (
                    <div className={`mt-2 p-2 rounded-lg ${CHOICE_UI[b.choice]?.bg}`}>
                      <span className="text-sm font-semibold">
                        {CHOICE_UI[b.choice]?.emoji} {CHOICE_UI[b.choice]?.label}
                      </span>
                    </div>
                  )}
                </div>
              );
            }

            // Next working day — Option A:
            // If already booked → show clear "Already booked" banner, hide buttons.
            // User must explicitly tap "Change" to reveal the choice buttons.
            // If not booked → show buttons directly.
            const isChanging = changingDate === selectedDate;

            if (b && !isChanging) {
              // ── Already booked — show confirmation state ──
              const ui = CHOICE_UI[b.choice];
              return (
                <div className="space-y-3">
                  <div
                    className={`p-4 rounded-xl border-2 ${ui.bg} ${ui.border} flex items-center justify-between gap-3`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{ui.emoji}</span>
                      <div>
                        <div className={`font-bold text-sm ${ui.text}`}>
                          ✅ {b.choice === 'skip' ? 'Skipped' : `${ui.label} booked`}
                        </div>
                        {b.booked_at && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Booked at{' '}
                            {new Date(b.booked_at).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Asia/Kolkata',
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {b.choice !== 'skip' && (
                        <button
                          type="button"
                          onClick={() => openMealTicket(selectedDate)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/70 border border-slate-200 text-xs font-bold text-brand hover:bg-white"
                        >
                          <Ticket size={13} />
                          Ticket
                        </button>
                      )}
                      {canBook && (
                        <button
                          type="button"
                          onClick={() => setChangingDate(selectedDate)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/70 border border-slate-200 text-xs font-bold text-slate-500 hover:bg-white"
                        >
                          ✏️ Change
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // ── Not booked yet, OR user tapped "Change" — show booking buttons ──
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-brand font-bold uppercase tracking-wider">
                    {isChanging ? 'Change your booking' : 'Book for next working day'}
                  </div>
                  {isChanging && (
                    <button
                      type="button"
                      onClick={() => setChangingDate(null)}
                      className="ml-auto text-xs text-slate-400 hover:text-slate-600"
                    >
                      ✕ Cancel
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {dayOpts.map((opt) => {
                    const ui = CHOICE_UI[opt];
                    const selected = b?.choice === opt;
                    return (
                      <button
                        key={opt}
                        disabled={booking || !canBook}
                        onClick={() => requestBook(selectedDate, opt)}
                        className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border-2 font-bold text-sm transition-all
                          ${selected ? `${ui.bg} border-current ${ui.text}` : `bg-white ${ui.border} hover:${ui.bg}`}
                          ${booking || !canBook ? 'opacity-40' : ''}
                        `}
                      >
                        <span className="text-xl">{ui.emoji}</span>
                        <span>{ui.label}</span>
                        {selected && <span className="text-xs">✅</span>}
                      </button>
                    );
                  })}
                  <button
                    disabled={booking || !canSkip}
                    onClick={() => requestBook(selectedDate, 'skip')}
                    className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border-2 font-bold text-sm transition-all
                      ${b?.choice === 'skip' ? 'bg-slate-100 border-slate-400 text-slate-600' : 'bg-white border-slate-200 hover:border-slate-300 text-slate-500'}
                      ${booking || !canSkip ? 'opacity-40' : ''}
                    `}
                  >
                    <span className="text-xl">🚫</span>
                    <span>Skip</span>
                    {b?.choice === 'skip' && <span className="text-xs">✅</span>}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Summary for managers */}
          {isManager && summary && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                Team Summary
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-700">{summary.veg_count}</div>
                  <div className="text-xs text-emerald-600">🥬 Veg</div>
                </div>
                {summary.non_veg_count > 0 && (
                  <div className="bg-red-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-red-700">{summary.non_veg_count}</div>
                    <div className="text-xs text-red-600">🍗 Non-Veg</div>
                  </div>
                )}
                {summary.egg_count > 0 && (
                  <div className="bg-amber-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-amber-700">{summary.egg_count}</div>
                    <div className="text-xs text-amber-600">🥚 Egg</div>
                  </div>
                )}
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-slate-700">{summary.skip_count}</div>
                  <div className="text-xs text-slate-500">🚫 Skipped</div>
                </div>
              </div>
              <div className="flex items-center justify-between bg-brand/5 rounded-xl p-3">
                <span className="font-bold text-sm text-slate-700">
                  Total Meals: {summary.total_meals}
                </span>
                <span className="font-bold text-sm text-brand">{summary.cost?.total || 0} INR</span>
              </div>
              {summary.not_booked > 0 && (
                <div className="text-xs text-amber-600 font-semibold">
                  {summary.not_booked} people haven't booked yet
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
