import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function MealQrPanel({ mealDate }) {
  const [qr, setQr] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setQr(null);
    setError('');
    api
      .mealCheckinQr(mealDate)
      .then((result) => {
        if (active) setQr(result);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Your meal QR could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [mealDate]);

  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
      <h2 className="text-sm font-semibold text-slate-900">Meal collection QR</h2>
      {error ? (
        <p role="status" className="mt-2 text-sm text-rose-700">
          {error}
        </p>
      ) : qr ? (
        <>
          <img
            src={qr.qr_code}
            alt={`Meal collection QR for ${qr.meal_date}`}
            className="mx-auto mt-3 h-48 w-48 rounded-md border border-slate-200 bg-white p-2"
          />
          <p className="mt-2 text-xs text-slate-600">
            Show this QR when collecting your {qr.choice.replace('_', ' ')} meal.
          </p>
          <details className="mx-auto mt-3 max-w-full text-left">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">
              Show manual check-in code
            </summary>
            <code className="mt-2 block break-all rounded bg-white p-2 text-[10px] text-slate-600">
              {qr.token}
            </code>
          </details>
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Loading meal QR...</p>
      )}
    </section>
  );
}
