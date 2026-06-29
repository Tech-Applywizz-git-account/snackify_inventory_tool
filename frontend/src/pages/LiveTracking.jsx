import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const CANCEL_WINDOW_SEC = 30;

const CATEGORY_EMOJI = {
  beverage: '☕',
  food: '🥪',
  snack: '🍪',
  meal: '🍱',
  stationery: '📎',
  cleaning: '🧹',
  other: '📦',
};

/* ── Stages definition ───────────────────────────────────────────── */
const STAGES = [
  {
    id: 'placed',
    emoji: '📋',
    label: 'Order Placed',
    sub: 'Your request is in the queue',
    color: 'bg-slate-100 text-slate-600',
    ring: 'ring-slate-300',
  },
  {
    id: 'accepted',
    emoji: '✅',
    label: 'Accepted',
    sub: 'Office boy is on it!',
    color: 'bg-blue-50 text-blue-600',
    ring: 'ring-blue-400',
  },
  {
    id: 'preparing',
    emoji: '☕',
    label: 'Preparing',
    sub: 'Being made with love ❤️',
    color: 'bg-amber-50 text-amber-600',
    ring: 'ring-amber-400',
  },
  {
    id: 'ready_for_pickup',
    emoji: '🏃',
    label: 'Ready for Pickup!',
    sub: 'Come collect from the pantry counter 📣',
    color: 'bg-teal-50 text-teal-600',
    ring: 'ring-teal-400',
  },
  {
    id: 'on_the_way',
    emoji: '🛵',
    label: 'On the Way',
    sub: 'Coming to you right now!',
    color: 'bg-brand/10 text-brand',
    ring: 'ring-brand',
  },
  {
    id: 'done',
    emoji: '🎉',
    label: 'Delivered!',
    sub: 'Enjoy! Rate your experience below.',
    color: 'bg-emerald-50 text-emerald-600',
    ring: 'ring-emerald-400',
  },
];

const CANCELLED = {
  id: 'cancelled',
  emoji: '❌',
  label: 'Cancelled',
  sub: 'This request was cancelled.',
  color: 'bg-rose-50 text-rose-600',
};

function stageIndex(live_status) {
  const i = STAGES.findIndex((s) => s.id === live_status);
  return i >= 0 ? i : 0;
}

/* ── Progress bar ────────────────────────────────────────────────── */
function ProgressBar({ current, total }) {
  const pct = Math.round((current / (total - 1)) * 100);
  return (
    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
      <motion.div
        className="h-2 bg-brand rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </div>
  );
}

/* ── Stage row ───────────────────────────────────────────────────── */
function StageRow({ stage, state }) {
  // state: 'done' | 'active' | 'waiting'
  return (
    <div className="flex items-center gap-4">
      {/* Icon */}
      <motion.div
        animate={state === 'active' ? { scale: [1, 1.15, 1] } : { scale: 1 }}
        transition={state === 'active' ? { repeat: Infinity, duration: 1.8 } : {}}
        className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ring-2 ${
          state === 'done'
            ? 'bg-emerald-50 ring-emerald-300'
            : state === 'active'
              ? `${stage.color} ${stage.ring}`
              : 'bg-slate-50 ring-slate-200 opacity-40'
        }`}
      >
        {state === 'done' ? '✅' : stage.emoji}
      </motion.div>

      {/* Labels */}
      <div className="min-w-0">
        <div
          className={`font-semibold text-sm ${
            state === 'active'
              ? 'text-slate-900'
              : state === 'done'
                ? 'text-slate-700'
                : 'text-slate-400'
          }`}
        >
          {stage.label}
        </div>
        {state === 'active' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-slate-500 mt-0.5"
          >
            {stage.sub}
          </motion.div>
        )}
      </div>

      {/* Active pulse dot */}
      {state === 'active' && (
        <motion.div
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="ml-auto w-2.5 h-2.5 rounded-full bg-brand shrink-0"
        />
      )}
      {state === 'done' && (
        <div className="ml-auto text-xs text-emerald-600 font-medium shrink-0">Done</div>
      )}
    </div>
  );
}

/* ── Rating sheet ────────────────────────────────────────────────── */
function RatingSheet({ requestId, onDone }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!rating) return;
    setBusy(true);
    try {
      await api.rateRequest(requestId, { rating, feedback: comment });
      onDone();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 120, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 120, opacity: 0 }}
        className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-8 shadow-2xl space-y-6"
      >
        <div className="text-center">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="text-2xl font-bold text-slate-900">Hope it hit the spot!</h2>
          <p className="text-slate-500 text-sm mt-1">Rate your experience — 1 to 10</p>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              className={`h-11 rounded-xl font-bold text-sm transition-all active:scale-90 ${
                n === rating
                  ? 'bg-brand text-white scale-105 shadow-md shadow-brand/30'
                  : n <= rating
                    ? 'bg-brand/15 text-brand border border-brand/20'
                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {rating > 0 && <div className="text-center text-sm font-bold text-brand">{rating}/10</div>}

        <textarea
          className="input min-h-[90px] bg-slate-50"
          placeholder="Shoutout for the Office Boy? ✨ (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={onDone}>
            Later
          </button>
          <button className="btn-primary flex-1" disabled={!rating || busy} onClick={submit}>
            {busy ? 'Submitting…' : '🚀 Send Rating'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── ETA Calculator ─────────────────────────────────────────────────── */
function calcETA(qty, queueAhead, isBeverage = false) {
  // Base time by quantity
  const q = parseInt(qty, 10) || 1;
  let base;
  if (q <= 1) base = 10;
  else if (q === 2) base = 12;
  else if (q === 3) base = 15;
  else base = 18;

  // Queue adjustment
  let bonus = 0;
  if (queueAhead >= 6) bonus = 10;
  else if (queueAhead >= 3) bonus = 5;

  // Beverage penalty: 10-minute penalty if beverage and (qty >= 3 or queueAhead >= 3)
  if (isBeverage && (q >= 3 || queueAhead >= 3)) {
    bonus += 10;
  }

  const eta = base + bonus;
  return { min: eta, max: eta + 2 };
}

/* ── Circular Countdown Timer (SVG) ────────────────────────────────── */
function CircularTimer({ secsLeft, total }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = secsLeft / total;
  const offset = circumference * (1 - progress);
  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;

  return (
    <div className="relative w-24 h-24 sm:w-32 sm:h-32">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        {/* Background circle */}
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="6" />
        {/* Progress circle */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={secsLeft > 10 ? '#f43f5e' : '#ef4444'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl sm:text-2xl font-extrabold text-slate-900 tabular-nums">
          {mins}:{secs.toString().padStart(2, '0')}
        </span>
        <span className="text-[9px] sm:text-[10px] text-slate-400 font-medium mt-0.5">
          to cancel
        </span>
      </div>
    </div>
  );
}

/* ── Order Confirmed Screen (Zomato/Swiggy style) ─────────────────── */
function OrderConfirmedScreen({ req, queueAhead, onDismiss, onCancelled }) {
  const [secsLeft, setSecsLeft] = useState(() => {
    const created = new Date(req.created_at).getTime();
    return Math.max(0, Math.ceil((created + CANCEL_WINDOW_SEC * 1000 - Date.now()) / 1000));
  });
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const confirmedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      const created = new Date(req.created_at).getTime();
      const remaining = Math.max(
        0,
        Math.ceil((created + CANCEL_WINDOW_SEC * 1000 - Date.now()) / 1000)
      );
      setSecsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(t);
        // Auto-confirm the order (sends it to office boy)
        if (!confirmedRef.current) {
          confirmedRef.current = true;
          api.confirmOrder(req.id).catch(() => {});
        }
        // Auto-dismiss after countdown ends + 1s
        setTimeout(onDismiss, 1000);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [req.created_at, onDismiss, req.id]);

  async function doCancel() {
    setCancelling(true);
    try {
      await api.cancelOrder(req.id);
      setCancelled(true);
      setTimeout(onCancelled, 1500);
    } catch (e) {
      alert(e.message);
      setCancelling(false);
    }
  }

  const emoji = CATEGORY_EMOJI[req.category] || '📦';
  const qty = parseInt(req.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
  const eta = calcETA(qty, queueAhead, req.category === 'beverage');

  if (cancelled) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-4 sm:p-6 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 200 }}
          className="text-7xl mb-4"
        >
          ❌
        </motion.div>
        <h1 className="text-2xl font-extrabold text-slate-900">Order Cancelled</h1>
        <p className="text-sm text-slate-500 mt-2">You can place a new order anytime</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto"
    >
      {/* Celebration animation */}
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
        className="relative mb-1"
      >
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <motion.span
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ repeat: 2, duration: 0.5 }}
            className="text-4xl sm:text-5xl"
          >
            ✅
          </motion.span>
        </div>
        {/* Sparkles */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0, 1, 0] }}
            transition={{ delay: 0.3 + i * 0.1, duration: 0.8 }}
            className="absolute w-2 h-2 rounded-full bg-amber-400"
            style={{
              top: `${50 + 55 * Math.sin((i * Math.PI * 2) / 6)}%`,
              left: `${50 + 55 * Math.cos((i * Math.PI * 2) / 6)}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-xl sm:text-2xl font-extrabold text-slate-900 mb-1"
      >
        Order Confirmed!
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-xs sm:text-sm text-slate-400 mb-4 sm:mb-6"
      >
        Your order is in the queue
      </motion.p>

      {/* Order summary card */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="w-full max-w-xs bg-slate-50 rounded-2xl p-4 mb-4 sm:mb-6"
      >
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white flex items-center justify-center text-2xl shadow-sm shrink-0">
            {emoji}
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 text-sm truncate">
              {req.parsed_item || req.raw_text}
            </h3>
            {req.parsed_location && (
              <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                <MapPin size={10} /> {req.parsed_location}
              </p>
            )}
          </div>
          {qty > 1 && <span className="text-brand font-bold text-sm shrink-0">×{qty}</span>}
        </div>

        {/* ETA */}
        <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
              Estimated delivery
            </div>
            <div className="text-lg font-extrabold text-slate-900">
              ~{eta.min}-{eta.max} min
            </div>
          </div>
          <div className="text-2xl">🕐</div>
        </div>
      </motion.div>

      {/* Circular countdown timer */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6 }}
        className="flex flex-col items-center mb-4 sm:mb-6"
      >
        <CircularTimer secsLeft={secsLeft} total={CANCEL_WINDOW_SEC} />
        <button
          onClick={doCancel}
          disabled={cancelling || secsLeft <= 0}
          className="mt-3 px-6 py-2.5 bg-rose-50 text-rose-600 text-sm font-bold rounded-xl border-2 border-rose-200 hover:bg-rose-100 active:scale-95 transition-all disabled:opacity-30"
        >
          {cancelling ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 border-2 border-rose-300 border-t-rose-600 rounded-full animate-spin" />{' '}
              Cancelling…
            </span>
          ) : (
            'Cancel Order'
          )}
        </button>
      </motion.div>

      {/* Track order button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        onClick={onDismiss}
        className="flex items-center gap-2 text-brand font-bold text-sm hover:underline"
      >
        Track Order <ArrowRight size={16} />
      </motion.button>
    </motion.div>
  );
}

/* ── Single Order View (extracted, unchanged logic) ──────────────── */
function OrderView({ req, onRate, onRefresh }) {
  const isCancelled = req.status === 'cancelled';
  const isDone = req.status === 'done';
  const isRecorded = req.live_status === 'Recorded';

  // 'confirming' is treated as 'placed' for the progress tracker
  const effectiveLiveStatus =
    req.live_status === 'confirming' ? 'placed' : req.live_status || 'placed';
  const curIdx = isCancelled ? -1 : stageIndex(effectiveLiveStatus);
  const curStage = isCancelled ? CANCELLED : STAGES[curIdx];

  const [confirmingCollection, setConfirmingCollection] = useState(false);

  async function handleConfirmCollection() {
    setConfirmingCollection(true);
    try {
      await api.setRequestStatus(req.id, 'done', 'done');
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setConfirmingCollection(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Hero status card */}
      {isRecorded ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 shadow-lg text-indigo-900"
        >
          <div className="flex items-center gap-4">
            <div className="text-6xl animate-pulse">🌙</div>
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-indigo-800">Order Recorded!</div>
              <div className="text-xs opacity-95 mt-1 leading-relaxed">
                Night shift order recorded for inventory and reporting. No delivery/office boy
                service is active at night. Collect your order from the pantry counter.
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key={curStage.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`card ${curStage.color} border-0 shadow-lg`}
        >
          <div className="flex items-center gap-4">
            <motion.div
              animate={!isCancelled && !isDone ? { scale: [1, 1.12, 1] } : { scale: 1 }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="text-6xl"
            >
              {curStage.emoji}
            </motion.div>
            <div className="min-w-0">
              <div className="text-xl font-bold">{curStage.label}</div>
              <div className="text-sm opacity-80 mt-0.5">{curStage.sub}</div>
              {req.parsed_location && (
                <div className="flex items-center gap-1 text-xs mt-2 opacity-70">
                  <MapPin size={12} /> {req.parsed_location}
                </div>
              )}
            </div>
          </div>

          {!isCancelled && (
            <div className="mt-5">
              <ProgressBar current={curIdx} total={STAGES.length} />
              <div className="flex justify-between text-[10px] mt-1 opacity-60">
                <span>Placed</span>
                <span>Delivered</span>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Delivery time badge */}
      {isDone && !isRecorded && req.fulfilled_at && req.created_at && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-100 text-center py-4"
        >
          <div className="text-3xl mb-1">⚡</div>
          <div className="text-sm text-emerald-700 font-bold">
            Delivered in {(() => {
              const mins = Math.round(
                (new Date(req.fulfilled_at) - new Date(req.created_at)) / 60000
              );
              return mins <= 1 ? 'under a minute' : `${mins} minutes`;
            })()}
          </div>
          <div className="text-[10px] text-emerald-500 mt-1">
            {new Date(req.created_at).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Kolkata',
            })}
            {' → '}
            {new Date(req.fulfilled_at).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Kolkata',
            })}
          </div>
        </motion.div>
      )}

      {/* Stage timeline */}
      {!isCancelled && !isRecorded && (
        <div className="card space-y-5">
          <h3 className="font-semibold text-slate-900 text-sm uppercase tracking-wide">
            Live Status
          </h3>
          {STAGES.map((stage, idx) => (
            <StageRow
              key={stage.id}
              stage={stage}
              state={idx < curIdx ? 'done' : idx === curIdx ? 'active' : 'waiting'}
            />
          ))}
        </div>
      )}

      {/* Order details */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-slate-900 text-sm uppercase tracking-wide">
          Order Details
        </h3>
        <div className="flex justify-between items-start">
          <div>
            <div className="font-medium text-slate-900 text-base">
              {req.parsed_item || 'Your Request'}
            </div>
            {req.parsed_employee_name && (
              <div className="text-xs text-slate-500 mt-0.5">For: {req.parsed_employee_name}</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-slate-400 uppercase">Request ID</div>
            <div className="font-mono text-xs text-slate-600">
              {req.user_order_number || req.id?.slice(0, 8)}
            </div>
          </div>
        </div>
        {req.instruction && (
          <div className="text-sm text-slate-600 italic bg-slate-50 rounded-xl p-3">
            &ldquo;{req.instruction}&rdquo;
          </div>
        )}
      </div>

      {/* Rating prompt when done */}
      {isDone && req.rating_status === 'done' && (
        <div className="card bg-emerald-50 border-0 text-center space-y-1">
          <div className="text-2xl">⭐</div>
          <div className="font-semibold text-emerald-800 text-sm">Thanks for the rating!</div>
          <div className="text-lg font-extrabold text-emerald-700">{req.rating || 0}/10</div>
          {req.feedback && (
            <div className="text-xs text-emerald-700 italic">&ldquo;{req.feedback}&rdquo;</div>
          )}
        </div>
      )}

      {isDone && req.rating_status !== 'done' && (
        <button className="w-full btn-secondary text-sm" onClick={() => onRate(req.id)}>
          ⭐ Rate this order
        </button>
      )}

      {/* Collection button for ready_for_pickup self_pickup orders */}
      {req.live_status === 'ready_for_pickup' && req.delivery_mode === 'self_pickup' && (
        <button
          disabled={confirmingCollection}
          onClick={handleConfirmCollection}
          className="w-full h-12 bg-emerald-600 text-white hover:bg-emerald-700 font-bold text-sm rounded-2xl shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 active:scale-[0.99] transition-all disabled:opacity-50"
        >
          {confirmingCollection ? (
            <>
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{' '}
              Confirming...
            </>
          ) : (
            <>✓ I've collected my order</>
          )}
        </button>
      )}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */
export default function LiveTracking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [allOrders, setAllOrders] = useState([]); // all active orders
  const [req, setReq] = useState(null); // current viewed order
  const [err, setErr] = useState('');
  const [showRate, setShowRate] = useState(false);
  const [rateId, setRateId] = useState(null);
  const [queueAhead, setQueueAhead] = useState(0);
  const [showConfirm, setShowConfirm] = useState(false);
  const confirmChecked = useRef(false);
  const shownRatingRef = useRef(false);
  const touchStartX = useRef(null);
  // Polling state
  const activeRef = useRef(false);         // false when unmounted or id changed
  const inFlightRef = useRef(false);       // true while a load() is awaiting
  const timerRef = useRef(null);           // handle for the 5-second poll timer
  const retryTimerRef = useRef(null);      // handle for the 429 backoff timer
  const pollCountRef = useRef(0);          // increments each tick for aux throttle
  const lastAuxRef = useRef({             // cached auxiliary data between 30-s fetches
    allRequests: [],
    queueData: { pending: 0, in_progress: 0 },
  });

  // Load the current order + auxiliary data.
  // Critical: api.getRequest(id) every 5 s.
  // Auxiliary: api.listRequests() + api.queueCount() on first load, then every 30 s.
  // Self-scheduling setTimeout replaces setInterval so the next poll only starts
  // after the current one completes, preventing overlapping requests by design.
  const load = useCallback(async () => {
    if (!activeRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    pollCountRef.current += 1;
    const fetchAuxiliary = pollCountRef.current % 6 === 1; // tick 1, 7, 13 … = every 30 s

    try {
      const [data, rawRequests, rawQueue] = await Promise.all([
        api.getRequest(id),
        fetchAuxiliary ? api.listRequests().catch(() => null) : Promise.resolve(null),
        fetchAuxiliary ? api.queueCount().catch(() => null) : Promise.resolve(null),
      ]);

      if (!activeRef.current) return; // unmounted or id changed while awaiting

      // Update auxiliary cache only when freshly fetched
      if (rawRequests !== null) lastAuxRef.current.allRequests = rawRequests;
      if (rawQueue !== null) lastAuxRef.current.queueData = rawQueue;

      const { allRequests, queueData } = lastAuxRef.current;

      setReq(data);
      setErr(''); // clear any previous error on success
      setQueueAhead((queueData.pending || 0) + (queueData.in_progress || 0));

      // Show confirmation screen for freshly placed orders (< 30s old)
      if (!confirmChecked.current) {
        confirmChecked.current = true;
        const created = new Date(data.created_at).getTime();
        const elapsed = (Date.now() - created) / 1000;
        const isConfirming = data.status === 'confirming';
        const isPendingPlaced =
          data.status === 'pending' && (!data.live_status || data.live_status === 'placed');
        if ((isConfirming || isPendingPlaced) && elapsed < CANCEL_WINDOW_SEC) {
          setShowConfirm(true);
        }
      }

      // Collect all active (non-done, non-cancelled) orders
      const active = (allRequests || []).filter((r) =>
        ['confirming', 'pending', 'in_progress'].includes(r.status)
      );
      // Make sure current order is included even if done/cancelled
      const hasCurrentInActive = active.some((r) => r.id === id);
      const combined = hasCurrentInActive ? active : [data, ...active];
      setAllOrders(combined);

      // Show rating once when order first reaches 'done'
      // Night shift orders (live_status='Recorded') skip rating — no real delivery happened
      if (
        data.status === 'done' &&
        data.rating_status !== 'done' &&
        data.live_status !== 'Recorded' &&
        !shownRatingRef.current
      ) {
        shownRatingRef.current = true;
        setTimeout(() => setShowRate(true), 1200);
      }

      // Schedule next critical poll in 5 s
      timerRef.current = setTimeout(() => {
        if (activeRef.current) load();
      }, 5000);
    } catch (e) {
      if (!activeRef.current) return;

      if (e.status === 429) {
        // Keep last known order data visible; show a friendly non-technical banner
        setErr('Updates are temporarily busy. Retrying shortly.');
        const pauseMs = (e.retryAfterSeconds || 30) * 1000;
        // Clear both timers before setting the single retry timer
        clearTimeout(timerRef.current);
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          if (activeRef.current) load();
        }, pauseMs);
      } else {
        setErr(e.message);
        // Continue polling even on non-429 errors (preserve existing behaviour)
        timerRef.current = setTimeout(() => {
          if (activeRef.current) load();
        }, 5000);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [id]);

  useEffect(() => {
    activeRef.current = true;
    inFlightRef.current = false;
    pollCountRef.current = 0;
    lastAuxRef.current = { allRequests: [], queueData: { pending: 0, in_progress: 0 } };
    load();
    return () => {
      activeRef.current = false;
      clearTimeout(timerRef.current);
      clearTimeout(retryTimerRef.current);
    };
  }, [load]);

  // ── Swipe handling ──
  const currentIndex = allOrders.findIndex((r) => r.id === id);

  function goToOrder(index) {
    if (index >= 0 && index < allOrders.length) {
      const nextId = allOrders[index].id;
      if (nextId !== id) {
        shownRatingRef.current = false;
        setShowRate(false);
        navigate(`/track/${nextId}`, { replace: true });
      }
    }
  }

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e) {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    touchStartX.current = null;
    if (Math.abs(diff) < 50) return; // too small, not a swipe
    if (diff > 0)
      goToOrder(currentIndex + 1); // swipe left → next
    else goToOrder(currentIndex - 1); // swipe right → prev
  }

  // Full-screen error only when no order data has ever loaded (e.g. auth failure, network down).
  // If req is already loaded, show the order UI with a banner instead (see below).
  if (err && !req)
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
        <div className="text-sm text-center px-6">{err}</div>
        <Link to="/request" className="btn-secondary text-sm mt-2">
          ← Back to Request
        </Link>
      </div>
    );

  if (!req)
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
        <div className="w-8 h-8 border-2 border-slate-200 border-t-brand rounded-full animate-spin" />
        <span className="text-sm">Loading your order…</span>
      </div>
    );

  const hasMultiple = allOrders.length > 1;

  return (
    <div
      className="max-w-lg mx-auto pb-24 space-y-4"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Non-critical error banner — shown when req data is available but a poll failed */}
      {err && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-center">
          {err}
        </div>
      )}

      {/* Back + order nav */}
      <div className="flex items-center justify-between pt-2">
        <Link
          to="/request"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand"
        >
          <ChevronLeft size={16} /> Back to Request
        </Link>

        {/* Multi-order nav arrows + dots */}
        {hasMultiple && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToOrder(currentIndex - 1)}
              disabled={currentIndex <= 0}
              className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center disabled:opacity-30 hover:bg-slate-200 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="flex gap-1.5">
              {allOrders.map((o, i) => (
                <button
                  key={o.id}
                  onClick={() => goToOrder(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === currentIndex ? 'w-5 bg-brand' : 'w-2 bg-slate-300 hover:bg-slate-400'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => goToOrder(currentIndex + 1)}
              disabled={currentIndex >= allOrders.length - 1}
              className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center disabled:opacity-30 hover:bg-slate-200 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Order counter */}
      {hasMultiple && (
        <div className="text-center text-xs text-slate-400 font-medium -mt-2">
          Order {currentIndex + 1} of {allOrders.length}
        </div>
      )}

      {/* Swipeable order view */}
      <AnimatePresence mode="wait">
        <motion.div
          key={req.id}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.2 }}
        >
          <OrderView
            req={req}
            onRate={(rid) => {
              setRateId(rid);
              setShowRate(true);
            }}
            onRefresh={load}
          />
        </motion.div>
      </AnimatePresence>

      {/* Rating sheet */}
      <AnimatePresence>
        {showRate && (
          <RatingSheet
            requestId={rateId || id}
            onDone={() => {
              setShowRate(false);
              setRateId(null);
              load();
            }}
          />
        )}
      </AnimatePresence>

      {/* Order Confirmed Screen — Zomato/Swiggy style */}
      <AnimatePresence>
        {showConfirm && req && (
          <OrderConfirmedScreen
            req={req}
            queueAhead={Math.max(0, queueAhead - 1)}
            onDismiss={() => setShowConfirm(false)}
            onCancelled={() => {
              setShowConfirm(false);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
