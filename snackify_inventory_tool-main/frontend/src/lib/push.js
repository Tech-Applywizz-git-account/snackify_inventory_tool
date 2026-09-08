// Push notification subscription helper

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY;
}

export async function getPushStatus() {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
  if (!reg) return 'not_subscribed';
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  return sub ? 'subscribed' : 'not_subscribed';
}

export async function subscribeToPush(authToken) {
  if (!isPushSupported()) throw new Error('Push not supported in this browser');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission denied');

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const res = await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(sub),
  });
  if (!res.ok) throw new Error('Failed to save subscription on server');
  return sub;
}

export async function unsubscribeFromPush(authToken) {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await sub.unsubscribe();
  await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
}
