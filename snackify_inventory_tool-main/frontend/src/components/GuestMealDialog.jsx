import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';

/**
 * GuestMealDialog — a popover dialog for booking a guest meal.
 * Props:
 *   open      {boolean}   — whether the dialog is visible
 *   onClose   {function}  — called when the dialog is dismissed
 *   onSuccess {function}  — called with { bookingId } after a successful booking
 */
export default function GuestMealDialog({ open, onClose, onSuccess }) {
  const [guestName, setGuestName] = useState('');
  const [mealType, setMealType] = useState('veg');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function handleClose() {
    if (busy) return;
    setGuestName('');
    setMealType('veg');
    setError('');
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!guestName.trim()) {
      setError('Please enter the guest name.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const result = await api.bookGuestMeal({ guest_name: guestName.trim(), meal_type: mealType });
      setGuestName('');
      setMealType('veg');
      onSuccess?.(result);
      onClose();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="guest-meal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={handleClose}
        >
          <motion.div
            key="guest-meal-dialog"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">🍽️ Book Guest Meal</h2>
                <p className="text-xs text-slate-500 mt-0.5">Today's date will be used for the booking.</p>
              </div>
              <button
                onClick={handleClose}
                disabled={busy}
                className="h-8 w-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
              {/* Guest Name */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
                  Guest Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Enter guest's full name"
                  disabled={busy}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent disabled:opacity-50 transition"
                  autoFocus
                />
              </div>

              {/* Meal Type */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">
                  Meal Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'veg', emoji: '🥦', label: 'Veg' },
                    { value: 'non_veg', emoji: '🍗', label: 'Non-Veg' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={busy}
                      onClick={() => setMealType(opt.value)}
                      className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                        mealType === opt.value
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      } disabled:opacity-50`}
                    >
                      <span className="text-base">{opt.emoji}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold px-4 py-3 rounded-xl">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={busy}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !guestName.trim()}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? 'Booking…' : 'Book Meal'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
