import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Validates the Authorization: Bearer <jwt> header against Supabase auth
 * and loads the user's profile (incl. role) onto req.user.
 */
export async function authMiddleware(req, res, next) {
  try {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, preferred_name, role, active')
      .eq('id', userData.user.id)
      .single();

    if (profileErr || !profile) {
      return res.status(403).json({ error: 'No profile found for user' });
    }

    if (!profile.active) {
      return res.status(403).json({ error: 'Account is disabled.' });
    }

    req.user = { id: userData.user.id, email: userData.user.email, ...profile };
    req.jwt = token;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Restricts a route to one of the given roles.
 *   router.post('/x', requireRole('facility_manager', 'leadership'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(', ')}` });
    }
    next();
  };
}
