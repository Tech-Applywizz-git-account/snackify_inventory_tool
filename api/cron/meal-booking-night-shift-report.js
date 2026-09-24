/**
 * Vercel Cron: trigger the nightly night-shift booking summary report.
 * Runs at 10:15 PM IST every day (16:45 UTC).
 */
module.exports = async function handler(req, res) {
  console.log('[vercel-cron] /api/cron/meal-booking-night-shift-report hit', new Date().toISOString(), {
    method: req.method,
    ua: req.headers['user-agent'] || '',
    vercelCron: req.headers['x-vercel-cron'] || '',
  });

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const SNACKIFY_BASE = (
    process.env.SNACKIFY_API_URL
    || process.env.VITE_API_URL
    || 'https://snackify-inventory-tool.onrender.com'
  ).replace(/\/$/, '');

  const CRON_SECRET =
    process.env.SNACKIFY_CRON_SECRET
    || process.env.CRON_SECRET
    || 'app_wizz_cron_secret_change_in_production';

  const started = Date.now();

  try {
    const response = await fetch(`${SNACKIFY_BASE}/api/cron/meal-booking-night-shift-report`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Cron-Secret': CRON_SECRET,
      },
      body: JSON.stringify({ secret: CRON_SECRET }),
      signal: AbortSignal.timeout(55_000),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: (text || '').slice(0, 500) };
    }

    if (!response.ok) {
      console.error('[vercel-cron] night-shift report failed', response.status, data);
      return res.status(response.status).json({
        success: false,
        message: 'Night-shift report failed',
        status: response.status,
        backendResponse: data,
        ms: Date.now() - started,
        at: new Date().toISOString(),
      });
    }

    console.log('[vercel-cron] night-shift report ok', data);
    return res.status(200).json({
      success: true,
      message: 'Night-shift report completed on Vercel cron',
      worker: 'vercel',
      backendResponse: data,
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[vercel-cron] night-shift report failed:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Vercel night-shift report failed',
      error: error?.message || String(error),
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  }
};

module.exports.config = {
  maxDuration: 60,
};
