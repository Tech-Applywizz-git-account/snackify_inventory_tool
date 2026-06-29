import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

const ALLOWED_DOMAIN = 'applywizz.ai';

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, delay, ease: 'easeOut' } },
});

const FEATURES = [
  {
    icon: '⚡',
    title: '5-sec ordering',
    desc: 'One tap. Confirmed. On its way.',
    accent: '#2C76FF',
  },
  {
    icon: '📍',
    title: 'Live tracking',
    desc: 'Watch your order move in real time.',
    accent: '#29FE29',
  },
  {
    icon: '🍱',
    title: 'Meal booking',
    desc: 'Book veg or non-veg lunch ahead.',
    accent: '#2C76FF',
  },
  {
    icon: '🤖',
    title: 'AI reminders',
    desc: "Nudged by AI when it's chai time.",
    accent: '#29FE29',
  },
];

const STATS = [
  { value: '🚀', label: 'Desk delivery', color: '#2C76FF' },
  { value: '🏃', label: 'Self pickup', color: '#29FE29' },
  { value: '✌️', label: 'Zero queue', color: '#ffffff' },
];

export default function Login() {
  const navigate = useNavigate();

  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [enrollmentTransactionId, setEnrollmentTransactionId] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const submitting = useRef(false);

  async function submitEmail(e) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setErr('');
    const trimmed = email.trim().toLowerCase();

    if (!trimmed.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setErr(`Only @${ALLOWED_DOMAIN} accounts are allowed.`);
      submitting.current = false;
      return;
    }

    setEmail(trimmed);
    setBusy(true);

    try {
      const data = await api.startLogin(trimmed);
      if (data.nextStep === 'authenticator') {
        setTransactionId(data.transactionId);
        setTotpCode('');
        setStep('verify');
      } else {
        await api.startEnrollment(trimmed);
        setOtpCode('');
        setStep('otp');
      }
    } catch (ex) {
      setErr(`Something went wrong: ${ex.message || ex}`);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function submitOtp(e) {
    e.preventDefault();
    setErr('');
    if (otpCode.length !== 6) {
      setErr('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    try {
      const data = await api.verifyEnrollmentOtp(email, otpCode);
      setEnrollmentTransactionId(data.enrollmentTransactionId);
      setQrCode(data.qrCode);
      setTotpCode('');
      setStep('enroll');
    } catch (ex) {
      setErr(ex.message || 'Could not verify code.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setErr('');

    if (totpCode.length !== 6) {
      setErr('Enter the 6-digit code from Microsoft Authenticator.');
      return;
    }

    setBusy(true);

    try {
      const data =
        step === 'enroll'
          ? await api.verifyTotpEnrollment(enrollmentTransactionId, totpCode)
          : await api.verifyTotpLogin(transactionId, totpCode);

      const { error: sessionErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (sessionErr) {
        setErr(`Could not finish sign-in: ${sessionErr.message}`);
        setBusy(false);
        return;
      }
      setStep('done');
      navigate('/', { replace: true });
    } catch (ex) {
      setErr(ex.message || 'Verification failed.');
      setTotpCode('');
      setBusy(false);
    }
  }

  function resetToEmail() {
    setStep('email');
    setErr('');
    setOtpCode('');
    setTotpCode('');
    setQrCode('');
    setTransactionId('');
    setEnrollmentTransactionId('');
    submitting.current = false;
  }

  // ── RENDER ──────────────────────────────────────────────────
  return (
    <div
      className="min-h-[100dvh] flex flex-col relative overflow-hidden"
      style={{
        fontFamily: "'Noto Sans', 'Inter', system-ui, sans-serif",
        background: 'linear-gradient(160deg, #0d1117 0%, #0a0e18 60%, #080c14 100%)',
      }}
    >
      {/* ── Subtle brand-colored ambient glows ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-60 -left-60 w-[700px] h-[700px] rounded-full opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #2C76FF, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-60 -right-40 w-[600px] h-[600px] rounded-full opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #29FE29, transparent 70%)' }}
        />
      </div>

      {/* ── Header — real logo, no text duplication ── */}
      <motion.header
        className="relative z-10 px-5 sm:px-10 lg:px-16 py-4 flex items-center justify-between shrink-0"
        {...fade(0)}
      >
        {/* Logo image only — no text beside it, logo already has APPLY WIZZ in it */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 flex items-center gap-2">
          <img src="/logo-icon.png" alt="ApplyWizz" className="h-7 object-contain" />
          <span
            className="text-white font-black text-xs tracking-widest hidden sm:block"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            APPLY WIZZ
          </span>
        </div>

        <div
          className="flex items-center gap-2 border px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(41,254,41,0.05)', borderColor: 'rgba(41,254,41,0.15)' }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: '#29FE29' }}
          />
          <span className="text-[11px] font-medium" style={{ color: 'rgba(41,254,41,0.7)' }}>
            Pantry Online
          </span>
        </div>
      </motion.header>

      {/* ── Main ── */}
      <main className="relative z-10 flex-1 flex items-center">
        <div className="w-full max-w-7xl mx-auto px-5 sm:px-10 lg:px-16 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* ── LEFT — Logo hero + content ── */}
            <div className="order-2 lg:order-1">
              {/* Logo hero card — the star of the show */}
              <motion.div {...fade(0.1)} className="mb-8">
                <div className="inline-flex items-center">
                  <img src="/logo-icon.png" alt="ApplyWizz" className="h-14 object-contain" />
                  <span
                    className="text-white font-black text-xl tracking-widest ml-3"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    APPLY WIZZ
                  </span>
                </div>
              </motion.div>

              {/* Headline */}
              <motion.h1
                {...fade(0.2)}
                className="text-4xl sm:text-5xl font-extrabold text-white leading-[1.08] tracking-tight mb-4"
              >
                Skip the queue.
                <br />
                Not the{' '}
                <span
                  style={{
                    color: '#29FE29',
                    fontFamily: "'Playfair Display', serif",
                    fontStyle: 'italic',
                  }}
                >
                  snack.
                </span>
              </motion.h1>

              <motion.p
                {...fade(0.3)}
                className="text-white/40 text-sm sm:text-base leading-relaxed mb-8 max-w-md"
              >
                Order to your desk or walk in and skip the queue — your call, zero crowd.
              </motion.p>

              {/* Stats row */}
              <motion.div
                {...fade(0.35)}
                className="flex items-center gap-px rounded-2xl overflow-hidden border mb-8"
                style={{
                  borderColor: 'rgba(255,255,255,0.07)',
                  background: 'rgba(255,255,255,0.025)',
                }}
              >
                {STATS.map(({ value, label, color }, i) => (
                  <div
                    key={label}
                    className="flex-1 text-center py-4 px-3"
                    style={{
                      borderRight:
                        i < STATS.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}
                  >
                    <p
                      className="text-lg sm:text-xl font-extrabold"
                      style={{ color, fontFamily: "'Space Grotesk', sans-serif" }}
                    >
                      {value}
                    </p>
                    <p className="text-[10px] text-white/60 uppercase tracking-wider mt-1">
                      {label}
                    </p>
                  </div>
                ))}
              </motion.div>

              {/* Feature cards — blue/green alternating matching logo */}
              <div className="grid grid-cols-2 gap-3">
                {FEATURES.map(({ icon, title, desc, accent }, i) => (
                  <motion.div
                    key={title}
                    {...fade(0.4 + i * 0.07)}
                    className="rounded-2xl p-4 border transition-all duration-300 hover:scale-[1.02]"
                    style={{
                      background: `${accent}08`,
                      borderColor: `${accent}20`,
                    }}
                  >
                    <span className="text-xl block mb-2">{icon}</span>
                    <p
                      className="text-white/80 text-xs font-bold mb-1"
                      style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                    >
                      {title}
                    </p>
                    <p className="text-white/30 text-[11px] leading-relaxed">{desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* ── RIGHT — Login form ── */}
            <div className="order-1 lg:order-2 flex justify-center lg:justify-end">
              <div className="w-full max-w-[390px]">
                {/* Logo above form — prominent placement */}
                <motion.div {...fade(0.15)} className="flex justify-center mb-5">
                  <div
                    className="flex items-center gap-3 px-5 py-3 rounded-2xl border"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      borderColor: 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="flex items-center gap-2 justify-center">
                      <img src="/logo-icon.png" alt="ApplyWizz" className="h-8 object-contain" />
                      <span
                        className="text-white font-black text-sm tracking-widest"
                        style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                      >
                        APPLY WIZZ
                      </span>
                    </div>
                  </div>
                </motion.div>

                {/* Auth card */}
                <motion.div
                  {...fade(0.25)}
                  className="rounded-3xl border p-6 sm:p-7"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: 'rgba(255,255,255,0.08)',
                  }}
                >
                  <AnimatePresence mode="wait">
                    {/* ═══ STEP: Email ═══ */}
                    {step === 'email' && (
                      <motion.div
                        key="email"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                        className="space-y-5"
                      >
                        <div>
                          <h2
                            className="text-white text-lg font-bold mb-1"
                            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                          >
                            Sign in to Pantry
                          </h2>
                          <p className="text-white/30 text-sm">Use your @applywizz.ai work email</p>
                        </div>

                        <form onSubmit={submitEmail} className="space-y-3">
                          <div>
                            <label
                              className="block text-[11px] font-semibold text-white/20 uppercase tracking-widest mb-2"
                              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                            >
                              Work email
                            </label>
                            <input
                              type="email"
                              required
                              autoComplete="email"
                              placeholder={`you@${ALLOWED_DOMAIN}`}
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="w-full rounded-2xl px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none transition-all"
                              style={{
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                              }}
                              onFocus={(e) => (e.target.style.borderColor = 'rgba(44,118,255,0.5)')}
                              onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
                            />
                          </div>

                          {err && <Msg text={err} />}

                          {/* Gradient button matching logo colors */}
                          <button
                            type="submit"
                            disabled={busy}
                            className="w-full text-white text-sm font-bold py-3.5 rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
                            style={{
                              background: busy
                                ? 'rgba(255,255,255,0.1)'
                                : 'linear-gradient(90deg, #2C76FF, #29FE29)',
                              fontFamily: "'Space Grotesk', sans-serif",
                            }}
                          >
                            {busy && <Spinner />}
                            {busy ? 'Checking…' : 'Continue →'}
                          </button>
                        </form>

                        <p className="text-[11px] text-white/15 text-center">
                          Secured with Microsoft Authenticator (MFA)
                        </p>

                        <div className="pt-2 border-t border-white/[0.05]">
                          <div className="flex items-center justify-center gap-4">
                            {['🔐 MFA secured', '☁️ Supabase', '🏢 Internal only'].map((label) => (
                              <span key={label} className="text-[10px] text-white/15">
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* ═══ STEP: OTP ═══ */}
                    {step === 'otp' && (
                      <motion.div
                        key="otp"
                        className="space-y-4"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                      >
                        <div
                          className="w-14 h-14 mx-auto rounded-2xl grid place-items-center text-2xl"
                          style={{
                            background: 'rgba(44,118,255,0.1)',
                            border: '1px solid rgba(44,118,255,0.2)',
                          }}
                        >
                          ✉️
                        </div>
                        <div className="text-center">
                          <h2 className="text-xl font-bold text-white mb-1">Check your email</h2>
                          <p className="text-sm text-white/40 leading-relaxed">
                            Enter the 6-digit code sent to
                            <br />
                            <strong style={{ color: '#29FE29' }}>{email}</strong>
                          </p>
                        </div>

                        <form onSubmit={submitOtp} className="space-y-3">
                          <CodeInput value={otpCode} onChange={setOtpCode} />
                          {err && <Msg text={err} />}
                          <GradientBtn busy={busy}>{busy ? 'Verifying…' : 'Verify email →'}</GradientBtn>
                        </form>
                        <BackBtn onClick={resetToEmail} />
                      </motion.div>
                    )}

                    {/* ═══ STEP: Enroll ═══ */}
                    {step === 'enroll' && (
                      <motion.div
                        key="enroll"
                        className="space-y-4"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                      >
                        <div
                          className="w-14 h-14 mx-auto rounded-2xl grid place-items-center text-2xl"
                          style={{
                            background: 'rgba(44,118,255,0.1)',
                            border: '1px solid rgba(44,118,255,0.2)',
                          }}
                        >
                          📱
                        </div>
                        <div className="text-center">
                          <h2 className="text-xl font-bold text-white mb-1">
                            Set up Authenticator
                          </h2>
                          <p className="text-sm text-white/40 leading-relaxed">
                            Open <strong className="text-white/70">Microsoft Authenticator</strong>{' '}
                            → tap <strong className="text-white/70">+</strong> → scan this QR
                          </p>
                        </div>

                        {qrCode && (
                          <div className="flex justify-center py-2">
                            <div className="bg-white rounded-2xl p-4 shadow-xl shadow-black/30">
                              <img
                                src={qrCode}
                                alt="QR Code"
                                className="w-44 h-44 sm:w-48 sm:h-48"
                              />
                            </div>
                          </div>
                        )}

                        <form onSubmit={submitCode} className="space-y-3">
                          <label
                            className="block text-[11px] font-semibold text-white/20 uppercase tracking-widest mb-1"
                            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                          >
                            Enter the 6-digit code from Microsoft Authenticator
                          </label>
                          <CodeInput value={totpCode} onChange={setTotpCode} />
                          {err && <Msg text={err} />}
                          <GradientBtn busy={busy}>
                            {busy ? 'Verifying…' : 'Verify & Continue →'}
                          </GradientBtn>
                        </form>
                        <BackBtn onClick={resetToEmail} />
                      </motion.div>
                    )}

                    {/* ═══ STEP: Verify ═══ */}
                    {step === 'verify' && (
                      <motion.div
                        key="verify"
                        className="space-y-4"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                      >
                        <div
                          className="w-14 h-14 mx-auto rounded-2xl grid place-items-center text-2xl"
                          style={{
                            background: 'rgba(41,254,41,0.08)',
                            border: '1px solid rgba(41,254,41,0.18)',
                          }}
                        >
                          🔐
                        </div>
                        <div className="text-center">
                          <h2 className="text-xl font-bold text-white mb-1">Welcome back</h2>
                          <p className="text-sm text-white/40 leading-relaxed">
                            Enter the 6-digit code from{' '}
                            <strong className="text-white/70">Microsoft Authenticator</strong>
                            <br />
                            for <strong style={{ color: '#29FE29' }}>{email}</strong>
                          </p>
                        </div>

                        <form onSubmit={submitCode} className="space-y-3">
                          <CodeInput value={totpCode} onChange={setTotpCode} />
                          {err && <Msg text={err} />}
                          <GradientBtn busy={busy}>{busy ? 'Verifying…' : 'Sign in →'}</GradientBtn>
                        </form>
                        <BackBtn onClick={resetToEmail} />
                      </motion.div>
                    )}

                    {/* ═══ STEP: Done ═══ */}
                    {step === 'done' && (
                      <motion.div
                        key="done"
                        className="text-center space-y-3 py-8"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        <div
                          className="w-12 h-12 mx-auto rounded-full border-2 border-t-transparent animate-spin"
                          style={{ borderColor: '#2C76FF', borderTopColor: 'transparent' }}
                        />
                        <p className="text-sm text-white/40">Signing you in…</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

                <motion.p {...fade(0.6)} className="text-center text-[11px] text-white/10 mt-4">
                  Built with ❤️ for the people who build ApplyWizz
                </motion.p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ═══ Shared sub-components ═══ */

function CodeInput({ value, onChange }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={6}
      required
      autoComplete="one-time-code"
      placeholder="000000"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className="w-full max-w-[15rem] mx-auto block rounded-2xl px-4 py-3.5 text-center text-2xl tracking-[0.25em] font-mono text-white placeholder-white/15 focus:outline-none transition-all"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
    />
  );
}

function GradientBtn({ busy, children }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full text-white text-sm font-bold py-3.5 rounded-2xl transition-all active:scale-[0.97] disabled:opacity-50 flex items-center justify-center gap-2"
      style={{
        background: busy ? 'rgba(255,255,255,0.1)' : 'linear-gradient(90deg, #2C76FF, #29FE29)',
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
  );
}

function BackBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-xs text-white/20 hover:text-white/50 transition-colors mt-1 text-center"
    >
      ← Use a different email
    </button>
  );
}

function Msg({ text }) {
  const ok = text.startsWith('✅');
  return (
    <div
      className={`text-xs px-4 py-2.5 rounded-xl border leading-relaxed ${
        ok
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
      }`}
    >
      {text}
    </div>
  );
}
