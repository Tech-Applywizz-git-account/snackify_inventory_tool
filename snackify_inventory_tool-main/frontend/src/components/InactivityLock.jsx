import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Lock, ShieldCheck, Unlock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

export default function InactivityLock({ children }) {
  // Pull name and profile directly — no prop threading needed
  const { profile } = useAuth();
  const userName = profile?.preferred_name || profile?.full_name;

  // 'idle' | 'locked' | 'verify'
  const [step, setStep] = useState('idle');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const transactionIdRef = useRef(null);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  const locked = step === 'locked' || step === 'verify';

  // ── Inactivity timer ─────────────────────────────────────────────────────
  const resetTimer = useCallback(() => {
    if (locked) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStep('locked'), INACTIVITY_TIMEOUT);
  }, [locked]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    for (const e of events) window.addEventListener(e, resetTimer, { passive: true });
    resetTimer();
    return () => {
      for (const e of events) window.removeEventListener(e, resetTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  // Focus the TOTP input the moment the verify step appears
  useEffect(() => {
    if (step === 'verify') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step]);

  // ── "Tap to Unlock" — create backend reauth transaction ──────────────────
  async function handleUnlockClick() {
    setError('');
    setLoading(true);

    try {
      const data = await api.startReauth();
      transactionIdRef.current = data.transactionId;
      setStep('verify');
    } catch (err) {
      setError('Could not start verification. Try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Submit 6-digit code ──────────────────────────────────────────────────
  async function handleVerify() {
    if (totpCode.length !== 6) {
      setError('Enter all 6 digits.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const data = await api.verifyReauth(transactionIdRef.current, totpCode);
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessionErr) throw sessionErr;

      doUnlock();
    } catch (err) {
      setError(err.message || 'Could not verify code. Try again.');
      setTotpCode('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  function doUnlock() {
    setStep('idle');
    setTotpCode('');
    setError('');
    transactionIdRef.current = null;
    resetTimer();
  }

  // Allow Enter key to submit
  function handleKeyDown(e) {
    if (e.key === 'Enter') handleVerify();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {children}

      <AnimatePresence>
        {locked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-slate-900/95 backdrop-blur-md flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="text-center space-y-6 px-8 w-full max-w-sm"
            >
              {/* Icon */}
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {step === 'verify' ? (
                  <ShieldCheck className="mx-auto text-brand" size={64} />
                ) : (
                  <Lock className="mx-auto text-white/80" size={64} />
                )}
              </motion.div>

              {/* ── LOCKED step ── */}
              {step === 'locked' && (
                <>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Screen Locked</h2>
                    <p className="text-white/60 mt-2 text-sm">
                      {userName ? `Hey ${userName}, you` : 'You'} were away for 15 minutes.
                    </p>
                  </div>

                  <button
                    onClick={handleUnlockClick}
                    disabled={loading}
                    className="bg-brand hover:bg-brand/90 disabled:opacity-50 text-white font-bold py-4 px-10 rounded-2xl text-base flex items-center gap-2 mx-auto transition-all active:scale-95 shadow-lg shadow-brand/30"
                  >
                    {loading ? (
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Unlock size={18} />
                    )}
                    {loading ? 'Starting…' : 'Tap to Unlock'}
                  </button>

                  <p className="text-white/30 text-[10px]">
                    Your session is still active. No need to re-login.
                  </p>
                </>
              )}

              {/* ── VERIFY step ── */}
              {step === 'verify' && (
                <>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Enter Your Code</h2>
                    <p className="text-white/60 mt-2 text-sm">
                      Open Microsoft Authenticator and enter the 6-digit code.
                    </p>
                  </div>

                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setTotpCode(val);
                      setError('');
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="000000"
                    className="w-full max-w-[15rem] mx-auto block text-center text-3xl font-mono tracking-[0.25em] bg-white/10 border border-white/20 text-white rounded-xl py-3 px-4 outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 placeholder:text-white/20"
                  />

                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 justify-center text-rose-400 text-sm"
                    >
                      <AlertCircle size={14} /> {error}
                    </motion.div>
                  )}

                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => {
                        setStep('locked');
                        setTotpCode('');
                        setError('');
                      }}
                      className="px-5 py-2.5 rounded-xl text-white/60 hover:text-white text-sm transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleVerify}
                      disabled={loading || totpCode.length !== 6}
                      className="bg-brand hover:bg-brand/90 disabled:opacity-40 text-white font-bold py-2.5 px-8 rounded-xl text-sm flex items-center gap-2 transition-all active:scale-95"
                    >
                      {loading ? (
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      {loading ? 'Verifying…' : 'Verify'}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
