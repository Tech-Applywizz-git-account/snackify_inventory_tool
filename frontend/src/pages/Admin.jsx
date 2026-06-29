import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

// DB value : display label
const ROLE_OPTIONS = [
  { value: 'leadership', label: 'Admin' },
  { value: 'facility_manager', label: 'Facility Manager' },
  { value: 'office_boy', label: 'Office Boy' },
  { value: 'finance', label: 'Accounts' },
  { value: 'staff', label: 'Applywizzian' },
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

function RolePill({ role }) {
  const cls =
    {
      leadership: 'bg-violet-100 text-violet-800',
      facility_manager: 'bg-emerald-100 text-emerald-800',
      office_boy: 'bg-amber-100 text-amber-800',
      finance: 'bg-blue-100 text-blue-800',
      staff: 'bg-slate-100 text-slate-700',
    }[role] || 'bg-slate-100 text-slate-700';
  return <span className={`pill ${cls}`}>{ROLE_LABEL[role] || role}</span>;
}

// ── Predictive ordering (Feature #9) ─────────────────────────────────────────
// Shows the latest weekly forecast per product (from v_latest_forecasts).
// "history" basis = predicted from real transaction history; "daily_usage_fallback"
// = estimated from the static daily_usage because there isn't enough history yet.
function BasisBadge({ basis }) {
  const isHistory = basis === 'history';
  const cls = isHistory ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800';
  const label = isHistory ? 'history' : 'estimate';
  return <span className={`pill ${cls}`}>{label}</span>;
}

function ForecastPanel() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(false);
  const [okMsg, setOkMsg] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      setRows(await api.forecasts());
    } catch (e) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function onRun() {
    setRunning(true);
    setErr('');
    setOkMsg('');
    try {
      const { upserted } = await api.runForecast();
      setOkMsg(`✅ Forecast refreshed — ${upserted} product(s) updated.`);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="font-semibold">🔮 Predictive ordering</h2>
        <button className="btn-primary" disabled={running} onClick={onRun}>
          {running ? 'Running…' : 'Run forecast now'}
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Next week's predicted need per item, from recent transaction history. Suggested order =
        predicted need − current stock. Advisory only.
      </p>

      {okMsg && (
        <div className="text-sm text-emerald-700 bg-emerald-50 p-3 rounded-md mb-3">{okMsg}</div>
      )}
      {err && <div className="text-sm text-rose-700 bg-rose-50 p-3 rounded-md mb-3">{err}</div>}

      {!rows ? (
        <div className="text-slate-500 text-sm">Loading forecasts…</div>
      ) : rows.length === 0 ? (
        <div className="text-slate-500 text-sm">
          No forecasts yet. Click “Run forecast now”, or wait for the Monday job.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3 text-right">Avg/week</th>
                <th className="py-2 pr-3 text-right">Predicted next</th>
                <th className="py-2 pr-3 text-right">In stock</th>
                <th className="py-2 pr-3 text-right">Suggested order</th>
                <th className="py-2 pr-3">Based on</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium text-slate-900">{r.product_name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.avg_weekly} {r.unit || ''}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.predicted_next} {r.unit || ''}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-500">
                    {r.current_stock ?? '-'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold">
                    {Number(r.suggested_order) > 0 ? (
                      <span className="text-brand">
                        {r.suggested_order} {r.unit || ''}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <BasisBadge basis={r.basis} />
                    <span className="ml-2 text-xs text-slate-400">{r.weeks_of_data}w data</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const { profile } = useAuth();
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviteName, setInviteName] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      setUsers(await api.listUsers());
    } catch (e) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function onChangeRole(userId, role) {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      await api.setUserRole(userId, role);
      setOkMsg('Role updated.');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onChangePreferredName(user, value) {
    const preferredName = value.trim();
    if (preferredName === (user.preferred_name || '')) return;

    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      await api.setUserPreferredName(user.id, preferredName || null);
      setOkMsg(`Preferred name updated for ${user.full_name || user.email || 'user'}.`);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onInvite(e) {
    e.preventDefault();
    if (!inviteName.trim()) {
      setErr('Full name is required.');
      return;
    }
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      await api.createUser({
        email: inviteEmail.trim(),
        role: inviteRole,
        full_name: inviteName.trim(),
      });
      setOkMsg(
        `✅ ${inviteName} added! They can log in with "${inviteEmail}" + Microsoft Authenticator.`
      );
      setInviteEmail('');
      setInviteName('');
      setInviteRole('staff');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onResetAuthenticator() {
    if (!resetTarget) return;

    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const result = await api.resetAuthenticator(resetTarget.id);
      setOkMsg(
        `Authenticator reset for ${result.email || resetTarget.email || resetTarget.full_name || 'user'}. They will verify email OTP and scan a new QR on next login.`
      );
      setResetTarget(null);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !users) return <div className="text-rose-600">{err}</div>;
  if (!users) return <div className="text-slate-500">Loading users...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin · Users</h1>
        <p className="text-sm text-slate-500">
          Invite colleagues and assign their access. Leadership only.
        </p>
      </div>

      {okMsg && (
        <div className="text-sm text-emerald-700 bg-emerald-50 p-3 rounded-md">{okMsg}</div>
      )}
      {err && <div className="text-sm text-rose-700 bg-rose-50 p-3 rounded-md">{err}</div>}

      <div className="card">
        <h2 className="font-semibold mb-1">Add a team member</h2>
        <p className="text-xs text-slate-500 mb-4">
          Creates their account instantly. They'll set up Microsoft Authenticator on first login.
        </p>
        <form onSubmit={onInvite} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <input
            type="text"
            required
            placeholder="Full name"
            className="input sm:col-span-3"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
          />
          <input
            type="email"
            required
            placeholder="their@email.com"
            className="input sm:col-span-4"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <select
            className="input sm:col-span-3"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="btn-primary sm:col-span-2" disabled={busy}>
            {busy ? 'Adding…' : '+ Add'}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">Existing users ({users.length})</h2>
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Preferred Name</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Change to</th>
                <th className="py-2 pr-3">Actions</th>
                <th className="py-2 pr-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === profile?.id;
                return (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium text-slate-900">
                      {u.full_name || '-'}
                      {isMe && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        className="input py-1 px-2 text-xs w-28"
                        defaultValue={u.preferred_name || ''}
                        disabled={busy}
                        onBlur={(e) => onChangePreferredName(u, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{u.email || '-'}</td>
                    <td className="py-2 pr-3">
                      <RolePill role={u.role} />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="input py-1 text-xs"
                        value={u.role}
                        disabled={busy || (isMe && u.role === 'leadership')}
                        onChange={(e) => onChangeRole(u.id, e.target.value)}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                          setErr('');
                          setOkMsg('');
                          setResetTarget(u);
                        }}
                      >
                        Reset Authenticator
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-slate-500 text-xs">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {resetTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !busy && setResetTarget(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-slate-900">Reset authenticator?</h3>
              <p className="text-sm text-slate-500">
                {resetTarget.full_name || resetTarget.email || 'This user'} will need to verify
                email OTP and scan a new Microsoft Authenticator QR code on next login.
              </p>
              <p className="text-xs text-slate-400">
                Current user: {resetTarget.email || 'Unknown email'}
              </p>
            </div>
            <div className="flex gap-3">
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
                className="btn-primary flex-1 disabled:opacity-50"
                disabled={busy}
                onClick={onResetAuthenticator}
              >
                {busy ? 'Resetting…' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ForecastPanel />
    </div>
  );
}
