/**
 * Vercel Cron: trigger night-shift meal token print jobs at 10:00 PM IST (Mon–Fri).
 * Schedule: 30 16 * * 1-5 UTC = 10:00 PM IST weekdays.
 */
module.exports = async function handler(req, res) {
  console.log('[vercel-cron] /api/cron/schedule-night-meal-print hit', new Date().toISOString(), {
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
    const response = await fetch(`${SNACKIFY_BASE}/api/cron/schedule-night-meal-print`, {
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
      console.error('[vercel-cron] night meal print failed', response.status, data);
      return res.status(response.status).json({
        success: false,
        message: 'Night meal print schedule failed',
        status: response.status,
        backendResponse: data,
        ms: Date.now() - started,
        at: new Date().toISOString(),
      });
    }

    console.log('[vercel-cron] night meal print ok', data);
    return res.status(200).json({
      success: true,
      message: 'Night meal print schedule completed on Vercel cron',
      worker: 'vercel',
      backendResponse: data,
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[vercel-cron] night meal print failed:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Vercel night meal print schedule failed',
      error: error?.message || String(error),
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  }
};

module.exports.config = {
  maxDuration: 60,
};
