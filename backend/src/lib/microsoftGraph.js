/**
 * microsoftGraph.js — checks whether a login email belongs to a real,
 * enabled user in the ApplyWizz Azure (Entra) directory.
 *
 * Why: the app must only let people in if they actually exist in the company
 * directory. This closes the hole where any random email could self-register.
 *
 * Uses the client-credentials flow (app-only). No new libraries — built-in fetch.
 * Reads MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET
 * from the environment (never hard-coded, never sent to the browser).
 */

const TENANT_ID = process.env.MICROSOFT_TENANT_ID;
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;

// Simple in-memory token cache so we don't fetch a new token on every login.
let cachedToken = null;
let cachedExpiry = 0; // epoch ms

/** True when Graph credentials are configured. */
export function isGraphConfigured() {
  return Boolean(TENANT_ID && CLIENT_ID && CLIENT_SECRET);
}

/** Get (and cache) an app-only access token for Microsoft Graph. */
async function getGraphToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiry) return cachedToken;

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph token request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  cachedToken = json.access_token;
  // Refresh a minute before the real expiry to be safe.
  cachedExpiry = now + (Number(json.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

/**
 * Look the email up in the directory.
 * @param {string} email
 * @returns {Promise<{ exists: boolean, displayName?: string }>}
 *
 * - 200 + accountEnabled !== false  → { exists: true, displayName }
 * - 404                             → { exists: false }
 * - any other error                 → throws (caller should FAIL CLOSED / deny)
 */
export async function isDirectoryUser(email) {
  const token = await getGraphToken();
  const lookup = encodeURIComponent(email);
  const url =
    `https://graph.microsoft.com/v1.0/users/${lookup}` +
    `?$select=id,displayName,accountEnabled,userPrincipalName,mail`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) return { exists: false };

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph user lookup failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const user = await res.json();
  // accountEnabled can be undefined for some object types; treat only an
  // explicit false as disabled.
  if (user.accountEnabled === false) return { exists: false };

  return { exists: true, displayName: user.displayName || undefined };
}

/**
 * Send the Snackify login OTP to the user's corporate inbox.
 * Requires Mail.Send application permission on the Azure app registration.
 * @param {string} email — recipient address
 * @param {string} code  — 6-digit plaintext code (NEVER log this value)
 */
export async function sendOtpEmail(email, code) {
  const token = await getGraphToken();
  const res = await fetch('https://graph.microsoft.com/v1.0/users/support@applywizz.ai/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: 'Your Snackify verification code',
        body: {
          contentType: 'Text',
          content:
            `Your Snackify verification code is: ${code}\n\n` +
            'This code expires in 10 minutes. Do not share it with anyone.\n\n' +
            'If you did not request this code, please contact support@applywizz.ai.',
        },
        toRecipients: [{ emailAddress: { address: email } }],
      },
      saveToSentItems: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph sendMail failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** True when Graph credentials are configured — same condition as directory lookup. */
export function isSendMailConfigured() {
  return isGraphConfigured();
}
