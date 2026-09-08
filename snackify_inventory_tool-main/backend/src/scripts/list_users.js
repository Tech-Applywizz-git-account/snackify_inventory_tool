import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env variables.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function main() {
  try {
    const {
      data: { users },
      error,
    } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw error;
    console.log(`Found ${users.length} users:`);
    for (const u of users) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', u.id)
        .maybeSingle();
      const { data: factors } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: u.id });
      console.log(
        `- Email: ${u.email}, ID: ${u.id}, Role: ${profile?.role || 'none'}, MFA Factors Count: ${factors?.factors?.length || 0}`
      );
    }
  } catch (err) {
    console.error(err);
  }
}

main();
