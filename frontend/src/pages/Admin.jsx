import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
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

function fuzzyMatch(value, query) {
  let queryIndex = 0;
  for (const character of value.toLowerCase()) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return query.length === 0;
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
  const [reportEmail, setReportEmail] = useState('');
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [unbookedUsers, setUnbookedUsers] = useState(null);
  const [unbookedUsersOpen, setUnbookedUsersOpen] = useState(false);
  const [unbookedUsersLoading, setUnbookedUsersLoading] = useState(false);
  const [lateMealSearch, setLateMealSearch] = useState('');
  const [lateMealSearchQuery, setLateMealSearchQuery] = useState('');
  const [lateMealMatches, setLateMealMatches] = useState([]);
  const [lateMealSelectedUser, setLateMealSelectedUser] = useState(null);
  const [lateMealUserId, setLateMealUserId] = useState('');
  const [lateMealChoice, setLateMealChoice] = useState('veg');

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

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const query = lateMealSearch.trim().toLowerCase();
      setLateMealSearchQuery(query);
      if (!query) {
        setLateMealMatches([]);
        return;
      }

      setLateMealMatches(
        (users || [])
          .filter((user) => {
            const name = user.full_name || '';
            const email = user.email || '';
            return (
              name.toLowerCase().includes(query) ||
              email.toLowerCase().includes(query) ||
              fuzzyMatch(name, query) ||
              fuzzyMatch(email, query)
            );
          })
          .slice(0, 8)
      );
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [lateMealSearch, users]);

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

  async function onChangeCafeteriaCard(user, value) {
    const next = String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 24);
    const current = String(user.cafeteria_card_number || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (next === current) return;
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      await api.setUserCafeteriaCard(user.id, next || null, { source: 'manual' });
      setOkMsg(`Digital cafeteria card updated for ${user.full_name || user.email || 'user'}.`);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onFillCardFromHrms(user) {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      await api.setUserCafeteriaCard(user.id, null, { source: 'hrms' });
      setOkMsg(`Card number filled from HRMS for ${user.full_name || user.email || 'user'}.`);
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

  async function onAddReportSubscriber(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      await api.addConsumerReportSubscriber(reportEmail.trim());
      setOkMsg(`Daily consumption reports will be sent to ${reportEmail.trim()}.`);
      setReportEmail('');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onLateMealBooking(e) {
    e.preventDefault();
    if (!lateMealUserId) {
      setErr('Select a user for the late meal booking.');
      return;
    }
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const result = await api.lateMealBooking({ user_id: lateMealUserId, choice: lateMealChoice });
      const selected = users.find((u) => u.id === lateMealUserId);
      setOkMsg(`Meal booked for ${selected?.full_name || selected?.email || 'user'} and one receipt was queued for immediate printing. Token: ${result.booking.token_number}.`);
      setLateMealUserId('');
      setLateMealSearch('');
      setLateMealSearchQuery('');
      setLateMealMatches([]);
      setLateMealSelectedUser(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function onLateMealSearchChange(value) {
    setLateMealSearch(value);
    if (lateMealSelectedUser) {
      setLateMealSelectedUser(null);
      setLateMealUserId('');
    }
  }

  function onSelectLateMealUser(user) {
    setLateMealSelectedUser(user);
    setLateMealUserId(user.id);
    setLateMealSearch(user.full_name || user.email || '');
    setLateMealSearchQuery('');
    setLateMealMatches([]);
  }

  async function onShowUnbookedUsers() {
    setUnbookedUsersLoading(true);
    setErr('');
    try {
      setUnbookedUsers(await api.listUnbookedUsers());
      setUnbookedUsersOpen(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUnbookedUsersLoading(false);
    }
  }

  function downloadUnbookedUsers() {
    if (!unbookedUsers?.users?.length) return;

    const escapeCsv = (value) => `"${String(value || '').replaceAll('"', '""')}"`;
    const rows = [
      ['S.No.', 'Name', 'Email', 'Date'],
      ...unbookedUsers.users.map((user, index) => [
        index + 1,
        user.preferred_name || user.full_name || '',
        user.email || '',
        unbookedUsers.meal_date,
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `users-not-booked-${unbookedUsers.meal_date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
          Invite colleagues, assign access, and set each person&apos;s cafeteria card number
          (letters and digits, or fill from HRMS by email).
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

      {profile?.role === 'leadership' && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h2 className="font-semibold">Add User / Book Late Meal</h2>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={onShowUnbookedUsers}
              disabled={unbookedUsersLoading}
            >
              {unbookedUsersLoading ? 'Loading…' : 'Show Not Booked Today'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Available after 10:00 AM IST. This creates today&apos;s booking and prints one receipt only for the selected user.
          </p>
          <form onSubmit={onLateMealBooking} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <input
              type="search"
              placeholder="Search by name or email"
              className="input sm:col-span-4"
              value={lateMealSearch}
              onChange={(e) => onLateMealSearchChange(e.target.value)}
            />
            <div className="relative sm:col-span-4">
              <div
                className={`input min-h-[42px] flex items-center ${lateMealSelectedUser ? 'text-slate-900' : 'text-slate-400'}`}
                aria-live="polite"
              >
                {lateMealSelectedUser ? (
                  <span className="truncate">
                    {lateMealSelectedUser.full_name || lateMealSelectedUser.email}
                    {lateMealSelectedUser.email && lateMealSelectedUser.full_name ? ` (${lateMealSelectedUser.email})` : ''}
                  </span>
                ) : (
                  'Select user'
                )}
              </div>
              {lateMealSearchQuery && !lateMealSelectedUser && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                  {lateMealMatches.length > 0 ? (
                    lateMealMatches.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                        onClick={() => onSelectLateMealUser(user)}
                      >
                        <span className="block font-medium text-slate-900">{user.full_name || user.email}</span>
                        {user.email && <span className="block text-xs text-slate-500">{user.email}</span>}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-sm text-slate-500">No matching users found.</div>
                  )}
                </div>
              )}
            </div>
            <select
              className="input sm:col-span-2"
              value={lateMealChoice}
              onChange={(e) => setLateMealChoice(e.target.value)}
            >
              <option value="veg">Vegetarian</option>
              <option value="egg">Egg</option>
              <option value="non_veg">Non-vegetarian</option>
            </select>
            <button type="submit" className="btn-primary sm:col-span-2" disabled={busy}>
              {busy ? 'Booking…' : 'Book & Print'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="font-semibold">Users added for daily reports</h2>
          <button type="button" className="btn-secondary text-sm" onClick={() => setReportModalOpen(true)}>
            View Added Users
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Add an existing user or create a new user account that should receive the daily cafeteria report.
        </p>
        <form onSubmit={onAddReportSubscriber} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            required
            placeholder="admin@example.com"
            className="input flex-1"
            value={reportEmail}
            onChange={(e) => setReportEmail(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add recipient'}
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
                <th className="py-2 pr-3">Cafeteria card</th>
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
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          maxLength={24}
                          placeholder="letters + digits"
                          className="input py-1 px-2 text-xs w-40 font-mono tracking-wide"
                          defaultValue={u.cafeteria_card_number || ''}
                          key={`${u.id}-${u.cafeteria_card_number || 'none'}`}
                          disabled={busy}
                          onBlur={(e) => onChangeCafeteriaCard(u, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                        />
                        <button
                          type="button"
                          className="btn-secondary text-[10px] px-2 py-1 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => onFillCardFromHrms(u)}
                        >
                          HRMS
                        </button>
                      </div>
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

      {reportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setReportModalOpen(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Added Report Users</h3>
                <p className="text-sm text-slate-500 mt-1">Users currently subscribed to receive the daily report.</p>
              </div>
              <button type="button" aria-label="Close added report users" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100" onClick={() => setReportModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Employee code</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.filter((user) => user.consumer_report).map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{user.preferred_name || user.full_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{user.email || '—'}</td>
                      <td className="px-4 py-3 font-mono text-slate-600">{user.employee_code || '—'}</td>
                    </tr>
                  ))}

                </tbody>
              </table>
              {users.filter((user) => user.consumer_report).length === 0 && (
                <div className="p-5 text-center text-sm text-slate-500">No report recipients have been added yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {unbookedUsersOpen && unbookedUsers && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setUnbookedUsersOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-2xl max-h-[85vh] rounded-t-xl sm:rounded-xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 p-4 border-b">
              <div>
                <h2 className="font-semibold">Users who have not booked</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {unbookedUsers.meal_date} · {unbookedUsers.users.length} active user{unbookedUsers.users.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                className="p-2 text-slate-500 hover:text-slate-900"
                aria-label="Close users who have not booked"
                onClick={() => setUnbookedUsersOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[65vh] p-4">
              {unbookedUsers.users.length === 0 ? (
                <p className="text-sm text-slate-500">Everyone has booked a meal for today.</p>
              ) : (
                <div className="divide-y border rounded-md">
                  {unbookedUsers.users.map((user, index) => (
                    <div key={user.id} className="flex items-center gap-3 p-3">
                      <div className="w-8 shrink-0 text-sm font-semibold text-slate-500">{index + 1}</div>
                      <div>
                        <div className="font-medium text-slate-900">
                          {user.preferred_name || user.full_name || user.email || user.id}
                        </div>
                        {user.preferred_name && user.full_name && (
                          <div className="text-xs text-slate-500">{user.full_name}</div>
                        )}
                      </div>
                      {user.email && <div className="text-sm text-slate-500">{user.email}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <button type="button" className="btn-secondary" onClick={() => setUnbookedUsersOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={downloadUnbookedUsers}
                disabled={unbookedUsers.users.length === 0}
              >
                Download CSV
              </button>
            </div>
          </div>
        </div>
      )}

      <ForecastPanel />
    </div>
  );
}
