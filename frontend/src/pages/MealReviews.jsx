import { useCallback, useEffect, useState } from 'react';
import { Star } from 'lucide-react';
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Meal Reviews</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Who reviewed lunch, stars, vibes, and free-text feedback.
          </p>
        </div>
        <div className="flex items-center gap-2">
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

      {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-xl p-3">{err}</div>}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-slate-700">
            {count} review{count === 1 ? '' : 's'} · {date}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">No reviews for this date yet.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 flex flex-col sm:flex-row sm:items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-900 truncate">
                    {r.preferred_name || r.full_name || 'Unknown'}
                  </div>
                  <div className="text-xs text-slate-400 truncate">{r.email || r.user_id}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 font-semibold text-slate-700">
                      {r.meal_type === 'veg' ? '🥬 Veg' : '🍗 Non-veg'}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-100 text-amber-800 font-semibold inline-flex items-center gap-1">
                      <Star size={12} className="fill-amber-400 text-amber-400" />
                      {r.rating}/5
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-brand/10 text-brand font-semibold">
                      {r.vibe_label || r.vibe}
                    </span>
                  </div>
                  {r.comment ? (
                    <p className="mt-2 text-sm text-slate-600 whitespace-pre-wrap break-words">
                      {r.comment}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400 italic">No written comment</p>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 shrink-0">
                  {r.created_at
                    ? new Date(r.created_at).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
