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

  useEffect(() => {
    async function handleOpenReview() {
      if (status?.already_reviewed) {
        setOpen(true);
        return;
      }
      if (status?.in_window) {
        setOpen(true);
        return;
      }

      try {
        const data = await api.mealReviewStatus();
        setStatus(data);
        setOpen(true);
      } catch (err) {
        console.warn('[meal-review] unable to open review', err?.message || err);
      }
    }

    window.addEventListener('open-meal-review', handleOpenReview);
    return () => window.removeEventListener('open-meal-review', handleOpenReview);
  }, [status]);

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

  function handleSubmitted(review) {
    submittedRef.current = true;
    setOpen(false);
    clearReopenTimer();
    setStatus((s) =>
      s
        ? {
            ...s,
            already_reviewed: true,
            show_popup: false,
            my_review: review || s.my_review,
          }
        : s
    );
  }

  const canReview = status?.in_window && !status?.already_reviewed;

  return (
    <>
      {canReview && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 top-20 z-[70] rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white shadow-lg transition-colors hover:bg-brand/90"
        >
          Review
        </button>
      )}
      <MealReviewPopup
        open={open}
        status={status}
        onClose={handleClose}
        onSubmitted={handleSubmitted}
      />
    </>
  );
}

export function MealReviewPopup({ open, status, onClose, onSubmitted }) {
  const mealTypes = status?.meal_types || [
    { value: 'veg', label: 'Veg' },
    { value: 'non_veg', label: 'Non-veg' },
  ];
  const vibes = status?.vibes || [];
  const maxStars = status?.rating_scale?.max || 5;
  const alreadyReviewed = Boolean(status?.already_reviewed);

  const [mealType, setMealType] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverStar, setHoverStar] = useState(0);
  const [vibe, setVibe] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setMealType(status?.my_review?.meal_type || '');
      setRating(status?.my_review?.rating || 0);
      setHoverStar(0);
      setVibe(status?.my_review?.vibe || vibes[0]?.key || '');
      setComment(status?.my_review?.comment || '');
      setError('');
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opened
  }, [open, status, vibes]);

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
      const result = await api.submitMealReview({
        meal_type: mealType,
        rating,
        vibe,
        comment: comment || null,
      });
      onSubmitted(result?.review);
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
                  {alreadyReviewed ? 'Review successfully submitted' : 'How was today\'s meal?'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {alreadyReviewed ? 'Your review for today is saved.' : 'Quick vibe check — takes 10 seconds.'}
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

            {alreadyReviewed ? (
              <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
                <div className="text-sm font-bold text-emerald-700">Thank you for your feedback.</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Meal type</div>
                    <div className="font-semibold text-slate-800">
                      {mealType === 'veg' ? '🥬 Veg' : '🍗 Non-veg'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Rating</div>
                    <div className="font-semibold text-amber-700">{rating}/5</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Vibe</div>
                    <div className="font-semibold text-brand">{status?.my_review?.vibe_label || vibe || '—'}</div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Comment</div>
                  <div className={comment ? 'whitespace-pre-wrap break-words text-sm text-slate-700' : 'text-sm italic text-slate-400'}>
                    {comment || 'NULL'}
                  </div>
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
