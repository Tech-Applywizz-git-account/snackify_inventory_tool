import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, Clock, Loader2, RotateCcw, Search, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
  done: { label: 'Delivered', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400' },
  cancelled: { label: 'Cancelled', color: 'bg-rose-100 text-rose-700', dot: 'bg-rose-400' },
};

const LIVE_STATUS_LABEL = {
  placed: 'Order Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  on_the_way: 'On the Way',
  done: 'Delivered',
  cancelled: 'Cancelled',
  Recorded: 'Recorded',
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** Group orders by date label: Today, Yesterday, or formatted date */
function groupByDate(orders) {
  const groups = {};
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

  for (const order of orders) {
    const d = new Date(order.created_at);
    const dateStr = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

    let label;
    if (dateStr === todayStr) label = 'Today';
    else if (dateStr === yesterdayStr) label = 'Yesterday';
    else
      label = d.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

    if (!groups[label]) groups[label] = [];
    groups[label].push(order);
  }

  return groups;
}

function _formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  const day = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${day} · ${time}`;
}

function deliveryDuration(createdAt, fulfilledAt) {
  if (!fulfilledAt) return null;
  const diff = Math.round((new Date(fulfilledAt) - new Date(createdAt)) / 60000);
  if (diff < 1) return 'Under 1 min';
  if (diff === 1) return '1 min';
  return `${diff} min`;
}

// ── Order Card (Zomato/Swiggy style) ──────────────────────────────────────────
function OrderCard({ order, onTap, onReorder, onCancel }) {
  const emoji = CATEGORY_EMOJI[order.category] || '📦';
  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const liveLabel = LIVE_STATUS_LABEL[order.live_status] || order.live_status;
  const isActive = ['pending', 'in_progress'].includes(order.status);
  const isDone = order.status === 'done';
  const duration = isDone ? deliveryDuration(order.created_at, order.fulfilled_at) : null;

  // Cancel window: only for freshly placed pending orders
  const created = new Date(order.created_at).getTime();
  const secsElapsed = (Date.now() - created) / 1000;
  const canCancel =
    order.status === 'pending' &&
    (order.live_status || 'placed') === 'placed' &&
    secsElapsed < CANCEL_WINDOW_SEC;

  // Parse quantity from raw_text like "2x CCD Coffee"
  const qty = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400 font-medium">
          {formatDateTime(order.created_at)}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-extrabold px-2.5 py-1 rounded-full ${status.color}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          {isActive ? liveLabel : status.label}
        </span>
      </div>

      <div className="flex items-start gap-3 cursor-pointer" onClick={onTap}>
        <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center text-2xl shrink-0">
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900 text-[15px] leading-tight">
            {order.parsed_item || order.raw_text}
            {qty > 1 && <span className="text-brand ml-1">×{qty}</span>}
          </h3>
          {order.parsed_location && (
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              📍 {order.parsed_location}
            </p>
          )}

          {/* Star rating display */}
          {isDone && order.rating && (
            <div className="mt-1 flex flex-col gap-0.5">
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const starRating = Math.round(order.rating / 2);
                  return (
                    <span
                      key={n}
                      className={`text-sm ${n <= starRating ? 'text-amber-400' : 'text-slate-200'}`}
                    >
                      ★
                    </span>
                  );
                })}
              </div>
              {order.feedback && (
                <p className="text-slate-400 text-[10px] italic mt-0.5">"{order.feedback}"</p>
              )}
            </div>
          )}
        </div>
        <ChevronRight size={18} className="text-slate-300 self-center" />
      </div>

      {/* Delivery duration for completed orders */}
      {isDone && duration && (
        <div className="bg-slate-50 rounded-xl px-3 py-2 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="text-emerald-500">⏱️</span>
          <span>
            Delivered in <span className="font-bold text-slate-700">{duration}</span>
          </span>
        </div>
      )}

      {/* Cancelled reason */}
      {order.status === 'cancelled' && order.notes && (
        <div className="bg-rose-50/40 rounded-xl px-3 py-2 flex items-center gap-2 text-[11px] text-rose-500 italic">
          <span>❌ {order.notes}</span>
        </div>
      )}

      {/* Action strip */}
      <div className="border-t border-slate-50 pt-3 flex items-center justify-between">
        <span className="text-[10px] text-slate-300 font-mono">
          #{order.user_order_number || order.id?.slice(0, 8)}
        </span>

        {canCancel ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel(order);
            }}
            className="flex items-center gap-1 text-rose-600 text-xs font-bold hover:underline"
          >
            <XCircle size={12} /> Cancel order ({Math.ceil(CANCEL_WINDOW_SEC - secsElapsed)}s)
          </button>
        ) : !isActive ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReorder(order);
            }}
            className="flex items-center gap-1 bg-brand/5 hover:bg-brand/10 text-brand px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
          >
            <RotateCcw size={12} /> Reorder
          </button>
        ) : null}
      </div>
    </motion.div>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({ filter }) {
  const messages = {
    all: { icon: '📦', title: 'No orders yet', sub: 'Your order history will show up here' },
    active: { icon: '⏳', title: 'No active orders', sub: 'Place an order from the cafeteria' },
    delivered: {
      icon: '✅',
      title: 'No delivered orders',
      sub: 'Completed orders will appear here',
    },
    cancelled: { icon: '❌', title: 'No cancelled orders', sub: "That's a good thing!" },
  };
  const m = messages[filter] || messages.all;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="text-4xl mb-3">{m.icon}</span>
      <h3 className="font-bold text-slate-700 text-base">{m.title}</h3>
      <p className="text-sm text-slate-400 mt-1">{m.sub}</p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function OrderHistory() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listRequests();
      setOrders(data || []);
    } catch (e) {
      console.error('OrderHistory load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Filter orders
  const filtered = orders.filter((o) => {
    // Status filter
    if (filter === 'active' && !['pending', 'in_progress'].includes(o.status)) return false;
    if (filter === 'delivered' && o.status !== 'done') return false;
    if (filter === 'cancelled' && o.status !== 'cancelled') return false;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const text =
        `${o.parsed_item || ''} ${o.raw_text || ''} ${o.parsed_location || ''}`.toLowerCase();
      if (!text.includes(q)) return false;
    }

    return true;
  });

  const grouped = groupByDate(filtered);
  const dateKeys = Object.keys(grouped);

  // Counts for filter badges
  const activeCount = orders.filter((o) => ['pending', 'in_progress'].includes(o.status)).length;
  const deliveredCount = orders.filter((o) => o.status === 'done').length;
  const cancelledCount = orders.filter((o) => o.status === 'cancelled').length;
  const counts = {
    all: orders.length,
    active: activeCount,
    delivered: deliveredCount,
    cancelled: cancelledCount,
  };

  function handleReorder(order) {
    const qty = parseInt(order.raw_text?.match(/^(\d+)x/)?.[1], 10) || 1;
    navigate('/request', {
      state: {
        reorderItem: order.parsed_item,
        reorderQty: qty,
        reorderLocation: order.parsed_location,
      },
    });
  }

  async function handleCancelConfirm() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.cancelOrder(cancelTarget.id);
      setCancelTarget(null);
      load(); // refresh list
    } catch (e) {
      alert(`Failed to cancel: ${e.message}`);
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 text-brand animate-spin" />
        <p className="text-slate-400 text-sm">Loading orders…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 pt-1">
        <button
          onClick={() => navigate('/request')}
          className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Order History</h1>
          <p className="text-xs text-slate-400">
            {orders.length} total order{orders.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search orders…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border-2 border-slate-100 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:bg-white transition-all"
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
              filter === f.key
                ? 'bg-brand text-white shadow-sm shadow-brand/20'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
            {counts[f.key] > 0 && (
              <span
                className={`h-4 min-w-[16px] px-1 rounded-full text-[10px] font-extrabold flex items-center justify-center ${
                  filter === f.key ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {counts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Orders List */}
      {dateKeys.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-6">
          {dateKeys.map((dateLabel) => (
            <section key={dateLabel}>
              {/* Date header */}
              <div className="flex items-center gap-2 mb-3">
                <Clock size={13} className="text-slate-400" />
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {dateLabel}
                </h2>
                <div className="h-px flex-1 bg-slate-100" />
                <span className="text-[10px] text-slate-400 font-medium">
                  {grouped[dateLabel].length} order{grouped[dateLabel].length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Order cards */}
              <div className="space-y-3">
                {grouped[dateLabel].map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onTap={() => navigate(`/track/${order.id}`)}
                    onReorder={handleReorder}
                    onCancel={setCancelTarget}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Cancel Confirm Dialog */}
      <AnimatePresence>
        {cancelTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => !cancelling && setCancelTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-6 max-w-xs w-full shadow-2xl text-center space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-4xl">🤔</div>
              <h3 className="font-bold text-slate-900 text-lg">Cancel this order?</h3>
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-slate-700">
                  {cancelTarget.parsed_item || cancelTarget.raw_text}
                </span>{' '}
                will be cancelled. This can't be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setCancelTarget(null)}
                  disabled={cancelling}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition-all"
                >
                  Keep it
                </button>
                <button
                  onClick={handleCancelConfirm}
                  disabled={cancelling}
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  {cancelling ? (
                    <>
                      <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />{' '}
                      Cancelling…
                    </>
                  ) : (
                    'Yes, cancel'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
