import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  PlayCircle,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// ── IST date helpers ──────────────────────────────────────────────────────────
function getISTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString()
    .slice(0, 10);
}

// Returns the next working day (Mon–Fri) in IST as YYYY-MM-DD.
// Friday → Monday, Saturday → Monday, Sunday → Monday, otherwise +1 day.
function getNextWorkingDayIST() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  ist.setDate(ist.getDate() + 1);
  while (ist.getDay() === 0 || ist.getDay() === 6) {
    ist.setDate(ist.getDate() + 1);
  }
  return ist.toISOString().slice(0, 10);
}

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  not_scheduled: { label: 'Not Scheduled', color: '#94A3B8', bg: '#F8FAFC', icon: Clock },
  pending: { label: 'Queued', color: '#F59E0B', bg: '#FFFBEB', icon: Clock },
  printing: { label: 'Printing...', color: '#6366F1', bg: '#EEF2FF', icon: Printer },
  completed: { label: 'Printed', color: '#10B981', bg: '#ECFDF5', icon: CheckCircle2 },
  failed: { label: 'Failed', color: '#EF4444', bg: '#FEF2F2', icon: AlertCircle },
  cancelled: { label: 'Cancelled', color: '#94A3B8', bg: '#F8FAFC', icon: AlertCircle },
};

// ── CabinCard component ───────────────────────────────────────────────────────
function CabinCard({ cabin, date, onTrigger, onReprint }) {
  const [expanded, setExpanded] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const statusConf = STATUS_CONFIG[cabin.status] || STATUS_CONFIG.not_scheduled;
  const StatusIcon = statusConf.icon;
  const hasBookings = cabin.total > 0;

  async function loadBookings() {
    if (!expanded) {
      setLoading(true);
      try {
        const data = await api.cabinBookings(date, cabin.cabin_name);
        setBookings(data || []);
      } catch (e) {
        console.error(e.message);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((e) => !e);
  }

  async function handleTrigger() {
    if (triggering) return;
    setTriggering(true);
    try {
      await onTrigger(cabin.cabin_name);
    } finally {
      setTriggering(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'white',
        borderRadius: 16,
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        border: `1.5px solid ${statusConf.color}22`,
        overflow: 'hidden',
        marginBottom: 10,
      }}
    >
      {/* Header row */}
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Status dot */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: statusConf.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <StatusIcon size={16} color={statusConf.color} />
        </div>

        {/* Cabin info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{cabin.cabin_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: statusConf.color,
                background: statusConf.bg,
                borderRadius: 5,
                padding: '2px 7px',
                border: `1px solid ${statusConf.color}33`,
              }}
            >
              {statusConf.label}
            </span>
            {cabin.completed_at && (
              <span style={{ fontSize: 10, color: '#94A3B8' }}>
                at{' '}
                {new Date(cabin.completed_at).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                })}
              </span>
            )}
          </div>
        </div>

        {/* Token count */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{cabin.total || 0}</div>
          <div
            style={{
              fontSize: 9,
              color: '#94A3B8',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Tokens
          </div>
        </div>

        {/* Meal type counts */}
        {hasBookings && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {cabin.veg > 0 && (
              <span
                style={{
                  fontSize: 10,
                  background: '#ECFDF5',
                  color: '#065F46',
                  borderRadius: 5,
                  padding: '2px 6px',
                  fontWeight: 600,
                }}
              >
                V:{cabin.veg}
              </span>
            )}
            {cabin.non_veg > 0 && (
              <span
                style={{
                  fontSize: 10,
                  background: '#FEF2F2',
                  color: '#991B1B',
                  borderRadius: 5,
                  padding: '2px 6px',
                  fontWeight: 600,
                }}
              >
                NV:{cabin.non_veg}
              </span>
            )}
            {cabin.egg > 0 && (
              <span
                style={{
                  fontSize: 10,
                  background: '#FFFBEB',
                  color: '#92400E',
                  borderRadius: 5,
                  padding: '2px 6px',
                  fontWeight: 600,
                }}
              >
                E:{cabin.egg}
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {hasBookings && cabin.status !== 'printing' && (
            <button
              onClick={handleTrigger}
              disabled={triggering}
              title={cabin.status === 'completed' ? 'Reprint all cabin tokens' : 'Print now'}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                background: cabin.status === 'completed' ? '#EEF2FF' : '#6366F1',
                color: cabin.status === 'completed' ? '#6366F1' : 'white',
                fontSize: 11,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                opacity: triggering ? 0.5 : 1,
              }}
            >
              {triggering ? (
                <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <PlayCircle size={12} />
              )}
              {cabin.status === 'completed' ? 'Reprint' : 'Print'}
            </button>
          )}
          <button
            onClick={loadBookings}
            style={{
              padding: '6px 8px',
              borderRadius: 8,
              border: '1.5px solid #E2E8F0',
              background: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {loading ? (
              <RefreshCw
                size={12}
                color="#94A3B8"
                style={{ animation: 'spin 1s linear infinite' }}
              />
            ) : expanded ? (
              <ChevronUp size={13} color="#64748B" />
            ) : (
              <ChevronDown size={13} color="#64748B" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded employee list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden', borderTop: '1.5px solid #F1F5F9' }}
          >
            <div style={{ padding: '10px 18px 14px' }}>
              {bookings.length === 0 ? (
                <p
                  style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: '10px 0' }}
                >
                  No bookings found for this cabin
                </p>
              ) : (
                bookings.map((b, idx) => {
                  const name = b.profiles?.preferred_name || b.profiles?.full_name || 'Unknown';
                  const code = b.profiles?.employee_code || '--';
                  const choiceEmoji = { veg: '🥬', non_veg: '🍗', egg: '🥚' };

                  return (
                    <div
                      key={b.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        background: idx % 2 === 0 ? '#F8FAFC' : 'white',
                        borderRadius: 8,
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{choiceEmoji[b.choice] || '🍱'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>
                          {name}
                        </div>
                        <div style={{ fontSize: 10, color: '#94A3B8' }}>{code}</div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 10 }}>
                        {b.token_number ? (
                          <span
                            style={{ fontFamily: 'monospace', fontWeight: 700, color: '#6366F1' }}
                          >
                            {b.token_number}
                          </span>
                        ) : (
                          <span style={{ color: '#94A3B8' }}>—</span>
                        )}
                        {b.print_count > 1 && (
                          <div style={{ color: '#D97706', fontWeight: 600 }}>×{b.print_count}</div>
                        )}
                      </div>
                      <button
                        onClick={() => onReprint(b.user_id, cabin.cabin_name)}
                        title="Reprint this employee's token"
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: '1.5px solid #E2E8F0',
                          background: 'white',
                          cursor: 'pointer',
                          fontSize: 10,
                          color: '#64748B',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Printer size={10} /> Reprint
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function MealTokenDashboard() {
  const today = getISTDate();
  const tomorrow = getNextWorkingDayIST();
  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.mealPrintStatus(date);
      setData(result);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [date, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh every 30s while on this page
  useEffect(() => {
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleTrigger(cabinName) {
    try {
      await api.triggerCabinPrint({ cabin_name: cabinName, date });
      showToast(`🖨️ Print job queued for ${cabinName}!`);
      setTimeout(load, 2000);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function handleReprint(userId, cabinName) {
    try {
      await api.reprintToken({ user_id: userId, date });
      showToast(`🖨️ Reprint queued for ${cabinName}`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  const cabins = data?.cabins || [];
  const filteredCabins = search
    ? cabins.filter((c) => c.cabin_name.toLowerCase().includes(search.toLowerCase()))
    : cabins;

  const summary = data?.summary;
  const printedCabins = cabins.filter((c) => c.status === 'completed').length;
  const pendingCabins = cabins.filter((c) => c.status === 'pending').length;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f0f9ff 0%, #fafafa 100%)',
        padding: '24px 16px',
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            style={{
              position: 'fixed',
              top: 16,
              left: 16,
              right: 16,
              zIndex: 999,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                maxWidth: 440,
                width: '100%',
                padding: '14px 18px',
                borderRadius: 14,
                boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: toast.type === 'error' ? '#FEF2F2' : '#ECFDF5',
                border: `1.5px solid ${toast.type === 'error' ? '#FECACA' : '#A7F3D0'}`,
              }}
            >
              {toast.type === 'error' ? (
                <AlertCircle size={18} color="#EF4444" />
              ) : (
                <CheckCircle2 size={18} color="#10B981" />
              )}
              <span
                style={{
                  fontSize: 13,
                  color: toast.type === 'error' ? '#991B1B' : '#065F46',
                  fontWeight: 500,
                }}
              >
                {toast.message}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Printer size={22} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', margin: 0 }}>
                Meal Token Dashboard
              </h1>
              <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>Cabin-wise print status</p>
            </div>
          </div>
          <button
            onClick={load}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: '1.5px solid #E2E8F0',
              background: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#64748B',
              fontWeight: 500,
            }}
          >
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Refresh
          </button>
        </div>

        {/* Date Selector */}
        <div
          style={{
            background: 'white',
            borderRadius: 14,
            border: '1.5px solid #E2E8F0',
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Clock size={14} color="#6366F1" />
          <label style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Date:</label>
          <input
            type="date"
            value={date}
            max={tomorrow}
            onChange={(e) => setDate(e.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              fontSize: 13,
              fontWeight: 600,
              color: '#0F172A',
              background: 'transparent',
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Summary Cards */}
        {summary && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {[
              { label: 'Total Meals', value: summary.totalMeals, emoji: '🍱', color: '#6366F1' },
              {
                label: 'Printed',
                value: `${printedCabins}/${cabins.filter((c) => c.total > 0).length} cabins`,
                emoji: '✅',
                color: '#10B981',
              },
              { label: 'Queued', value: pendingCabins, emoji: '⏳', color: '#F59E0B' },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  background: 'white',
                  borderRadius: 12,
                  padding: '14px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  textAlign: 'center',
                  border: '1.5px solid #F1F5F9',
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>{card.emoji}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: card.color }}>{card.value}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: '#94A3B8',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {card.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'white',
            borderRadius: 12,
            border: '1.5px solid #E2E8F0',
            padding: '9px 14px',
            marginBottom: 14,
          }}
        >
          <Search size={14} color="#94A3B8" />
          <input
            type="text"
            placeholder="Search cabin..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: 'none',
              outline: 'none',
              fontSize: 13,
              flex: 1,
              color: '#0F172A',
              background: 'transparent',
            }}
          />
        </div>

        {/* Cabin Cards */}
        {loading && !data ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '3px solid #E2E8F0',
                borderTopColor: '#6366F1',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 12px',
              }}
            />
            <p style={{ color: '#94A3B8', fontSize: 13 }}>Loading cabin statuses...</p>
          </div>
        ) : filteredCabins.length === 0 ? (
          <div
            style={{
              background: 'white',
              borderRadius: 16,
              padding: '40px 24px',
              textAlign: 'center',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
            <p style={{ color: '#64748B', fontWeight: 600 }}>No cabins found</p>
            <p style={{ color: '#94A3B8', fontSize: 12 }}>
              {search ? 'Try a different search term' : 'No bookings scheduled for this date'}
            </p>
          </div>
        ) : (
          filteredCabins.map((cabin) => (
            <CabinCard
              key={cabin.cabin_name}
              cabin={cabin}
              date={date}
              onTrigger={handleTrigger}
              onReprint={handleReprint}
            />
          ))
        )}

        {/* Legend */}
        <div
          style={{
            marginTop: 20,
            padding: '14px 18px',
            background: 'white',
            borderRadius: 14,
            border: '1.5px solid #F1F5F9',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 10,
            }}
          >
            Printing Schedule
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              { time: '11:00 AM', cabin: 'Balaji Cabin' },
              { time: '11:02 AM', cabin: 'Rama Krishna Cabin' },
              { time: '11:04 AM', cabin: 'Manisha Cabin' },
              { time: '11:06 AM', cabin: 'Tech Cabin' },
              { time: '11:08 AM', cabin: 'Marketing Cabin' },
              { time: '11:10 AM', cabin: 'Resume Cabin' },
            ].map((s) => (
              <div key={s.cabin} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#6366F1',
                    fontFamily: 'monospace',
                    minWidth: 52,
                  }}
                >
                  {s.time}
                </span>
                <span style={{ fontSize: 10, color: '#64748B' }}>{s.cabin}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
