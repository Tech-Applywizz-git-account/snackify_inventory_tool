import { AnimatePresence, motion } from 'framer-motion';
import { Star, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

/**
 * Global meal-review controller + modal.
 * Follows API fields only: show_popup, window_ends_at, reopen_after_seconds.
 * Dismiss hides UI; timer reopens until submitted or window ends.
 */
export default function MealReviewGate() {
  const { session, aal } = useAuth();
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const reopenTimerRef = useRef(null);
  const submittedRef = useRef(false);

  const clearReopenTimer = useCallback(() => {
    if (reopenTimerRef.current) {
      clearTimeout(reopenTimerRef.current);
      reopenTimerRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!session || aal !== 'aal2' || submittedRef.current) return null;
    try {
      const data = await api.mealReviewStatus();
      setStatus(data);
      if (data?.already_reviewed) {
        submittedRef.current = true;
        setOpen(false);
        clearReopenTimer();
        return data;
      }
      if (data?.show_popup) {
        setOpen(true);
      } else {
        setOpen(false);
        clearReopenTimer();
        console.info('[meal-review] popup not shown', {
          in_window: data?.in_window,
          already_reviewed: data?.already_reviewed,
          skip_reason: data?.skip_reason,
          ist_now: data?.ist_now,
        });
      }
      return data;
    } catch (err) {
      // Do not block the app, but log so missing migration / 404 is visible
      console.warn('[meal-review] status failed — check API deploy + migration 0048', err?.message || err);
      return null;
    }
  }, [session, aal, clearReopenTimer]);

  useEffect(() => {
    if (!session || aal !== 'aal2') return;
    submittedRef.current = false;
    refreshStatus();
  }, [session, aal, refreshStatus]);

  useEffect(() => () => clearReopenTimer(), [clearReopenTimer]);

  function scheduleReopen(secs) {
    clearReopenTimer();
    const delayMs = Math.max(5, Number(secs) || 120) * 1000;
    reopenTimerRef.current = setTimeout(async () => {
      if (submittedRef.current) return;
      const data = await refreshStatus();
      if (data?.show_popup) setOpen(true);
    }, delayMs);
  }

  function handleClose() {
    setOpen(false);
    if (submittedRef.current) return;
    const secs = status?.reopen_after_seconds ?? 120;
    // Only schedule if still inside window per last status
    if (status?.show_popup || status?.in_window) {
      scheduleReopen(secs);
    }
  }

  function handleSubmitted() {
    submittedRef.current = true;
    setOpen(false);
    clearReopenTimer();
    setStatus((s) =>
      s
        ? {
            ...s,
            already_reviewed: true,
            show_popup: false,
          }
        : s
    );
  }

  return (
    <MealReviewPopup
      open={open}
      status={status}
      onClose={handleClose}
      onSubmitted={handleSubmitted}
    />
  );
}

function MealReviewPopup({ open, status, onClose, onSubmitted }) {
  const mealTypes = status?.meal_types || [
    { value: 'veg', label: 'Veg' },
    { value: 'non_veg', label: 'Non-veg' },
  ];
  const vibes = status?.vibes || [];
  const maxStars = status?.rating_scale?.max || 5;

  const [mealType, setMealType] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverStar, setHoverStar] = useState(0);
  const [vibe, setVibe] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setMealType('');
      setRating(0);
      setHoverStar(0);
      setVibe(vibes[0]?.key || '');
      setComment('');
      setError('');
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opened
  }, [open]);

  async function submit() {
    setError('');
    if (!mealType) {
      setError('Pick veg or non-veg.');
      return;
    }
    if (!rating || rating < 1 || rating > maxStars) {
      setError('Tap a star rating (1–5).');
      return;
    }
    if (!vibe) {
      setError('Pick a vibe.');
      return;
    }

    setBusy(true);
    try {
      await api.submitMealReview({
        meal_type: mealType,
        rating,
        vibe,
        comment: comment || null,
      });
      onSubmitted();
    } catch (e) {
      const msg = e?.message || 'Could not save review';
      if (msg.toLowerCase().includes('already reviewed')) {
        onSubmitted();
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
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close review"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="meal-review-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="meal-review-title" className="text-lg font-extrabold text-slate-900">
                  How was today&apos;s meal?
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Quick vibe check — takes 10 seconds.
                  {status?.meal_date ? ` · ${status.meal_date}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            {/* Meal type */}
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Meal type
              </div>
              <div className="grid grid-cols-2 gap-2">
                {mealTypes.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setMealType(t.value)}
                    className={`py-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                      mealType === t.value
                        ? 'bg-brand text-white border-brand'
                        : 'bg-white text-slate-600 border-slate-100 hover:border-brand/30'
                    }`}
                  >
                    {t.value === 'veg' ? '🥬 ' : '🍗 '}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Stars */}
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Rating
              </div>
              <div className="flex items-center justify-center gap-1.5">
                {Array.from({ length: maxStars }, (_, i) => i + 1).map((n) => {
                  const active = (hoverStar || rating) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onMouseEnter={() => setHoverStar(n)}
                      onMouseLeave={() => setHoverStar(0)}
                      onClick={() => setRating(n)}
                      className="p-1"
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    >
                      <Star
                        size={28}
                        className={
                          active ? 'fill-amber-400 text-amber-400' : 'text-slate-200 fill-slate-200'
                        }
                      />
                    </button>
                  );
                })}
              </div>
              {rating > 0 && (
                <div className="text-center text-sm font-bold text-brand mt-1">{rating}/5</div>
              )}
            </div>

            {/* Vibe */}
            <div>
              <label
                htmlFor="meal-vibe"
                className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block"
              >
                Vibe
              </label>
              <select
                id="meal-vibe"
                value={vibe}
                onChange={(e) => setVibe(e.target.value)}
                className="w-full border-2 border-slate-100 rounded-xl px-3 py-2.5 text-sm font-medium focus:border-brand focus:outline-none bg-white"
              >
                {vibes.length === 0 && <option value="">Loading vibes…</option>}
                {vibes.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Free text */}
            <div>
              <label
                htmlFor="meal-comment"
                className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block"
              >
                Anything else? (optional)
              </label>
              <textarea
                id="meal-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Spill the tea… no character limit"
                className="w-full border-2 border-slate-100 rounded-xl px-3 py-2.5 text-sm focus:border-brand focus:outline-none resize-y min-h-[80px]"
              />
            </div>

            {error && <div className="text-xs text-rose-600 font-medium">{error}</div>}

            <div className="flex gap-2 pt-1">
              <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={busy}>
                Later
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={submit}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Submit review'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
