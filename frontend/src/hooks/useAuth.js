import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react';
import { isPushSupported, subscribeToPush } from '../lib/push.js';
import { supabase } from '../lib/supabase.js';

/** Silently subscribe to push notifications after AAL2 login.
 *  Never throws — a failed subscription must never block the login flow. */
async function tryAutoSubscribePush(session) {
  try {
    if (!isPushSupported()) return;
    if (Notification.permission === 'denied') return;
    await subscribeToPush(session.access_token);
  } catch (_) {
    // Silently ignore — user may not have granted permission yet
  }
}

/** Try to read AAL from the JWT's aal claim directly (no network call) */
function readAalFromSession(session) {
  try {
    const token = session?.access_token;
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.aal || null;
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

function useAuthValue() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [aal, setAal] = useState('aal1');
  const bootstrapped = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Safety timeout — never stay loading forever
    const safetyTimer = setTimeout(() => {
      if (!bootstrapped.current && !cancelled) {
        console.warn('[useAuth] Safety timeout — forcing loading=false after 6s');
        bootstrapped.current = true;
        setLoading(false);
      }
    }, 6000);

    function checkAal(sess) {
      const jwtAal = readAalFromSession(sess);
      if (!cancelled) setAal(jwtAal || 'aal1');
    }

    async function bootstrap() {
      console.log('[useAuth] bootstrap start');
      try {
        const { data, error } = await supabase.auth.getSession();
        console.log('[useAuth] getSession done, session?', !!data?.session, error?.message || '');
        if (cancelled) return;

        const sess = data?.session || null;
        setSession(sess);

        if (sess) {
          console.log('[useAuth] session exists, checking AAL + profile');
          checkAal(sess);
          await loadProfile(sess.user.id);
        } else {
          setProfileLoading(false);
        }
      } catch (e) {
        console.error('[useAuth] bootstrap error:', e);
      } finally {
        bootstrapped.current = true;
        if (!cancelled) {
          console.log('[useAuth] setting loading=false');
          setLoading(false);
        }
      }
    }

    async function loadProfile(userId) {
      for (let i = 0; i < 3; i++) {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, preferred_name, role, email, active')
          .eq('id', userId)
          .maybeSingle();
        if (data) {
          if (!cancelled) setProfile(data);
          return;
        }
        if (i < 2) await new Promise((r) => setTimeout(r, 1200));
      }
      if (!cancelled) setProfile(null);
    }

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      console.log('[useAuth] onAuthStateChange:', _event, !!newSession);
      if (newSession) {
        const jwtAal = readAalFromSession(newSession) || 'aal1';
        setAal(jwtAal);
        setSession(newSession);
        setProfileLoading(true);
        loadProfile(newSession.user.id).finally(() => setProfileLoading(false));
        if (jwtAal === 'aal2') tryAutoSubscribePush(newSession);
      } else {
        setSession(null);
        setProfile(null);
        setProfileLoading(false);
        setAal('aal1');
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, profile, profileLoading, loading, aal };
}

export function AuthProvider({ children }) {
  const value = useAuthValue();
  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  return useContext(AuthContext) || useAuthValue();
}
