import { useCallback, useEffect, useMemo, useState } from 'react';
import WakingUp from '../components/WakingUp.jsx';
import { api } from '../lib/api.js';

const INR = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

export default function DailyUpdate() {
  const [items, setItems] = useState(null);
  const [edits, setEdits] = useState({}); // { [productId]: { stock, unit_cost } }
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const data = await api.inventoryStatus();
      setItems(data);
      const init = {};
      for (const r of data) {
        init[r.product_id] = {
          stock: String(r.current_stock ?? 0),
          unit_cost: String(r.cost_per_unit ?? 0),
        };
      }
      setEdits(init);
    } catch (e) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    if (!items) return {};
    return items.reduce((acc, r) => {
      const k = r.category || 'other';
      acc[k] ??= [];
      acc[k].push(r);
      return acc;
    }, {});
  }, [items]);

  function setStock(id, v) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], stock: v } }));
  }
  function setCost(id, v) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], unit_cost: v } }));
  }

  async function submit() {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const updates = items
        .map((r) => {
          const e = edits[r.product_id] || {};
          const nextStock = Number(e.stock);
          const nextCost = Number(e.unit_cost);
          if (Number.isNaN(nextStock)) return null;

          const stockChanged = nextStock !== Number(r.current_stock);
          const costChanged = !Number.isNaN(nextCost) && nextCost !== Number(r.cost_per_unit);

          if (!stockChanged && !costChanged) return null;

          const payload = { product_id: r.product_id, current_stock: nextStock };
          if (costChanged) payload.unit_cost = nextCost;
          return payload;
        })
        .filter(Boolean);

      if (!updates.length) {
        setOkMsg('Nothing changed - all counts and prices already match.');
        return;
      }
      const result = await api.dailyUpdate(updates);
      const msgParts = [
        `Updated ${result.updated} item${result.updated === 1 ? '' : 's'}`,
        `logged ${result.transactions_logged} transaction${result.transactions_logged === 1 ? '' : 's'}`,
      ];
      if (result.prices_updated) {
        msgParts.push(
          `refreshed ${result.prices_updated} price${result.prices_updated === 1 ? '' : 's'}`
        );
      }
      setOkMsg(`${msgParts.join(', ')}.`);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !items) return <div className="text-rose-600 p-4">{err}</div>;
  if (!items)
    return (
      <>
        <WakingUp loading={!items} />
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-brand rounded-full animate-spin" />
          <span className="text-sm">Loading inventory…</span>
        </div>
      </>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Daily stock update</h1>
          <p className="text-sm text-slate-500">
            Count what is in the pantry, type it in. If today is a delivery, edit the unit price to
            whatever you paid - the master price refreshes automatically.
          </p>
        </div>
        <button className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? 'Saving...' : 'Save all changes'}
        </button>
      </div>

      {err && <div className="text-rose-600 text-sm">{err}</div>}
      {okMsg && (
        <div className="text-sm text-emerald-700 bg-emerald-50 p-3 rounded-md">{okMsg}</div>
      )}

      {Object.entries(grouped).map(([cat, rows]) => (
        <div key={cat} className="card">
          <h2 className="font-semibold capitalize mb-3">{cat.replace('_', ' ')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((r) => {
              const e = edits[r.product_id] || {};
              const stockChanged = Number(e.stock) !== Number(r.current_stock);
              const costChanged = Number(e.unit_cost) !== Number(r.cost_per_unit);
              const changed = stockChanged || costChanged;

              return (
                <div
                  key={r.product_id}
                  className={`p-3 rounded-lg border ${
                    changed ? 'border-brand bg-brand/5' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-slate-900 text-sm">{r.product_name}</div>
                    <span className="text-xs text-slate-500">{r.unit}</span>
                  </div>

                  {/* stock row */}
                  <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                    Stock count
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-2.5 py-1 text-xs"
                      onClick={() =>
                        setStock(r.product_id, String(Math.max(0, Number(e.stock || 0) - 1)))
                      }
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      className="input text-center"
                      value={e.stock ?? ''}
                      onChange={(ev) => setStock(r.product_id, ev.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-secondary px-2.5 py-1 text-xs"
                      onClick={() => setStock(r.product_id, String(Number(e.stock || 0) + 1))}
                    >
                      +
                    </button>
                  </div>

                  {/* cost row */}
                  <label className="block text-[11px] uppercase tracking-wide text-slate-400 mt-3 mb-1">
                    Unit price (₹){' '}
                    {costChanged && (
                      <span className="text-amber-600 normal-case">- price will update master</span>
                    )}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    className="input"
                    value={e.unit_cost ?? ''}
                    onChange={(ev) => setCost(r.product_id, ev.target.value)}
                  />

                  <div className="mt-2 text-xs text-slate-500 flex items-center justify-between">
                    <span>min: {r.min_threshold}</span>
                    <span>master: {INR(r.cost_per_unit)}</span>
                  </div>
                  {r.expiry_date && (
                    <div className="text-xs text-slate-500">exp: {r.expiry_date}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
