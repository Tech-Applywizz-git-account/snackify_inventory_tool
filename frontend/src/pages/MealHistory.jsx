import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, ChevronDown, ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// ── Inline meal rating component ─────────────────────────────────────────────
function MealRatingInline({ mealDate, onRated }) {
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!rating) return;
    setBusy(true);
    try {
      await api.rateMeal(mealDate, { rating, feedback });
      onRated();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="overflow-hidden"
    >
      <div className="pt-3 mt-3 border-t border-slate-100 space-y-3">
        <div className="text-xs font-bold text-slate-500">Rate this meal (1-10)</div>
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              className={`h-9 rounded-lg font-bold text-xs transition-all active:scale-90 ${
                n === rating
                  ? 'bg-brand text-white scale-105 shadow-sm shadow-brand/30'
                  : n <= rating
                    ? 'bg-brand/15 text-brand border border-brand/20'
                    : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {rating > 0 && <div className="text-center text-xs font-bold text-brand">{rating}/10</div>}
        <textarea
          className="w-full text-sm rounded-xl border border-slate-200 p-3 bg-slate-50 placeholder-slate-400 focus:border-brand focus:ring-1 focus:ring-brand/20 outline-none resize-none"
          rows={2}
          placeholder="How was the food? (optional)"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <button
          onClick={submit}
          disabled={!rating || busy}
          className="w-full py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 bg-brand text-white hover:bg-brand/90 active:scale-[0.98]"
        >
          {busy ? 'Submitting...' : 'Submit Rating'}
        </button>
      </div>
    </motion.div>
  );
}

const CHOICE_UI = {
  veg: {
    emoji: '🥬',
    label: 'Veg',
    badge: 'bg-emerald-100 text-emerald-700',
    dot: 'bg-emerald-400',
  },
  non_veg: { emoji: '🍗', label: 'Non-Veg', badge: 'bg-red-100 text-red-700', dot: 'bg-red-400' },
  egg: { emoji: '🥚', label: 'Egg', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  skip: { emoji: '🚫', label: 'Skip', badge: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
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

// Build month options from start date to now
function buildMonthOptions() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Go back 12 months from current month (or from May 2026 start)
  const months = [];
  for (let i = 0; i < 24; i++) {
    let m = currentMonth - i;
    let y = currentYear;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    // Don't go earlier than May 2026 (when system started)
    if (y < 2026 || (y === 2026 && m < 4)) break;
    months.push({ year: y, month: m, label: `${MONTH_NAMES[m]} ${y}`, value: getMonthStr(y, m) });
  }
  return months;
}

// Check if a meal_date is ratable (today or yesterday in IST)
function isRatable(mealDateStr) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const mealDate = new Date(`${mealDateStr}T00:00:00+05:30`);
  const mealClean = new Date(mealDate.getFullYear(), mealDate.getMonth(), mealDate.getDate());
  return mealClean >= yesterday && mealClean <= today;
}

export default function MealHistory() {
  const navigate = useNavigate();
  const monthOptions = buildMonthOptions();

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const [selectedMonth, setSelectedMonth] = useState(
    getMonthStr(now.getFullYear(), now.getMonth())
  );
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(null); // meal_date of currently open rating

  useEffect(() => {
    setLoading(true);
    api
      .myMealBookings(selectedMonth)
      .then((data) =>
        setBookings((data || []).sort((a, b) => b.meal_date.localeCompare(a.meal_date)))
      )
      .catch(() => setBookings([]))
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  // Summary counts
  const counts = bookings.reduce(
    (acc, b) => {
      acc[b.choice] = (acc[b.choice] || 0) + 1;
      acc.total += 1;
      return acc;
    },
    { veg: 0, non_veg: 0, egg: 0, skip: 0, total: 0 }
  );

  const currentLabel = monthOptions.find((m) => m.value === selectedMonth)?.label || selectedMonth;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/meals')}
          className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-all"
        >
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">📋 Meal History</h1>
          <p className="text-sm text-slate-500">Your past meal bookings</p>
        </div>
      </div>

      {/* Month picker */}
      <div className="relative">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="w-full flex items-center justify-between bg-white rounded-2xl border border-slate-100 p-4 hover:border-slate-200 transition-all"
        >
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-brand" />
            <span className="font-bold text-slate-800">{currentLabel}</span>
          </div>
          <ChevronDown
            size={16}
            className={`text-slate-400 transition-transform ${showPicker ? 'rotate-180' : ''}`}
          />
        </button>

        {showPicker && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 max-h-64 overflow-y-auto"
          >
            {monthOptions.map((mo) => (
              <button
                key={mo.value}
                onClick={() => {
                  setSelectedMonth(mo.value);
                  setShowPicker(false);
                }}
                className={`w-full text-left px-4 py-3 text-sm font-medium transition-all hover:bg-slate-50 first:rounded-t-2xl last:rounded-b-2xl ${
                  selectedMonth === mo.value ? 'bg-brand/5 text-brand font-bold' : 'text-slate-700'
                }`}
              >
                {mo.label}
                {selectedMonth === mo.value && <span className="float-right">✓</span>}
              </button>
            ))}
          </motion.div>
        )}
      </div>

      {/* Summary bar */}
      {!loading && bookings.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-slate-100 p-4"
        >
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
            Monthly Summary
          </div>
          <div className="grid grid-cols-4 gap-2">
            {['veg', 'non_veg', 'egg', 'skip'].map((key) => {
              const ui = CHOICE_UI[key];
              return (
                <div key={key} className={`rounded-xl p-3 text-center ${ui.badge} bg-opacity-50`}>
                  <div className="text-lg font-extrabold">{counts[key]}</div>
                  <div className="text-[10px] font-bold mt-0.5">
                    {ui.emoji} {ui.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-center">
            <span className="text-xs font-bold text-slate-500">
              {counts.total} total booking{counts.total !== 1 ? 's' : ''} &middot;{' '}
              {counts.total - counts.skip} meal{counts.total - counts.skip !== 1 ? 's' : ''}
            </span>
          </div>
        </motion.div>
      )}

      {/* Booking list */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="h-8 w-8 border-3 border-brand/20 border-t-brand rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Loading history...</p>
          </div>
        ) : bookings.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <div className="text-4xl mb-3">📭</div>
            <div className="font-bold text-slate-500">No bookings this month</div>
            <div className="text-xs text-slate-400 mt-1">
              Select a different month or start booking meals
            </div>
          </div>
        ) : (
          bookings.map((b, i) => {
            const ui = CHOICE_UI[b.choice] || CHOICE_UI.skip;
            const dateObj = new Date(`${b.meal_date}T00:00:00+05:30`);
            const dateLabel = dateObj.toLocaleDateString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: 'Asia/Kolkata',
            });
            const bookedAt = b.booked_at
              ? new Date(b.booked_at).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                })
              : null;

            return (
              <motion.div
                key={b.id || b.meal_date}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-white rounded-2xl border border-slate-100 p-4 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-4">
                  {/* Date column */}
                  <div className="text-center min-w-[52px]">
                    <div className="text-lg font-extrabold text-slate-800">{dateObj.getDate()}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">
                      {dateObj.toLocaleDateString('en-IN', {
                        weekday: 'short',
                        timeZone: 'Asia/Kolkata',
                      })}
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="w-px h-10 bg-slate-100" />

                  {/* Choice */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{ui.emoji}</span>
                      <span className="font-bold text-sm text-slate-800">{ui.label}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ui.badge}`}
                      >
                        {b.choice === 'skip' ? 'Skipped' : 'Booked'}
                      </span>
                    </div>
                    {bookedAt && (
                      <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <span>Booked at {bookedAt}</span>
                      </div>
                    )}
                  </div>

                  {/* Right side: rating badge or rate button */}
                  <div className="text-right shrink-0">
                    {b.rating ? (
                      <div className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                        <span className="text-xs">⭐</span>
                        <span className="text-xs font-extrabold text-amber-700">{b.rating}/10</span>
                      </div>
                    ) : b.choice !== 'skip' && isRatable(b.meal_date) ? (
                      <button
                        onClick={() =>
                          setRatingOpen(ratingOpen === b.meal_date ? null : b.meal_date)
                        }
                        className="text-[11px] font-bold text-brand bg-brand/10 hover:bg-brand/20 px-3 py-1.5 rounded-full transition-all active:scale-95"
                      >
                        Rate
                      </button>
                    ) : (
                      <div className="text-[10px] text-slate-400">{dateLabel}</div>
                    )}
                  </div>
                </div>

                {/* Feedback display for rated meals */}
                {b.rating && b.feedback && (
                  <div className="mt-2 ml-[68px] text-[11px] text-slate-500 italic">
                    &ldquo;{b.feedback}&rdquo;
                  </div>
                )}

                {/* Inline rating form */}
                <AnimatePresence>
                  {ratingOpen === b.meal_date && !b.rating && (
                    <MealRatingInline
                      mealDate={b.meal_date}
                      onRated={() => {
                        setRatingOpen(null);
                        // Refresh bookings
                        api
                          .myMealBookings(selectedMonth)
                          .then((data) =>
                            setBookings(
                              (data || []).sort((a, bb) => bb.meal_date.localeCompare(a.meal_date))
                            )
                          )
                          .catch(() => {});
                      }}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
