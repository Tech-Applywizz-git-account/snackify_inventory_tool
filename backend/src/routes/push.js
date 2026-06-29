import { Router } from 'express';
import webpush from 'web-push';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@applywizz.ai'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// POST /api/push/subscribe — save subscription for current user
router.post('/subscribe', async (req, res, next) => {
  try {
    const sub = req.body;
    if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription object' });

    const { error } = await supabaseAdmin.from('push_subscriptions').upsert(
      {
        user_id: req.user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys?.p256dh || null,
        auth_key: sub.keys?.auth || null,
        expiration_time: sub.expirationTime || null,
      },
      { onConflict: 'endpoint' }
    );

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/push/subscribe — remove subscription
router.delete('/subscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;

/**
 * Send a push notification to specific user IDs.
 * Called from other routes (e.g. when a new order is placed).
 */
export async function sendPushToUsers(userIds, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  if (!userIds?.length) return;

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds);

  if (!subs?.length) return;

  const notification = JSON.stringify(payload);

  await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          notification
        )
        .catch(async (err) => {
          // 410 = subscription expired — clean it up
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
          console.error('[Push] send error', err.statusCode, sub.endpoint.slice(-30));
        })
    )
  );
}
