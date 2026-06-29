import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  console.warn(
    '[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — API calls will fail. ' +
      'Copy backend/.env.example to backend/.env and fill it in.'
  );
}

// Admin client — bypasses RLS. Use only on the server.
export const supabaseAdmin = createClient(url || 'http://localhost', serviceKey || 'noop', {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Anon client — used to exchange a magic-link OTP for a user session.
// The returned session is scoped to the user, not the service role.
export const supabaseAnon = createClient(url || 'http://localhost', anonKey || 'noop', {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Per-request client that respects RLS for the calling user.
export function supabaseAsUser(jwt) {
  return createClient(url || 'http://localhost', serviceKey || 'noop', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
