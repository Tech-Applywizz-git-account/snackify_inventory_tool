import { useCallback, useEffect, useState } from 'react';
import WakingUp from '../components/WakingUp.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../lib/api.js';

/* ── IST helpers ─────────────────────────────────────────────────── */
const IST = { timeZone: 'Asia/Kolkata' };

function getIST() {
  return new Date(new Date().toLocaleString('en-US', IST));
}

function formatTime(d) {
  return d.toLocaleTimeString('en-IN', {
    ...IST,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', {
    ...IST,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/* ── IST Clock strip ─────────────────────────────────────────────── */
function ISTClock() {
  const [now, setNow] = useState(getIST());

  useEffect(() => {
    const id = setInterval(() => setNow(getIST()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-brand/5 to-emerald-50 border-brand/20">
      <div>
        <div className="text-2xl sm:text-3xl font-mono font-bold text-brand tabular-nums">
          {formatTime(now)}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{formatDate(now)} · IST (UTC+5:30)</div>
      </div>
      <MiniCalendar today={now} />
    </div>
  );
}

/* ── Mini Calendar ───────────────────────────────────────────────── */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function MiniCalendar({ today: _today }) {
  const [view, setView] = useState(() => {
    const t = getIST();
    return { year: t.getFullYear(), month: t.getMonth() };
  });

  const { year, month } = view;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const todayIST = getIST();
  const isToday = (d) =>
    todayIST.getFullYear() === year && todayIST.getMonth() === month && todayIST.getDate() === d;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function prev() {
    setView((v) => {
      const m = v.month - 1;
      return m < 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: m };
    });
  }
  function next() {
    setView((v) => {
      const m = v.month + 1;
      return m > 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: m };
    });
  }

  return (
    <div className="text-xs select-none shrink-0">
      <div className="flex items-center justify-between gap-3 mb-1">
        <button onClick={prev} className="text-slate-400 hover:text-brand px-1">
          ‹
        </button>
        <span className="font-semibold text-slate-700 whitespace-nowrap">
          {MONTHS[month]} {year}
        </span>
        <button onClick={next} className="text-slate-400 hover:text-brand px-1">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-[10px] text-slate-400 font-semibold py-0.5">
            {d}
          </div>
        ))}
        {cells.map((d, i) => (
          <div
            key={i}
            className={`text-center py-0.5 rounded font-medium ${
              d === null
                ? ''
                : isToday(d)
                  ? 'bg-brand text-white rounded-full'
                  : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {d || ''}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Status pills ────────────────────────────────────────────────── */
function StatCard({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    orange: 'bg-orange-50 text-orange-700',
  };
  return (
    <div className={`card ${tones[tone]}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wide mt-1">{label}</div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    ok: 'pill-ok',
    low: 'pill-low',
    out_of_stock: 'pill-out',
    expired: 'pill-out',
    expiring_soon: 'pill-warn',
    fresh: 'pill-ok',
    // Days-of-cover badges (Phase 1)
    order_now: 'pill-out',
    order_soon: 'pill-warn',
    waste_risk: 'pill-warn',
  };
  const label = status?.replaceAll('_', ' ') || '-';
  return <span className={map[status] || 'pill bg-slate-100 text-slate-700'}>{label}</span>;
}

/* ── AI Summary ──────────────────────────────────────────────────── */
function AISummaryCard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setErr('');
    setBusy(true);
    try {
      const r = await api.aiSummary(refresh);
      setData(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="font-semibold">This week, at a glance</h2>
          <div className="text-xs text-slate-400">
            {data?.period_start ? `${data.period_start} → ${data.period_end}` : 'AI summary'}
            {data?.from_cache && ' · cached'}
          </div>
        </div>
        <button
          onClick={() => load(true)}
          disabled={busy}
          className="btn-secondary text-xs px-3 py-1"
        >
          {busy ? 'Generating...' : 'Refresh'}
        </button>
      </div>
      {err && (
        <div className="text-xs text-rose-700 bg-rose-50 p-2 rounded">
          {err.includes('OPENAI_API_KEY')
            ? 'Add OPENAI_API_KEY to backend env to enable the AI summary.'
            : err}
        </div>
      )}
      {!err && !data && <div className="text-sm text-slate-500">Loading...</div>}
      {data && (
        <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap">
          {data.content}
        </div>
      )}
    </div>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────── */
export default function Dashboard() {
  const { profile } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .dashboard()
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  const canSeeAI = profile && ['leadership', 'finance'].includes(profile.role);

  if (err) return <div className="text-rose-600 p-4">{err}</div>;
  if (!data)
    return (
      <>
        <WakingUp loading={!data} />
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-brand rounded-full animate-spin" />
          <span className="text-sm">Loading dashboard…</span>
        </div>
      </>
    );

  return (
    <div className="space-y-6">
      {/* IST clock + calendar */}
      <ISTClock />

      <div>
        <h1 className="text-2xl font-semibold">Inventory snapshot</h1>
        <p className="text-sm text-slate-500">Live view of pantry stock and freshness.</p>
      </div>

      {canSeeAI && <AISummaryCard />}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Products" value={data.summary.total_products} />
        <StatCard label="In stock" value={data.summary.in_stock} tone="green" />
        <StatCard label="Low" value={data.summary.low} tone="amber" />
        <StatCard label="Out of stock" value={data.summary.out_of_stock} tone="rose" />
        <StatCard label="Expiring soon" value={data.summary.expiring_soon} tone="orange" />
        <StatCard label="Expired" value={data.summary.expired} tone="rose" />
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">All items</h2>
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Min</th>
                <th className="py-2 pr-3">Cover</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.product_id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium text-slate-900">{r.product_name}</td>
                  <td className="py-2 pr-3 capitalize text-slate-500">
                    {r.category?.replace('_', ' ')}
                  </td>
                  <td className="py-2 pr-3">
                    {r.current_stock ?? 0} {r.unit}
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{r.min_threshold ?? 0}</td>
                  <td className="py-2 pr-3 text-slate-500">
                    {r.days_of_cover != null ? (
                      <span className="flex items-center gap-2">
                        {r.days_of_cover}d
                        {r.cover_status && r.cover_status !== 'ok' && (
                          <StatusPill status={r.cover_status} />
                        )}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusPill status={r.stock_status} />
                  </td>
                  <td className="py-2 pr-3 text-slate-500">
                    {r.expiry_date ? (
                      <span className="flex items-center gap-2">
                        {r.expiry_date}
                        {r.expiry_status && r.expiry_status !== 'fresh' && (
                          <StatusPill status={r.expiry_status} />
                        )}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
