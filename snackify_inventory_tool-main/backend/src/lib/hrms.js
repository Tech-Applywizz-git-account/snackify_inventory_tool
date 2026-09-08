/**
 * Optional HRMS attendance lookup by email.
 * Configure HRMS_ATTENDANCE_URL (+ optional HRMS_ATTENDANCE_API_KEY).
 * Expected JSON includes employee_id / employeeId / emp_id / employee_code.
 */

function lastFourFromId(raw) {
  const code = String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!code) return '';
  return code.slice(-4);
}

export async function lookupEmployeeIdByEmail(email) {
  const url = String(process.env.HRMS_ATTENDANCE_URL || '').trim();
  const key = String(process.env.HRMS_ATTENDANCE_API_KEY || '').trim();
  if (!url) {
    const err = new Error('HRMS is not configured. Enter the card number manually.');
    err.status = 503;
    throw err;
  }
  const clean = String(email || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) {
    const err = new Error('This user has no email for HRMS lookup.');
    err.status = 400;
    throw err;
  }

  const target = new URL(url);
  target.searchParams.set('email', clean);

  const headers = { Accept: 'application/json' };
  if (key) headers.Authorization = key.startsWith('Bearer ') ? key : `Bearer ${key}`;

  const res = await fetch(target, { headers });
  if (!res.ok) {
    const err = new Error(`HRMS lookup failed (${res.status}). Enter the card number manually.`);
    err.status = 502;
    throw err;
  }
  const body = await res.json().catch(() => ({}));
  const row = Array.isArray(body) ? body[0] : (body?.data || body?.employee || body);
  const employeeId =
    row?.employee_id
    || row?.employeeId
    || row?.emp_id
    || row?.employee_code
    || row?.employeeCode
    || row?.id;
  const code = String(employeeId || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const last4 = lastFourFromId(code);
  if (!code) {
    const err = new Error('HRMS did not return an employee ID for this email. Enter the card number manually.');
    err.status = 404;
    throw err;
  }
  return { employee_id: code, last4 };
}

export function panFromLast4(userId, last4) {
  const hex = String(userId || '').replace(/-/g, '').slice(0, 8);
  const n = Number.parseInt(hex, 16);
  const prefix = Number.isFinite(n) ? String(n % 100000000).padStart(8, '0') : '10000000';
  return `${prefix}${last4}`;
}
