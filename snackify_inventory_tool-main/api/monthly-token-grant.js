/**
 * Vercel Cron: reset leftover Snackify coins and grant 4000
 * on the 1st of every month at 08:00 IST (02:30 UTC).
 * CommonJS so it deploys next to Vite ("type": "module").
 */
module.exports = async function handler(req, res) {
  console.log('[vercel-cron] /api/monthly-token-grant hit', new Date().toISOString(), {
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
    const response = await fetch(`${SNACKIFY_BASE}/api/cron/monthly-token-grant`, {
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
      console.error('[vercel-cron] monthly-token-grant failed', response.status, data);
      return res.status(response.status).json({
        success: false,
        message: 'Monthly coin grant failed',
        status: response.status,
        backendResponse: data,
        ms: Date.now() - started,
        at: new Date().toISOString(),
      });
    }

    console.log('[vercel-cron] monthly-token-grant ok', data);
    return res.status(200).json({
      success: true,
      message: 'Monthly Snackify coin grant completed on Vercel cron',
      worker: 'vercel',
      backendResponse: data,
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[vercel-cron] monthly-token-grant failed:', error?.message || error);
    return res.status(500).json({
      success: false,
      message: 'Vercel monthly coin grant failed',
      error: error?.message || String(error),
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  }
};

module.exports.config = {
  maxDuration: 60,
};
