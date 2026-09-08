import { AnimatePresence, motion } from 'framer-motion';
import { Check, FileText, Lock, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import SnackCoin from './SnackCoin.jsx';

const COPY = {
  order: {
    kicker: 'Payment Checkout',
    payWith: 'Snackify Wallet',
    processing: 'Processing...',
    verifyA: 'Verifying Payment',
    verifyB: 'Secure Connection',
    success: 'Payment Successful',
    confirmed: 'Order Confirmed',
    thanks: 'Thank you for your purchase!',
    cta: 'View Order Details',
  },
  booking: {
    kicker: 'Lunch Booking',
    payWith: 'Snackify Wallet',
    processing: 'Processing...',
    verifyA: 'Verifying Payment',
    verifyB: 'Secure Connection',
    success: 'Booking Successful',
    confirmed: 'Lunch Confirmed',
    thanks: 'Your printed token is ready after pantry confirms.',
    cta: 'View meal token',
  },
};

function play(src) {
  try {
    const a = new Audio(src);
    a.volume = 1;
    a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

function formatCoins(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

export default function CheckoutSuccess({
  open,
  status,
  amount = 0,
  variant = 'order',
  error = '',
  onDone,
  onFailClose,
}) {
  const copy = COPY[variant] || COPY.order;
  const [phase, setPhase] = useState('processing');
  const [pct, setPct] = useState(0);
  const startedAt = useRef(0);
  const successPlayed = useRef(false);
  const doneTimer = useRef(null);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    if (doneTimer.current) clearTimeout(doneTimer.current);
    onDoneRef.current?.();
  };

  useEffect(() => {
    if (!open) {
      setPhase('processing');
      setPct(0);
      successPlayed.current = false;
      if (doneTimer.current) clearTimeout(doneTimer.current);
      return undefined;
    }
    startedAt.current = Date.now();
    finished.current = false;
    setPhase('processing');
    setPct(0);
    play('/sfx/pay-whoosh.mp3');
    const t = setTimeout(() => setPhase('verifying'), 480);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || phase !== 'verifying' || status === 'fail') return undefined;
    const id = setInterval(() => {
      setPct((p) => {
        if (status === 'ok') return p;
        if (p >= 88) return 88;
        return Math.min(88, p + 1.6);
      });
    }, 50);
    return () => clearInterval(id);
  }, [open, phase, status]);

  useEffect(() => {
    if (!open || status !== 'ok' || phase === 'success') return undefined;
    const wait = Math.max(0, 2800 - (Date.now() - startedAt.current));
    const t = setTimeout(() => {
      setPct(100);
      setPhase('success');
    }, wait + 280);
    return () => clearTimeout(t);
  }, [open, status, phase]);

  useEffect(() => {
    if (!open || status !== 'fail') return;
    setPhase('fail');
  }, [open, status]);

  useEffect(() => {
    if (phase !== 'success') return undefined;
    if (!successPlayed.current) {
      successPlayed.current = true;
      play('/sfx/pay-success.mp3');
    }
    doneTimer.current = setTimeout(() => finish(), 2600);
    return () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, [phase]);

  const coins = formatCoins(amount);
  const verifyLabel = pct < 56 ? copy.verifyA : copy.verifyB;
  const ring = pct >= 80 ? '#00C853' : '#2EE6FF';
  const c = 2 * Math.PI * 58;

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] bg-black flex flex-col items-center justify-center px-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="text-white text-lg font-semibold mb-3">{copy.kicker}</div>
        <div className="w-full max-w-[400px] min-h-[520px] rounded-[28px] bg-[#14141A] px-6 py-8 relative overflow-hidden flex flex-col items-center justify-center">
          {(phase === 'processing' || phase === 'verifying' || phase === 'success') && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="absolute rounded-full border"
                  style={{
                    width: 160,
                    height: 160,
                    borderColor: phase === 'success' ? 'rgba(0,200,83,0.45)' : 'rgba(124,92,255,0.45)',
                    animation: `snackRipple 1.8s ${i * 0.32}s ease-out infinite`,
                  }}
                />
              ))}
            </div>
          )}

          {phase === 'processing' && (
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-[52px] h-[52px] rounded-[14px] bg-[#7C5CFF] flex items-center justify-center mb-4">
                <Lock size={20} color="#fff" />
              </div>
              <div className="h-12 px-7 rounded-[14px] bg-[#7C5CFF] text-white font-semibold flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {copy.processing}
              </div>
              <div className="flex items-center gap-2.5 mt-7">
                <SnackCoin size={28} />
                <span className="text-white text-4xl font-bold">{coins}</span>
              </div>
              <div className="text-slate-400 text-sm mt-2">{copy.payWith}</div>
            </div>
          )}

          {phase === 'verifying' && (
            <div className="relative z-10 flex flex-col items-center">
              <div className="relative w-[140px] h-[140px]">
                <svg width="140" height="140" className="-rotate-90">
                  <circle cx="70" cy="70" r="58" stroke="rgba(255,255,255,0.08)" strokeWidth="3" fill="none" />
                  <circle
                    cx="70"
                    cy="70"
                    r="58"
                    stroke={ring}
                    strokeWidth="3.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={c * (1 - pct / 100)}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-[13px] bg-[#7C5CFF] flex items-center justify-center">
                    <Lock size={18} color="#fff" />
                  </div>
                </div>
              </div>
              <div className="text-violet-300 text-sm mt-4">{verifyLabel}</div>
              <div className="text-white text-3xl font-bold mt-1">{Math.round(pct)}%</div>
            </div>
          )}

          {phase === 'success' && (
            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="w-[118px] h-[118px] rounded-full border-2 border-emerald-400/40 flex items-center justify-center">
                <motion.div
                  initial={{ scale: 0.2 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                  className="w-[88px] h-[88px] rounded-full bg-[#00C853] flex items-center justify-center"
                >
                  <Check size={44} color="#fff" strokeWidth={3} />
                </motion.div>
              </div>
              <div className="text-white text-xl font-semibold mt-5">{copy.success}</div>
              <div className="flex items-center gap-2.5 mt-2">
                <SnackCoin size={34} />
                <span className="text-[#00C853] text-[42px] font-bold leading-none">{coins}</span>
              </div>
              <div className="text-white font-medium mt-2.5">{copy.confirmed}</div>
              <div className="text-slate-400 text-sm mt-1.5 px-3">{copy.thanks}</div>
              <button
                type="button"
                onClick={finish}
                className="mt-7 h-12 px-4 rounded-[14px] border border-white/20 text-white font-semibold text-sm inline-flex items-center gap-2"
              >
                <FileText size={16} />
                {copy.cta}
              </button>
            </div>
          )}

          {phase === 'fail' && (
            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="w-[88px] h-[88px] rounded-full bg-rose-600 flex items-center justify-center">
                <X size={40} color="#fff" />
              </div>
              <div className="text-white text-xl font-semibold mt-5">Payment failed</div>
              <div className="text-slate-400 text-sm mt-2">{error || 'Try again'}</div>
              <button
                type="button"
                onClick={onFailClose}
                className="mt-6 h-12 px-5 rounded-[14px] border border-white/20 text-white font-semibold text-sm"
              >
                Close
              </button>
            </div>
          )}
        </div>
        <style>{`
          @keyframes snackRipple {
            0% { transform: scale(0.42); opacity: 0.55; }
            100% { transform: scale(2.35); opacity: 0; }
          }
        `}</style>
      </motion.div>
    </AnimatePresence>
  );
}
