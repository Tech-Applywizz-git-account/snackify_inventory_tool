import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { exitImpersonation } from '../lib/impersonation.js';

export default function ImpersonationBanner() {
  const { profile, isImpersonating, impersonationAdmin } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (!isImpersonating) return null;

  const viewedAsName = profile?.preferred_name || profile?.full_name || profile?.email || 'user';
  const adminLabel =
    impersonationAdmin?.preferred_name ||
    impersonationAdmin?.full_name ||
    impersonationAdmin?.email ||
    'admin';

  async function handleExit() {
    if (busy) return;
    setBusy(true);
    try {
      await exitImpersonation();
      navigate('/admin', { replace: true });
    } catch {
      navigate('/login', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-40 bg-amber-500 text-amber-950 border-b border-amber-600/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-medium">
          Viewing as {viewedAsName}
          <span className="font-normal opacity-80"> · signed in as {adminLabel}</span>
        </p>
        <button
          type="button"
          className="rounded-md bg-amber-950/90 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-950 disabled:opacity-60"
          disabled={busy}
          onClick={handleExit}
        >
          {busy ? 'Exiting…' : 'Exit user view'}
        </button>
      </div>
    </div>
  );
}
