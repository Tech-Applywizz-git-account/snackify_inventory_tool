import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export default function MealReviewsPage() {
  const [date, setDate] = useState(todayIST);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await api.listMealReviews(date);
      setRows(data?.reviews || []);
      setCount(data?.count || 0);
    } catch (e) {
      setErr(e.message || 'Failed to load reviews');
      setRows([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Meal Reviews</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Who reviewed lunch, stars, vibes, and free-text feedback.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider" htmlFor="review-date">
            Date
          </label>
          <input
            id="review-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border-2 border-slate-100 rounded-xl px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <button type="button" className="btn-secondary text-sm" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {err && <div className="mx-auto w-full max-w-5xl rounded-xl bg-rose-50 p-3 text-center text-sm text-rose-600">{err}</div>}

      <div className="card mx-auto w-full max-w-5xl">
        <div className="mb-3 flex items-center justify-center">
          <div className="text-center text-sm font-bold text-slate-700">
            {count} review{count === 1 ? '' : 's'} · {date}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No reviews for this date yet.</div>
        ) : (
          <div className="overflow-hidden">
            <table className="w-full table-fixed border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="w-[12%] px-1.5 py-2.5 sm:px-2">Employee code</th>
                  <th className="w-[19%] px-1.5 py-2.5 sm:px-2">Employee</th>
                  <th className="w-[12%] px-1.5 py-2.5 sm:px-2">Meal type</th>
                  <th className="w-[9%] px-1.5 py-2.5 sm:px-2">Rating</th>
                  <th className="w-[11%] px-1.5 py-2.5 sm:px-2">Vibe</th>
                  <th className="w-[27%] px-1.5 py-2.5 sm:px-2">Comment</th>
                  <th className="w-[10%] px-1.5 py-2.5 sm:px-2">Reviewed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top text-slate-700 transition-colors hover:bg-slate-50/70">
                    <td className="break-words px-1.5 py-2.5 font-bold text-slate-900 sm:px-2">
                      {r.employee_code || 'Null'}
                    </td>
                    <td className="break-words px-1.5 py-2.5 sm:px-2">
                      <div className="truncate font-semibold text-slate-900">
                        {r.preferred_name || r.full_name || 'Unknown'}
                      </div>
                      <div className="truncate text-xs text-slate-400">{r.email || r.user_id}</div>
                    </td>
                    <td className="break-words px-1.5 py-2.5 sm:px-2">
                      {r.meal_type === 'veg' ? '🥬 Veg' : '🍗 Non-veg'}
                    </td>
                    <td className="break-words px-1.5 py-2.5 font-semibold text-amber-700 sm:px-2">
                      {r.rating}/5
                    </td>
                    <td className="break-words px-1.5 py-2.5 font-semibold text-brand sm:px-2">
                      {r.vibe_label || r.vibe}
                    </td>
                    <td className="whitespace-normal break-words px-1.5 py-2.5 leading-5 text-slate-600 sm:px-2">
                      <span className={r.comment ? '' : 'italic text-slate-400'}>
                        {r.comment || 'NULL'}
                      </span>
                    </td>
                    <td className="break-words px-1.5 py-2.5 text-xs text-slate-400 sm:px-2">
                      {r.created_at
                        ? new Date(r.created_at).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
