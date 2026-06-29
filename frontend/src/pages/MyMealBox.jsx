import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Printer,
  RefreshCw,
  Ticket,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';

// ── IST date helper ───────────────────────────────────────────────────────────
function getISTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString()
    .slice(0, 10);
}

// ── Choice display config ─────────────────────────────────────────────────────
const CHOICE_CONFIG = {
  veg: { label: 'Veg', emoji: '🥬', color: '#10B981', bg: '#ECFDF5', border: '#A7F3D0' },
  non_veg: { label: 'Non-Veg', emoji: '🍗', color: '#EF4444', bg: '#FEF2F2', border: '#FECACA' },
  egg: { label: 'Egg', emoji: '🥚', color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A' },
};

export default function MyMealBox() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const today = getISTDate();
  const dateParam = params.get('date');
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || '') ? dateParam : today;
  const isToday = selectedDate === today;

  const [data, setData] = useState(null); // { booking, canReprint, reprintWindowMessage }
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.myMealToken(selectedDate);
      setData(result);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReprint() {
    if (printing) return;
    setPrinting(true);
    try {
      await api.reprintToken({ date: selectedDate });
      showToast('🖨️ Reprint sent to printer! Collect your token shortly.', 'success');
      await load(); // Refresh to show updated print_count
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setPrinting(false);
    }
  }

  const booking = data?.booking;
  const choice = booking ? CHOICE_CONFIG[booking.choice] : null;
  const isDuplicate = (booking?.print_count || 0) > 1;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f0f9ff 0%, #fafafa 100%)',
        padding: '24px 16px',
      }}
    >
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
                maxWidth: 400,
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

      {/* Header */}
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#64748B',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 20,
            padding: 0,
          }}
        >
          <ChevronLeft size={16} /> Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ticket size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A', margin: 0 }}>
              My Meal Box
            </h1>
            <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>
              {isToday ? "Today's lunch token" : 'Meal ticket for selected date'}
            </p>
          </div>
        </div>

        {/* Main Card */}
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                background: 'white',
                borderRadius: 20,
                boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                padding: 40,
                textAlign: 'center',
              }}
            >
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
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <p style={{ color: '#94A3B8', fontSize: 13 }}>Loading your token...</p>
            </motion.div>
          ) : !booking ? (
            <motion.div
              key="no-booking"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                background: 'white',
                borderRadius: 20,
                boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                padding: '40px 24px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 16 }}>🍽️</div>
              <p style={{ color: '#0F172A', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
                {isToday ? 'No meal booked for today' : 'No meal booked for this date'}
              </p>
              <p style={{ color: '#94A3B8', fontSize: 13, marginBottom: 24 }}>
                Book your meal for tomorrow before 6 PM
              </p>
              <button
                onClick={() => navigate('/meals')}
                style={{
                  background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 12,
                  padding: '10px 24px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Go to Meal Booking →
              </button>
            </motion.div>
          ) : (
            <motion.div key="token" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              {/* Duplicate badge */}
              {isDuplicate && (
                <div
                  style={{
                    background: '#FEF3C7',
                    border: '1.5px solid #FDE68A',
                    borderRadius: 10,
                    padding: '8px 14px',
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <AlertCircle size={14} color="#D97706" />
                  <span style={{ fontSize: 12, color: '#92400E', fontWeight: 600 }}>
                    DUPLICATE TOKEN — Reprint #{booking.print_count - 1}
                  </span>
                </div>
              )}

              {/* Token Card */}
              <div
                style={{
                  background: 'white',
                  borderRadius: 20,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
                  overflow: 'hidden',
                  border: `2px solid ${choice?.border || '#E2E8F0'}`,
                }}
              >
                {/* Meal type header */}
                <div
                  style={{
                    background: choice?.bg || '#F8FAFC',
                    padding: '20px 24px',
                    borderBottom: `1.5px solid ${choice?.border || '#E2E8F0'}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#94A3B8',
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                        }}
                      >
                        {isToday ? "Today's Meal" : 'Meal Ticket'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <span style={{ fontSize: 28 }}>{choice?.emoji}</span>
                        <span style={{ fontSize: 22, fontWeight: 700, color: choice?.color }}>
                          {choice?.label || booking.choice}
                        </span>
                      </div>
                    </div>
                    {booking.token_number ? (
                      <div style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#94A3B8',
                            textTransform: 'uppercase',
                            letterSpacing: 1,
                          }}
                        >
                          Token #
                        </div>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 800,
                            color: '#0F172A',
                            fontFamily: 'monospace',
                            letterSpacing: 0.5,
                            marginTop: 4,
                          }}
                        >
                          {booking.token_number}
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          background: '#F1F5F9',
                          borderRadius: 8,
                          padding: '6px 12px',
                          fontSize: 11,
                          color: '#64748B',
                          fontWeight: 500,
                        }}
                      >
                        Token pending
                      </div>
                    )}
                  </div>
                </div>

                {/* Token Details */}
                <div style={{ padding: '20px 24px' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 16,
                      marginBottom: 20,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#94A3B8',
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                        }}
                      >
                        Date
                      </div>
                      <div
                        style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginTop: 4 }}
                      >
                        {new Date(`${selectedDate}T00:00:00+05:30`).toLocaleDateString('en-IN', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                        })}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#94A3B8',
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                        }}
                      >
                        Lunch Time
                      </div>
                      <div
                        style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginTop: 4 }}
                      >
                        1:00 PM
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#94A3B8',
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                        }}
                      >
                        Cabin
                      </div>
                      <div
                        style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginTop: 4 }}
                      >
                        {booking.cabin_name || '—'}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#94A3B8',
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                        }}
                      >
                        Print Status
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                        {booking.print_count === 0 ? (
                          <span style={{ color: '#F59E0B' }}>⏳ Pending</span>
                        ) : (
                          <span style={{ color: '#10B981' }}>✅ Printed</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Collect instruction */}
                  {booking.token_number && (
                    <div
                      style={{
                        background: '#F0FDF4',
                        border: '1.5px solid #BBF7D0',
                        borderRadius: 12,
                        padding: '12px 16px',
                        marginBottom: 20,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <span style={{ fontSize: 20 }}>🎁</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#065F46' }}>
                          Collect from {booking.cabin_name || 'your cabin'} Meal Box
                        </div>
                        <div style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>
                          Tokens are placed at 11:00 AM
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reprint Button */}
                  {booking.token_number && (
                    <div>
                      {data?.canReprint ? (
                        <button
                          onClick={handleReprint}
                          disabled={printing}
                          style={{
                            width: '100%',
                            padding: '14px',
                            background: printing
                              ? '#94A3B8'
                              : 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                            color: 'white',
                            border: 'none',
                            borderRadius: 14,
                            fontSize: 14,
                            fontWeight: 700,
                            cursor: printing ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            transition: 'all 0.2s',
                          }}
                        >
                          {printing ? (
                            <>
                              <RefreshCw
                                size={16}
                                style={{ animation: 'spin 1s linear infinite' }}
                              />{' '}
                              Sending to Printer...
                            </>
                          ) : (
                            <>
                              <Printer size={16} />{' '}
                              {isDuplicate ? 'Reprint Token Again' : 'Reprint My Token'}
                            </>
                          )}
                        </button>
                      ) : (
                        <div
                          style={{
                            background: '#F8FAFC',
                            border: '1.5px solid #E2E8F0',
                            borderRadius: 14,
                            padding: '12px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <Clock size={14} color="#94A3B8" />
                          <span style={{ fontSize: 12, color: '#64748B' }}>
                            {data?.reprintWindowMessage}
                          </span>
                        </div>
                      )}

                      {booking.last_printed_at && (
                        <div
                          style={{
                            textAlign: 'center',
                            marginTop: 10,
                            fontSize: 11,
                            color: '#94A3B8',
                          }}
                        >
                          Last printed:{' '}
                          {new Date(booking.last_printed_at).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Kolkata',
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Token not yet assigned */}
                  {!booking.token_number && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div
                        style={{
                          background: '#FFF7ED',
                          border: '1.5px solid #FED7AA',
                          borderRadius: 12,
                          padding: '14px 16px',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                        }}
                      >
                        <Clock size={16} color="#F97316" style={{ marginTop: 1 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#7C2D12' }}>
                            Token pending
                          </div>
                          <div style={{ fontSize: 11, color: '#C2410C', marginTop: 2 }}>
                            Token will be generated at print time. Reprint unlocks after a token
                            number exists.
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled
                        style={{
                          width: '100%',
                          padding: '14px',
                          background: '#E2E8F0',
                          color: '#64748B',
                          border: 'none',
                          borderRadius: 14,
                          fontSize: 14,
                          fontWeight: 700,
                          cursor: 'not-allowed',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                        }}
                      >
                        <Printer size={16} /> Reprint Ticket
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Refresh button */}
              <button
                onClick={load}
                style={{
                  width: '100%',
                  marginTop: 12,
                  padding: '10px',
                  background: 'transparent',
                  border: '1.5px solid #E2E8F0',
                  borderRadius: 12,
                  fontSize: 12,
                  color: '#64748B',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <RefreshCw size={13} /> Refresh
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
