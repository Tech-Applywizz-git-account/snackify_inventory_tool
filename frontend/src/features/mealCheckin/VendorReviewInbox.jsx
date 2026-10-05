import { MessageSquareText, RefreshCw, Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const VIBES = [
  { key: 'excellent', label: 'Excellent', color: 'bg-emerald-500' },
  { key: 'good', label: 'Good', color: 'bg-teal-500' },
  { key: 'poor', label: 'Poor', color: 'bg-amber-500' },
  { key: 'very_bad', label: 'Very bad', color: 'bg-rose-500' },
];

function formatReviewTime(value) {
  if (!value) return 'Time unavailable';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function Rating({ value }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800">
      <Star size={15} className="fill-amber-400 text-amber-500" aria-hidden="true" />
      {value}/5
    </span>
  );
}

export default function VendorReviewInbox({ mealDate }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadReviews = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const response = await api.listMealReviews(mealDate);
        setReviews(response?.reviews || []);
      } catch (requestError) {
        setError(requestError.message || 'Could not load meal feedback.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [mealDate]
  );

  useEffect(() => {
    loadReviews();
    const timer = window.setInterval(() => loadReviews(true), 60000);
    return () => window.clearInterval(timer);
  }, [loadReviews]);

  const average = reviews.length
    ? (
        reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length
      ).toFixed(1)
    : '—';
  const comments = reviews.filter((review) => review.comment?.trim()).length;
  const vibeCounts = Object.fromEntries(
    VIBES.map(({ key }) => [key, reviews.filter((review) => review.vibe === key).length])
  );

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-amber-50 text-amber-700">
            <MessageSquareText size={17} />
          </span>
          <div>
            <h2 className="font-semibold text-slate-950">Employee feedback</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Meal reviews shared with meal service · {mealDate}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => loadReviews(true)}
          disabled={refreshing || loading}
          title="Refresh meal feedback"
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      <div className="grid gap-4 border-b border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:p-5">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Average rating</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">
            {loading ? '—' : average}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {reviews.length} review{reviews.length === 1 ? '' : 's'} · {comments} with comments
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {VIBES.map((vibe) => (
            <div key={vibe.key} className="rounded-md border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${vibe.color}`} />
                <p className="text-xs font-medium text-slate-600">{vibe.label}</p>
              </div>
              <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">
                {loading ? '—' : vibeCounts[vibe.key]}
              </p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:px-5"
        >
          {error}
          {reviews.length > 0 ? ' Showing previously loaded feedback.' : ''}
        </div>
      )}

      {loading ? (
        <p role="status" className="px-5 py-8 text-center text-sm text-slate-500">
          Loading employee feedback…
        </p>
      ) : reviews.length === 0 ? (
        <div className="px-5 py-9 text-center">
          <p className="text-sm font-semibold text-slate-800">
            No reviews received for this meal date
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Reviews submitted through the employee meal-review flow will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3 p-3 md:hidden">
            {reviews.map((review, index) => (
              <article
                key={review.id}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-slate-900">
                      {review.preferred_name || review.full_name || 'Unknown'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">Review #{index + 1}</p>
                  </div>
                  <Rating value={review.rating} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-medium ${review.meal_type === 'veg' ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-800'}`}
                  >
                    {review.meal_type === 'veg' ? 'Veg' : 'Non-veg'}
                  </span>
                  <span className="text-xs font-semibold text-slate-700">
                    {review.vibe_label || review.vibe}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-5 text-slate-600">
                  {review.comment?.trim() || <span className="italic text-slate-400">No comment</span>}
                </p>
                <time
                  className="mt-3 block text-xs text-slate-500"
                  dateTime={review.created_at || undefined}
                >
                  Reviewed {formatReviewTime(review.created_at)}
                </time>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1050px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="px-4 py-3">S. No.</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Meal type</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">Experience</th>
                <th className="w-[30%] px-4 py-3">Comment</th>
                <th className="px-4 py-3">Reviewed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reviews.map((review, index) => (
                <tr
                  key={review.id}
                  className="align-top text-slate-700 transition-colors hover:bg-slate-50/70"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                    {index + 1}
                  </td>
                  <td className="px-4 py-3">
                    <div className="max-w-48 truncate font-semibold text-slate-900">
                      {review.preferred_name || review.full_name || 'Unknown'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-medium ${review.meal_type === 'veg' ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-800'}`}
                    >
                      {review.meal_type === 'veg' ? 'Veg' : 'Non-veg'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Rating value={review.rating} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-700">
                    {review.vibe_label || review.vibe}
                  </td>
                  <td className="whitespace-normal break-words px-4 py-3 leading-5 text-slate-600">
                    <span className={review.comment?.trim() ? '' : 'italic text-slate-400'}>
                      {review.comment?.trim() || 'No comment'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    <time dateTime={review.created_at || undefined}>
                      {formatReviewTime(review.created_at)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}
