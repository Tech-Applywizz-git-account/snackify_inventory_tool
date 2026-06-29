import { useEffect, useState } from 'react';

/**
 * Shows a friendly "backend is waking up" message if loading takes > 4 seconds.
 * Render free tier sleeps after 15 min inactivity and takes 30-60s to wake.
 *
 * Usage:
 *   <WakingUp loading={!data && !err} />
 */
export default function WakingUp({ loading }) {
  const [slow, setSlow] = useState(false);
  const [dots, setDots] = useState('');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      setElapsed(0);
      return;
    }

    // After 4 seconds, show the waking-up banner
    const slowTimer = setTimeout(() => setSlow(true), 4000);

    // Animated dots
    const dotInterval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : `${d}.`));
    }, 500);

    // Elapsed seconds counter
    const countInterval = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);

    return () => {
      clearTimeout(slowTimer);
      clearInterval(dotInterval);
      clearInterval(countInterval);
    };
  }, [loading]);

  if (!loading || !slow) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md">
      <div className="bg-slate-900 text-white rounded-2xl px-5 py-4 shadow-2xl flex items-start gap-4">
        {/* Spinner */}
        <div className="shrink-0 mt-0.5">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>

        <div className="min-w-0">
          <div className="font-semibold text-sm">Backend is waking up{dots}</div>
          <div className="text-xs text-slate-400 mt-1 leading-relaxed">
            The server goes to sleep after 15 min of no activity. First load takes{' '}
            <strong className="text-white">30–60 seconds</strong>. Please wait.
          </div>
          {elapsed > 10 && (
            <div className="text-xs text-slate-500 mt-1">{elapsed}s elapsed — almost there…</div>
          )}
        </div>
      </div>
    </div>
  );
}
