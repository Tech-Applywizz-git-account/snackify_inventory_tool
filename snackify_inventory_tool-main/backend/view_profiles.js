import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve('c:/Users/DELL/Desktop/inventory/backend/.env') });

const { supabaseAdmin } = await import('./src/lib/supabase.js');

async function run() {
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('*');

  if (error) {
    console.error('Error fetching profiles:', error);
    return;
  }

  console.log('--- ALL PROFILES ---');
  profiles.forEach(p => {
    console.log(p);
  });
  
  const { data: users, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
  if (authErr) {
    console.error('Error listing auth users:', authErr);
  } else {
    console.log('--- AUTH USERS ---');
    users.users.forEach(u => {
      console.log(`ID: ${u.id} | Email: ${u.email} | Created: ${u.created_at}`);
    });
  }
}

run();
