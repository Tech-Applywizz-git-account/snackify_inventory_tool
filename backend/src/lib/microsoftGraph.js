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

/**
 * Send a low-stock warning email to all leadership users.
 * Triggered automatically when an item's stock_servings drops to <= 10 after an order.
 * @param {string} itemName      — display name of the item running low
 * @param {number} remaining     — number of servings remaining after deduction
 * @param {object} supabaseAdmin — supabase admin client (passed in to avoid circular imports)
 */
export async function sendLowStockEmail(itemName, remaining, supabaseAdmin, isCritical = false) {
  if (!isGraphConfigured()) {
    console.warn('[LowStock] Microsoft Graph not configured — skipping email alert.');
    return;
  }

  // Fetch all leadership email addresses from profiles table
  const { data: leaders, error } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('role', 'leadership');

  if (error || !leaders || leaders.length === 0) {
    console.warn('[LowStock] No leadership emails found — skipping low stock email.');
    return;
  }

  const token = await getGraphToken();
  const toRecipients = leaders
    .filter((l) => l.email)
    .map((l) => ({ emailAddress: { address: l.email } }));

  if (toRecipients.length === 0) return;

  const subject = isCritical
    ? `🚨 Critical Stock Alert: ${itemName} — Only ${remaining} servings left!`
    : `⚠️ Low Stock Alert: ${itemName}`;
  const body =
    `Hello,\n\n` +
    `This is an automated alert from Snackify.\n\n` +
    (isCritical
      ? `🚨 URGENT: The item "${itemName}" is critically low in the cafeteria!\n`
      : `The item "${itemName}" is running low in the cafeteria.\n`) +
    `Remaining servings: ${remaining}\n\n` +
    `Please arrange a restock at your earliest convenience.\n\n` +
    `— Snackify Inventory System`;

  const res = await fetch('https://graph.microsoft.com/v1.0/users/support@applywizz.ai/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients,
      },
      saveToSentItems: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[LowStock] Graph sendMail failed (${res.status}): ${text.slice(0, 200)}`);
  } else {
    console.log(`[LowStock] Low stock email sent for "${itemName}" (${remaining} servings left) to ${toRecipients.length} leaders.`);
  }
}

/**
 * Send a meal booking reminder email to a user.
 * @param {string} email - recipient address
 * @param {string} mealDate - the date of the meal (YYYY-MM-DD)
 * @param {boolean} isFinal - whether this is the final reminder before cutoff
 */
export async function sendMealBookingReminderEmail(email, mealDate, isFinal = false) {
  if (!isGraphConfigured()) {
    console.warn('[MealReminder] Microsoft Graph not configured — skipping email reminder.');
    return;
  }

  const token = await getGraphToken();
  const subject = isFinal 
    ? `🚨 Final Reminder: Book your meal for tomorrow (${mealDate})`
    : `🍽️ Reminder: Book your meal for tomorrow (${mealDate})`;

  const warningText = isFinal
    ? `<p style="margin: 0 0 20px 0; font-size: 15px; line-height: 24px; color: #dc2626; font-weight: 600;">
         ⚠️ The meal booking window closes at 6:00 PM IST today
       </p>`
    : '';

  const body = `
    <div style="background-color: #f6f9fc; padding: 48px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; min-height: 100%;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #eef2f6; box-shadow: 0 20px 24px -4px rgba(16, 24, 40, 0.03), 0 8px 8px -4px rgba(16, 24, 40, 0.02); overflow: hidden;">
        <!-- Top Accent Line -->
        <tr>
          <td height="6" style="background: linear-gradient(90deg, #ff4e50, #f9d423);"></td>
        </tr>
        <!-- Header -->
        <tr>
          <td align="center" style="padding: 40px 40px 20px 40px;">
            <span style="font-size: 42px;">🍲</span>
            <h2 style="margin: 16px 0 8px 0; color: #1e293b; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; line-height: 32px;">
              ${isFinal ? 'Final Call: Book Your Meal' : "Don't Miss Tomorrow's Meal!"}
            </h2>
            <p style="margin: 0; color: #64748b; font-size: 14px; font-weight: 500;">
              ${isFinal ? 'Urgent Cafeteria Notification' : 'Snackify Cafeteria Notification'}
            </p>
          </td>
        </tr>
        <!-- Content Body -->
        <tr>
          <td style="padding: 0 40px 30px 40px;">
            <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;">
            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 26px; color: #334155;">Hello,</p>
            
            ${warningText}

            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 26px; color: #475569;">
              We noticed you still haven't booked your lunch for tomorrow, <strong style="color: #0f172a;">${mealDate}</strong>. Please let us know your choice:
            </p>

            <!-- Date Card Badge -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 24px 0; padding: 16px 20px;">
              <tr>
                <td>
                  <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Target Meal Date</span>
                  <span style="display: block; font-size: 18px; font-weight: 700; color: #0f172a;">📅 ${mealDate}</span>
                </td>
              </tr>
            </table>

            <!-- CTA Button -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 32px 0 8px 0;">
              <tr>
                <td align="center">
                  <a href="https://snackify.applywizz.ai/" target="_blank" style="background-color: #FF5A5F; color: #ffffff; padding: 16px 36px; border-radius: 10px; font-size: 15px; font-weight: 600; text-decoration: none; display: inline-block; box-shadow: 0 4px 12px rgba(255, 90, 95, 0.2); text-align: center;">
                    Select Choice & Book Now →
                  </a>
                </td>
              </tr>
            </table>

            <!-- Funny Text -->
            <p style="margin: 8px 0 24px 0; font-size: 13px; font-style: italic; color: #64748b; text-align: center; font-weight: 500;">
              Because "I forgot" doesn't taste very good. 😄
            </p>
            
            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 24px; color: #64748b; text-align: center;">
              If you plan to skip tomorrow's meal, please mark it as <strong>Skip</strong> in the portal so we are informed.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px 40px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 18px;">
              ApplyWizz Snackify • Automated Notification System<br>
              For support or queries, contact <a href="mailto:support@applywizz.ai" style="color: #64748b; text-decoration: underline;">support@applywizz.ai</a>
            </p>
          </td>
        </tr>
      </table>
    </div>
  `;

  const res = await fetch('https://graph.microsoft.com/v1.0/users/support@applywizz.ai/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Html', content: body },
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

