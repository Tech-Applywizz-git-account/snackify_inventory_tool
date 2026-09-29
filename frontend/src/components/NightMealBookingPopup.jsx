import { AnimatePresence, motion } from 'framer-motion';
import { Moon, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

/**
 * Night-shift meal booking controller + modal.
 * Driven entirely by GET /api/meals/booking-prompt + POST /api/meals/book
 * so mobile apps can reuse the same routes.
 *
 * show_popup → open; dismiss/reopen every reopen_after_seconds (default 20)
 * until already_responded (book or skip).
 */
export default function NightMealBookingGate() {
  const { session, aal, profile } = useAuth();
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const reopenTimerRef = useRef(null);
  const respondedRef = useRef(false);

  const authed =
    Boolean(session) && (aal === 'aal2' || profile?.role === 'leadership');

  const clearReopenTimer = useCallback(() => {
    if (reopenTimerRef.current) {
      clearTimeout(reopenTimerRef.current);
      reopenTimerRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!authed || respondedRef.current) return null;
    try {
      const data = await api.mealBookingPrompt();
      setStatus(data);
      if (data?.already_responded) {
        respondedRef.current = true;
        setOpen(false);
        clearReopenTimer();
        return data;
      }
      if (data?.show_popup) {
        setOpen(true);
      } else {
        setOpen(false);
        clearReopenTimer();
      }
      return data;
    } catch (err) {
      console.warn('[night-meal-prompt] status failed', err?.message || err);
      return null;
    }
  }, [authed, clearReopenTimer]);

  useEffect(() => {
    if (!authed) return undefined;
    respondedRef.current = false;
    refreshStatus();

    // Re-check when tab becomes visible again (user opens app / returns).
    function onVisible() {
      if (document.visibilityState === 'visible' && !respondedRef.current) {
        refreshStatus();
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [authed, refreshStatus]);

  useEffect(() => () => clearReopenTimer(), [clearReopenTimer]);

  function scheduleReopen(secs) {
    clearReopenTimer();
    const delayMs = Math.max(5, Number(secs) || 20) * 1000;
    reopenTimerRef.current = setTimeout(async () => {
      if (respondedRef.current) return;
      const data = await refreshStatus();
      if (data?.show_popup) setOpen(true);
    }, delayMs);
  }

  function handleClose() {
    setOpen(false);
    if (respondedRef.current) return;
    const secs = status?.reopen_after_seconds ?? 20;
    if (status?.show_popup || status?.in_window) {
      scheduleReopen(secs);
    }
  }

  function handleSubmitted(booking) {
    respondedRef.current = true;
    setOpen(false);
    clearReopenTimer();
    setStatus((s) =>
      s
        ? {
            ...s,
            already_responded: true,
            already_booked: booking?.choice && booking.choice !== 'skip',
            already_skipped: booking?.choice === 'skip',
            show_popup: false,
            booking: booking || s.booking,
          }
        : s
    );
  }

  if (!authed) return null;

  return (
    <NightMealBookingPopup
      open={open}
      status={status}
      onClose={handleClose}
      onSubmitted={handleSubmitted}
    />
  );
}

const CHOICE_STYLES = {
  veg: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  non_veg: 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100',
  egg: 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100',
  skip: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
};

export function NightMealBookingPopup({ open, status, onClose, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [onionSlices, setOnionSlices] = useState(false);

  useEffect(() => {
    if (open) {
      setError('');
      setBusy(false);
      setOnionSlices(false);
    }
  }, [open]);

  const mealChoices = (status?.choices || []).filter((c) => c.kind === 'meal');
  const skipChoice = (status?.choices || []).find((c) => c.kind === 'skip');

  async function submit(choice) {
    if (!status?.meal_date || busy) return;
    setError('');
    setBusy(true);
    try {
      const result = await api.bookMeal({
        date: status.meal_date,
        choice,
        ...(choice !== 'skip' && onionSlices ? { onion_slices: '1 slice' } : {}),
      });
      onSubmitted(result?.booking || { choice, meal_date: status.meal_date });
    } catch (e) {
      const msg = e?.message || 'Could not save meal choice';
      if (/already booked|already skipped|already responded/i.test(msg)) {
        onSubmitted({ choice });
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Dismiss meal booking"
            className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="night-meal-prompt-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-indigo-50 p-2 text-indigo-700">
                  <Moon className="h-5 w-5" />
                </div>
                <div>
                  <h2 id="night-meal-prompt-title" className="text-lg font-extrabold text-slate-900">
                    Book tomorrow&apos;s night meal
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {status?.date_label || status?.meal_date || 'Next working day'} · open until 10:00 PM IST
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-slate-600">
              Night shift booking window is 6–10 PM. This reminder comes back every{' '}
              {status?.reopen_after_seconds ?? 20}s until you book or skip.
            </p>

            {status?.token_price != null && (
              <p className="text-xs text-slate-500">
                Meal token: {status.token_price}
                {status?.wallet?.balance != null ? ` · Wallet: ${status.wallet.balance}` : ''}
              </p>
            )}

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2">
              {mealChoices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  disabled={busy || status?.can_book === false}
                  onClick={() => submit(choice.value)}
                  className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition disabled:opacity-50 ${
                    CHOICE_STYLES[choice.value] || CHOICE_STYLES.skip
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>

            {mealChoices.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={onionSlices}
                  onChange={(e) => setOnionSlices(e.target.checked)}
                  disabled={busy}
                  className="rounded border-slate-300"
                />
                Add onion slices
              </label>
            )}

            {skipChoice && status?.can_skip !== false && (
              <button
                type="button"
                disabled={busy}
                onClick={() => submit('skip')}
                className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:opacity-50 ${CHOICE_STYLES.skip}`}
              >
                {skipChoice.label}
              </button>
            )}

            {busy && <p className="text-center text-xs text-slate-500">Saving…</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
