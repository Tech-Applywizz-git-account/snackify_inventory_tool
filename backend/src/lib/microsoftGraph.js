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

/**
 * Send a meal skip reminder email to a user.
 * @param {string} email - recipient address
 * @param {string} mealDate - the date of the meal (YYYY-MM-DD)
 */
export async function sendMealSkipReminderEmail(email, mealDate) {
  if (!isGraphConfigured()) {
    console.warn('[MealSkipReminder] Microsoft Graph not configured — skipping email skip reminder.');
    return;
  }

  const token = await getGraphToken();
  const subject = `🍽️ Change of plans? Skip your meal booking for tomorrow (${mealDate})`;

  const body = `
    <div style="background-color: #f6f9fc; padding: 48px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; min-height: 100%;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #eef2f6; box-shadow: 0 20px 24px -4px rgba(16, 24, 40, 0.03), 0 8px 8px -4px rgba(16, 24, 40, 0.02); overflow: hidden;">
        <!-- Top Green Accent Line -->
        <tr>
          <td height="6" style="background: linear-gradient(90deg, #10b981, #059669);"></td>
        </tr>
        <!-- Header -->
        <tr>
          <td align="center" style="padding: 40px 40px 20px 40px;">
            <span style="font-size: 42px;">🥗</span>
            <h2 style="margin: 16px 0 8px 0; color: #1e293b; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; line-height: 32px;">
              Change of Plans?
            </h2>
            <p style="margin: 0; color: #059669; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
              Eco-friendly Cafeteria Reminder
            </p>
          </td>
        </tr>
        <!-- Content Body -->
        <tr>
          <td style="padding: 0 40px 30px 40px;">
            <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;">
            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 26px; color: #334155;">Hello,</p>
            
            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 26px; color: #475569;">
              You currently have a meal booked for tomorrow, <strong style="color: #0f172a;">${mealDate}</strong>.
            </p>

            <!-- Quote Card -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0fdf4; border-left: 4px solid #10b981; border-radius: 4px; margin: 20px 0; padding: 12px 16px;">
              <tr>
                <td style="font-size: 14px; line-height: 22px; color: #15803d; font-style: italic; font-weight: 500;">
                  "Food is very precious in daily life — let's work together to not waste it! 🍲"
                </td>
              </tr>
            </table>
            
            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 26px; color: #475569;">
              If your plans have changed and you will be out of the office or wish to skip tomorrow's meal, 
              please mark it as <strong style="color: #dc2626;">Skip</strong> in the portal. This helps our kitchen staff cook the right amount of food and prevent waste!
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
                  <a href="https://snackify.applywizz.ai/" target="_blank" style="background-color: #10b981; color: #ffffff; padding: 16px 36px; border-radius: 10px; font-size: 15px; font-weight: 600; text-decoration: none; display: inline-block; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2); text-align: center;">
                    Manage Meal Booking & Skip →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 24px; color: #64748b; text-align: center; font-style: italic;">
              🌿 If you still plan to eat tomorrow's meal, no action is needed!
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px 40px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 18px;">
              ApplyWizz Snackify • Automated Sustainability Notifications<br>
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

/**
 * Send the nightly meal booking summary report email.
 * @param {string[]} emails - recipient addresses
 * @param {object} reportData - report details
 */
export async function sendMealNightReportEmail(emails, reportData) {
  if (!isGraphConfigured()) {
    console.warn('[MealNightReport] Microsoft Graph not configured — skipping email report.');
    return;
  }

  const token = await getGraphToken();
  const toRecipients = emails.map((email) => ({ emailAddress: { address: email } }));

  if (toRecipients.length === 0) return;

  const subject = `📋 Daily Meal Bookings Summary Report (${reportData.mealDate})`;

  const unbookedList = (reportData.unbookedNames || []).length > 0
    ? (reportData.unbookedNames || []).map(name => `<li style="margin-bottom: 6px; font-weight: 500;">${name}</li>`).join('')
    : '<li style="color: #16a34a; font-style: italic; font-weight: 600;">None (All active members have responded! 🎉)</li>';

  const body = `
    <div style="background-color: #f6f9fc; padding: 48px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; min-height: 100%;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #eef2f6; box-shadow: 0 20px 24px -4px rgba(16, 24, 40, 0.03), 0 8px 8px -4px rgba(16, 24, 40, 0.02); overflow: hidden;">
        <!-- Top Dark Accent Line -->
        <tr>
          <td height="6" style="background: linear-gradient(90deg, #1e293b, #475569);"></td>
        </tr>
        <!-- Header -->
        <tr>
          <td align="center" style="padding: 40px 40px 20px 40px;">
            <span style="font-size: 42px;">📋</span>
            <h2 style="margin: 16px 0 8px 0; color: #1e293b; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; line-height: 32px;">
              Meal Bookings Night Report
            </h2>
            <p style="margin: 0; color: #64748b; font-size: 14px; font-weight: 500;">
              Snackify Cafeteria Notification
            </p>
          </td>
        </tr>
        <!-- Content Body -->
        <tr>
          <td style="padding: 0 40px 30px 40px;">
            <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;">
            
            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #475569;">
              Here is the summary of tomorrow's meal choices and bookings status for <strong style="color: #0f172a;">${reportData.mealDate}</strong>:
            </p>

            <!-- Summary Statistics Table -->
            <h3 style="margin: 0 0 12px 0; color: #0f172a; font-size: 16px; font-weight: 700;">Summary Statistics</h3>
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
              <thead>
                <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                  <th align="left" style="padding: 12px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Category</th>
                  <th align="right" style="padding: 12px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Headcount</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 14px 16px; font-size: 14px; color: #16a34a; font-weight: 600;">Total Booked</td>
                  <td align="right" style="padding: 14px 16px; font-size: 14px; color: #14532d; font-weight: 700;">${reportData.totalBooked}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 14px 16px; font-size: 14px; color: #dc2626; font-weight: 600;">Skipped</td>
                  <td align="right" style="padding: 14px 16px; font-size: 14px; color: #7f1d1d; font-weight: 700;">${reportData.totalSkipped}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 14px 16px; font-size: 14px; color: #64748b; font-weight: 600;">Not Booked</td>
                  <td align="right" style="padding: 14px 16px; font-size: 14px; color: #334155; font-weight: 700;">${reportData.totalNotBooked}</td>
                </tr>
              </tbody>
            </table>

            <!-- Detailed Breakdown Table -->
            <h3 style="margin: 28px 0 12px 0; color: #0f172a; font-size: 16px; font-weight: 700;">Breakdown by Menu Choice</h3>
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px;">
              <thead>
                <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                  <th align="left" style="padding: 12px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Menu Choice</th>
                  <th align="right" style="padding: 12px 16px; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Headcount</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 14px 16px; font-size: 14px; color: #334155; font-weight: 600;">🟢 Vegetarian Meal</td>
                  <td align="right" style="padding: 14px 16px; font-size: 14px; color: #0f172a; font-weight: 700;">${reportData.vegCount}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 14px 16px; font-size: 14px; color: #334155; font-weight: 600;">🔴 Non-Vegetarian Meal</td>
                  <td align="right" style="padding: 14px 16px; font-size: 14px; color: #0f172a; font-weight: 700;">${reportData.nonVegCount}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="padding: 14px 16px; font-size: 14px; color: #334155; font-weight: 600;">🥚 Egg Meal Option</td>
                  <td align="right" style="padding: 14px 16px; font-size: 14px; color: #0f172a; font-weight: 700;">${reportData.eggCount}</td>
                </tr>
                ${Object.entries(reportData.others || {}).map(([choice, count]) => `
                  <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 14px 16px; font-size: 14px; color: #334155; font-weight: 600; text-transform: capitalize;">🍱 ${choice}</td>
                    <td align="right" style="padding: 14px 16px; font-size: 14px; color: #0f172a; font-weight: 700;">${count}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <!-- Unbooked Members List -->
            <h3 style="margin: 28px 0 12px 0; color: #dc2626; font-size: 16px; font-weight: 700;">⚠️ Members who have NOT booked or skipped:</h3>
            <div style="background-color: #fcfcfc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 24px;">
              <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 22px;">
                ${unbookedList}
              </ul>
            </div>

            <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 20px; color: #94a3b8; text-align: center;">
              This report was auto-generated at 8:30 PM IST today for administrative cafeteria prep optimization.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 24px 40px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 18px;">
              ApplyWizz Snackify • Automated Nightly Summaries<br>
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
        toRecipients,
      },
      saveToSentItems: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph sendMail failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Send a meal booking confirmation email to a user.
 * @param {string} email - recipient address
 * @param {string} name - recipient full name
 * @param {string} choice - meal choice (veg, non_veg, egg)
 * @param {string} mealDate - the date of the meal (YYYY-MM-DD)
 */
export async function sendMealBookingConfirmationEmail(email, name, choice, mealDate) {
  if (!isGraphConfigured()) {
    console.warn('[MealBookingConfirmation] Microsoft Graph not configured — skipping email confirmation.');
    return;
  }

  const token = await getGraphToken();
  const subject = `🍽️ Booking Confirmed: Your meal for tomorrow (${mealDate})`;

  const choiceLabels = {
    veg: '🟢 Vegetarian Meal',
    non_veg: '🔴 Non-Vegetarian Meal',
    egg: '🥚 Egg Meal Option',
  };
  const choiceLabel = choiceLabels[choice.toLowerCase()] || `🍱 ${choice}`;

  const body = `
    <div style="background-color: #f6f9fc; padding: 48px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; min-height: 100%;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #eef2f6; box-shadow: 0 20px 24px -4px rgba(16, 24, 40, 0.03), 0 8px 8px -4px rgba(16, 24, 40, 0.02); overflow: hidden;">
        <!-- Top Accent Line -->
        <tr>
          <td height="6" style="background: linear-gradient(90deg, #ff5a5f, #ff7e5f);"></td>
        </tr>
        <!-- Header -->
        <tr>
          <td align="center" style="padding: 40px 40px 20px 40px;">
            <span style="font-size: 42px;">🍽️</span>
            <h2 style="margin: 16px 0 8px 0; color: #1e293b; font-size: 24px; font-weight: 700; letter-spacing: -0.025em; line-height: 32px;">
              Booking Confirmed
            </h2>
            <p style="margin: 0; color: #ff5a5f; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
              Snackify Cafeteria Notification
            </p>
          </td>
        </tr>
        <!-- Content Body -->
        <tr>
          <td style="padding: 0 40px 30px 40px;">
            <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 20px 0;">
            <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 26px; color: #334155;">Hello ${name},</p>
            
            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 26px; color: #475569;">
              Your meal booking has been successfully confirmed for tomorrow! Here are your ticket details:
            </p>

            <!-- Details Card Badge -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 24px 0; padding: 16px 20px;">
              <tr>
                <td style="padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;">
                  <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Target Meal Date</span>
                  <span style="display: block; font-size: 16px; font-weight: 700; color: #0f172a;">📅 ${mealDate}</span>
                </td>
              </tr>
              <tr>
                <td style="padding-top: 12px;">
                  <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: 700; margin-bottom: 4px;">Your Meal Choice</span>
                  <span style="display: block; font-size: 16px; font-weight: 700; color: #0f172a;">${choiceLabel}</span>
                </td>
              </tr>
            </table>

            <!-- CTA Button -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 32px 0 8px 0;">
              <tr>
                <td align="center">
                  <a href="https://snackify.applywizz.ai/" target="_blank" style="background-color: #ff5a5f; color: #ffffff; padding: 16px 36px; border-radius: 10px; font-size: 15px; font-weight: 600; text-decoration: none; display: inline-block; box-shadow: 0 4px 12px rgba(255, 90, 95, 0.2); text-align: center;">
                    View Booking in Portal →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 24px; color: #64748b; text-align: center;">
              If your plans change, you can modify or skip your meal booking in the portal before cutoff times.
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

/**
 * Send a guest meal booking notification to leadership + finance users.
 * Includes an Accept button that triggers token + cabin generation.
 * @param {object} params
 * @param {string} params.bookingId   - UUID of the meal_bookings row
 * @param {string} params.guestName   - name of the guest
 * @param {string} params.mealType    - 'veg' or 'non_veg'
 * @param {string} params.bookedBy    - full name of the staff member who booked
 * @param {string} params.mealDate    - YYYY-MM-DD date string
 * @param {string} params.acceptUrl   - full URL for the Accept button
 * @param {Array}  params.recipients  - array of { email } objects
 */
export async function sendGuestMealNotificationEmail({ bookingId, guestName, mealType, bookedBy, mealDate, acceptUrl, recipients }) {
  if (!isGraphConfigured()) {
    console.warn('[GuestMeal] Microsoft Graph not configured — skipping guest meal notification email.');
    return;
  }

  if (!recipients || recipients.length === 0) {
    console.warn('[GuestMeal] No recipients found — skipping guest meal notification email.');
    return;
  }

  const token = await getGraphToken();
  const mealLabel = mealType === 'veg' ? '🥦 Veg' : '🍗 Non-Veg';
  const subject = `🍽️ Guest Meal Booked — Action Required (${guestName})`;

  const body = `
    <div style="background-color: #f6f9fc; padding: 48px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; min-height: 100%;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #eef2f6; box-shadow: 0 20px 24px -4px rgba(16, 24, 40, 0.03); overflow: hidden;">
        <!-- Top accent -->
        <tr><td height="6" style="background: linear-gradient(90deg, #6366f1, #8b5cf6);"></td></tr>
        <!-- Body -->
        <tr>
          <td style="padding: 40px 40px 32px 40px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="font-size: 48px; margin-bottom: 8px;">🍽️</div>
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #0f172a;">Guest Meal Booked</h1>
              <p style="margin: 6px 0 0 0; font-size: 14px; color: #64748b;">A meal has been booked for a guest and requires your acceptance.</p>
            </div>

            <!-- Details card -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 24px 0; padding: 20px;">
              <tr><td style="padding: 6px 0;">
                <span style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Guest Name</span><br>
                <span style="font-size: 16px; font-weight: 700; color: #0f172a;">${guestName}</span>
              </td></tr>
              <tr><td style="padding: 6px 0; border-top: 1px solid #e2e8f0;">
                <span style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Meal Type</span><br>
                <span style="font-size: 16px; font-weight: 700; color: #0f172a;">${mealLabel}</span>
              </td></tr>
              <tr><td style="padding: 6px 0; border-top: 1px solid #e2e8f0;">
                <span style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Meal Date</span><br>
                <span style="font-size: 16px; font-weight: 700; color: #0f172a;">📅 ${mealDate}</span>
              </td></tr>
              <tr><td style="padding: 6px 0; border-top: 1px solid #e2e8f0;">
                <span style="font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Booked By</span><br>
                <span style="font-size: 16px; font-weight: 700; color: #0f172a;">${bookedBy}</span>
              </td></tr>
            </table>

            <!-- Accept CTA -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 32px 0 8px 0;">
              <tr>
                <td align="center">
                  <a href="${acceptUrl}" target="_blank" style="background-color: #6366f1; color: #ffffff; padding: 16px 40px; border-radius: 10px; font-size: 16px; font-weight: 700; text-decoration: none; display: inline-block; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                    ✅ Accept &amp; Generate Token
                  </a>
                </td>
              </tr>
            </table>
            <p style="text-align: center; font-size: 12px; color: #94a3b8; margin: 12px 0 0 0;">Clicking Accept will generate a token number and cabin assignment, and open a print page.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #f8fafc; border-top: 1px solid #f1f5f9; padding: 20px 40px; text-align: center;">
            <p style="margin: 0; font-size: 12px; color: #94a3b8;">ApplyWizz Snackify • Automated Notification System<br>Booking ID: ${bookingId}</p>
          </td>
        </tr>
      </table>
    </div>
  `;

  const toRecipients = recipients.filter((r) => r.email).map((r) => ({ emailAddress: { address: r.email } }));
  if (toRecipients.length === 0) return;

  const res = await fetch('https://graph.microsoft.com/v1.0/users/support@applywizz.ai/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Html', content: body },
        toRecipients,
      },
      saveToSentItems: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph sendMail failed (${res.status}): ${text.slice(0, 200)}`);
  }
}
