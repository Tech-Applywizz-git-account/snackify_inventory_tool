import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Search, ShieldAlert, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

export default function MfaReset() {
  const [users, setUsers] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [resetTarget, setResetTarget] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const data = await api.listUsers();
      setUsers(data || []);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReset() {
    if (!resetTarget) return;
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const result = await api.resetAuthenticator(resetTarget.id);
      setOkMsg(`✅ Authenticator successfully reset for ${result.email || resetTarget.email}. They will be required to register a new authenticator app upon next sign-in.`);
      setResetTarget(null);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !users) {
    return (
      <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 text-center max-w-md mx-auto my-8">
        <ShieldAlert className="h-12 w-12 text-rose-500 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-rose-950 mb-1">Failed to load users</h3>
        <p className="text-sm text-rose-700 mb-4">{err}</p>
        <button onClick={load} className="btn-primary px-4 py-2">Try Again</button>
      </div>
    );
  }

  if (!users) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-brand mb-2" />
        <span className="text-sm font-medium">Loading user directory...</span>
      </div>
    );
  }

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.preferred_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Authenticator Reset</h1>
        <p className="text-sm text-slate-500 mt-1">
          De-register and reset Microsoft Authenticator for Applywizz team members. Resetting forces users to re-verify and scan a new QR code on their next login.
        </p>
      </div>

      {okMsg && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex gap-3 text-emerald-800">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{okMsg}</div>
        </div>
      )}

      {err && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 flex gap-3 text-rose-800">
          <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{err}</div>
        </div>
      )}

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-6">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search users by name or email..."
            className="input pl-10 w-full"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm divide-y divide-slate-100">
            <thead>
              <tr className="text-left text-slate-500 font-semibold border-b border-slate-100">
                <th className="pb-3 pr-3 font-semibold text-slate-500">Name</th>
                <th className="pb-3 pr-3 font-semibold text-slate-500">Email Address</th>
                <th className="pb-3 pr-3 font-semibold text-slate-500">Role</th>
                <th className="pb-3 text-right font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400">
                    No users found matching "{searchQuery}"
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3.5 pr-3 font-medium text-slate-900">
                      {u.full_name || u.preferred_name || '-'}
                    </td>
                    <td className="py-3.5 pr-3 text-slate-600 font-mono text-xs">{u.email || '-'}</td>
                    <td className="py-3.5 pr-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3.5 text-right">
                      <button
                        type="button"
                        className="btn-secondary text-xs px-3 py-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-100"
                        disabled={busy}
                        onClick={() => {
                          setErr('');
                          setOkMsg('');
                          setResetTarget(u);
                        }}
                      >
                        Reset MFA
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {resetTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => !busy && setResetTarget(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 border border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-3 text-amber-600 bg-amber-50/60 p-3 rounded-2xl border border-amber-100/60">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-amber-900">Warning: Reset Authenticator</h4>
                <p className="text-xs text-amber-800 mt-0.5">
                  This will de-register their existing multi-factor security credentials.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-slate-900">Reset MFA for {resetTarget.full_name || 'this user'}?</h3>
              <p className="text-sm text-slate-500">
                The user will be logged out and forced to verify email OTP and scan a new Microsoft Authenticator QR code on their next login.
              </p>
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 font-mono text-xs text-slate-600">
                Email: {resetTarget.email}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={busy}
                onClick={() => setResetTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-rose-600 hover:bg-rose-700 text-white flex-1"
                disabled={busy}
                onClick={handleReset}
              >
                {busy ? 'Resetting…' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
