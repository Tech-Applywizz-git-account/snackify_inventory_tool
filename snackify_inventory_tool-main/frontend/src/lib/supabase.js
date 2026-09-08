import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing. ' +
      'Copy frontend/.env.example to frontend/.env.local and fill it in.'
  );
}

export const supabase = createClient(url || 'http://localhost', anon || 'noop');
