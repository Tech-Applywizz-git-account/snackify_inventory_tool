import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const CHOICE_UI = {
  veg: {
    emoji: '🥬',
    label: 'Veg',
    color: 'bg-emerald-500',
    bg: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-700',
  },
  non_veg: {
    emoji: '🍗',
    label: 'Non-Veg',
    color: 'bg-red-500',
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-700',
  },
  egg: {
    emoji: '🥚',
    label: 'Egg',
    color: 'bg-amber-500',
    bg: 'bg-amber-50 border-amber-200',
    text: 'text-amber-700',
  },
  skip: {
    emoji: '🚫',
    label: 'Skip',
    color: 'bg-slate-400',
    bg: 'bg-slate-50 border-slate-200',
    text: 'text-slate-600',
  },
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

function getNextWorkingDay() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = new Date(now);
  d.setDate(d.getDate() + 1); // start from tomorrow

  // Skip weekends
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function CountdownTimer({ cutoffHour }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    function update() {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const target = new Date(now);
      target.setHours(cutoffHour, 0, 0, 0);

      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft('');
        return;
      }

      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(h > 0 ? `${h}h ${m}m left` : `${m}m left`);
    }

    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [cutoffHour]);

  if (!timeLeft) return null;
  return <span className="text-xs text-slate-400">⏰ {timeLeft}</span>;
}

export default function MealCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [targetDate] = useState(getNextWorkingDay);

  const load = useCallback(async () => {
    try {
      const result = await api.mealOptions(targetDate);
      setData(result);
    } catch (e) {
      console.error('MealCard load error:', e);
    } finally {
      setLoading(false);
    }
  }, [targetDate]);

  useEffect(() => {
    load();
  }, [load]);

  async function book(choice) {
    setBusy(true);
    setMsg('');
    try {
      const result = await api.bookMeal({ date: targetDate, choice });
      setMsg(result.message || 'Booked!');
      await load(); // refresh state
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setMsg(e.message || 'Failed to book');
      setTimeout(() => setMsg(''), 4000);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;
  if (!data?.working_day) return null;

  const { options, canBook, canSkip, reason, booking } = data;
  const currentChoice = booking?.choice;
  const isLocked = !canBook && !canSkip;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border-2 border-slate-100 p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍱</span>
          <div>
            <div className="font-bold text-slate-800 text-sm">Tomorrow's Lunch</div>
            <div className="text-xs text-slate-400">{formatDate(targetDate)}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          {reason === 'open' && (
            <>
              <CountdownTimer cutoffHour={18} />
              <span className="text-[10px] text-slate-300 font-medium">Book by 6 PM</span>
            </>
          )}
          {reason === 'skip_only' && (
            <span className="text-xs bg-amber-50 text-amber-600 font-bold px-2 py-1 rounded-full">
              Skip only till 8 PM
            </span>
          )}
          {isLocked && (
            <span className="text-xs bg-slate-100 text-slate-500 font-bold px-2 py-1 rounded-full">
              🔒 Locked
            </span>
          )}
        </div>
      </div>

      {/* Current booking display */}
      {currentChoice && currentChoice !== 'skip' && (reason === 'skip_only' || isLocked) && (
        <div
          className={`flex items-center justify-between p-3 rounded-xl border ${CHOICE_UI[currentChoice]?.bg || 'bg-slate-50 border-slate-200'}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">{CHOICE_UI[currentChoice]?.emoji}</span>
            <span className={`font-bold text-sm ${CHOICE_UI[currentChoice]?.text}`}>
              You booked: {CHOICE_UI[currentChoice]?.label}
            </span>
            <span className="text-emerald-500">✅</span>
          </div>
          {canSkip && (
            <button
              disabled={busy}
              onClick={() => book('skip')}
              className="text-xs font-bold text-rose-500 bg-rose-50 px-3 py-1.5 rounded-lg hover:bg-rose-100 transition-all disabled:opacity-40"
            >
              🚫 Cancel
            </button>
          )}
        </div>
      )}

      {/* Skipped display */}
      {currentChoice === 'skip' && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
          <span className="text-lg">🚫</span>
          <span className="font-bold text-sm text-slate-500">Skipped for this day</span>
          {canBook && <span className="text-xs text-slate-400 ml-auto">Tap below to rebook</span>}
        </div>
      )}

      {/* Locked and not booked */}
      {isLocked && !currentChoice && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <span className="text-lg">⚠️</span>
          <span className="font-bold text-sm text-amber-700">You missed the booking deadline</span>
        </div>
      )}

      {/* Booking options */}
      {(canBook || (canSkip && !currentChoice)) && (
        <div className="flex gap-2">
          {options.map((opt) => {
            const ui = CHOICE_UI[opt];
            const selected = currentChoice === opt;
            return (
              <motion.button
                key={opt}
                whileTap={{ scale: 0.95 }}
                disabled={busy || !canBook}
                onClick={() => book(opt)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border-2 font-bold text-sm transition-all
                  ${
                    selected
                      ? `${ui.color} text-white border-transparent shadow-lg`
                      : `bg-white ${ui.text} border-slate-200 hover:border-current`
                  }
                  ${busy || !canBook ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                <span className="text-xl">{ui.emoji}</span>
                <span>{ui.label}</span>
                {selected && <span className="text-xs opacity-80">✅</span>}
              </motion.button>
            );
          })}

          {/* Skip button */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            disabled={busy}
            onClick={() => book('skip')}
            className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border-2 font-bold text-sm transition-all
              ${
                currentChoice === 'skip'
                  ? 'bg-slate-400 text-white border-transparent'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }
              ${busy ? 'opacity-40' : ''}
            `}
          >
            <span className="text-xl">🚫</span>
            <span>Skip</span>
            {currentChoice === 'skip' && <span className="text-xs opacity-80">✅</span>}
          </motion.button>
        </div>
      )}

      {/* Flash message */}
      <AnimatePresence>
        {msg && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`text-xs font-bold text-center py-2 rounded-lg ${
              msg.includes('🚫') ||
              msg.includes('Failed') ||
              msg.includes('locked') ||
              msg.includes('After')
                ? 'bg-rose-50 text-rose-600'
                : 'bg-emerald-50 text-emerald-600'
            }`}
          >
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
