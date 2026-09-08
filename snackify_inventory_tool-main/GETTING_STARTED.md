# Getting Started — Applyways Pantry

Follow these in order. Stop at any step if something errors; tell me what happened.

## 0. Clean up (one-time, 30 seconds)

Two broken `.git` folders were left by the sandbox. Delete them from PowerShell or File Explorer:

```powershell
cd C:\Users\DELL\Desktop\inventory
Remove-Item -Recurse -Force rtk-template
Remove-Item -Recurse -Force .git
```

If PowerShell complains about permissions, run as Administrator or just delete the folders in File Explorer.

---

## 1. Create the Supabase project (5 min)

1. Go to **https://supabase.com** → sign in → "New project"
2. Name it `applyways-pantry`, choose a region close to your office, set a strong DB password (save it)
3. Wait ~2 minutes for the project to provision
4. In the left sidebar click **SQL Editor** → "New query"
5. Open `supabase/migrations/0001_init_schema.sql` from this folder, copy the whole thing, paste it into the SQL editor, click **Run**. You should see "Success. No rows returned."
6. New query again. Open `supabase/seed/seed_products.sql`, paste, **Run**. Should insert 34 products.
7. In the sidebar click **Authentication → Providers**, make sure Email is enabled (it usually is by default).

## 2. Grab your Supabase keys (1 min)

In the sidebar: **Project Settings → API**. Copy these three values:

- `Project URL` — something like `https://xxxxx.supabase.co`
- `anon public` key — long string starting with `eyJ...`
- `service_role` key — also starts with `eyJ...`. **Treat this like a password.** It bypasses RLS.

## 3. Configure the backend (1 min)

```powershell
cd C:\Users\DELL\Desktop\inventory\backend
copy .env.example .env
notepad .env
```

Fill in:

```
SUPABASE_URL=<your project URL>
SUPABASE_SERVICE_ROLE_KEY=<your service_role key>
```

Save & close. Then install + run:

```powershell
npm install
npm run dev
```

You should see: `[applyways-api] listening on http://localhost:4000`.
Open a browser to `http://localhost:4000/health` — should return `{"ok":true,...}`.

## 4. Configure the frontend (1 min)

Open a **second** PowerShell window:

```powershell
cd C:\Users\DELL\Desktop\inventory\frontend
copy .env.example .env.local
notepad .env.local
```

Fill in:

```
VITE_SUPABASE_URL=<your project URL>
VITE_SUPABASE_ANON_KEY=<your anon public key>
VITE_API_BASE_URL=http://localhost:4000
```

Save & close. Then:

```powershell
npm install
npm run dev
```

You should see `Local: http://localhost:5173/`. Open it in a browser.

## 5. First sign-in (2 min)

1. Enter your email → "Send magic link"
2. Check your inbox, click the link
3. You'll land on `/dashboard` but see "Access denied for role: staff"

That's correct — new users default to `staff`. Promote yourself:

In Supabase **SQL Editor**, run:

```sql
update public.profiles
set role = 'leadership'
where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
```

Sign out and back in. You should now see Dashboard, Daily Update, Finance, and What's Available.

## 6. Try a daily update

1. Navigate to **Daily Update**
2. Change a few stock counts (the cards turn teal when modified)
3. Click **Save all changes**
4. Go to **Finance** — if you increased any stock, a row will appear in the spending chart (it captures the cost from the product master)

---

## 7. Push to your GitHub (optional, when ready)

After cleaning up the broken `.git` folder in step 0:

```powershell
cd C:\Users\DELL\Desktop\inventory
git init -b main
git add .
git commit -m "Initial scaffold: Applyways Pantry Phase 1 MVP"
git remote add origin https://github.com/GOODBOYKITTU272/Inventory.git
git push -u origin main
```

If the remote already has commits (e.g. a README), you may need `git pull --rebase origin main` before pushing, or `git push -u origin main --force` if you want to overwrite (dangerous on a shared repo).

---

## 8. Install the recommended MCPs (10 min)

Once the app is running, add these to your Claude Code (they make the next round of work much faster). All commands run on your Windows machine in PowerShell or your Claude Code config.

### Playwright MCP

```powershell
claude mcp add playwright -- npx @playwright/mcp@latest
```

Restart Claude Code. Then prompt:
> "Use Playwright MCP to open http://localhost:5173, log in with magic link to my email, and screenshot every page."

### Postgres MCP (read-only — safest)

In Supabase **SQL Editor**, create a read-only role first:

```sql
create role mcp_read login password 'PICK-STRONG-PASSWORD-HERE';
grant connect on database postgres to mcp_read;
grant usage on schema public to mcp_read;
grant select on all tables in schema public to mcp_read;
alter default privileges in schema public grant select on tables to mcp_read;
```

Then get the connection string from **Project Settings → Database → Connection string → URI** and substitute the user + password:

```
postgresql://mcp_read:PICK-STRONG-PASSWORD-HERE@db.<project-ref>.supabase.co:5432/postgres
```

Add to Claude Code:

```powershell
claude mcp add postgres -- npx -y @modelcontextprotocol/server-postgres "<that-connection-string>"
```

### rtk (token saver)

Windows install: download the latest release from `https://github.com/rtk-ai/rtk/releases`, unzip, add to PATH, then:

```powershell
rtk init -g
```

---

## Troubleshooting

**`npm install` fails with permission error** — close VS Code or any editor that has the folder open, retry.

**Magic link email doesn't arrive** — in Supabase, **Authentication → Email Templates**, check the "Magic Link" template is on. Also check spam.

**Sign in works but I see "No profile found"** — the `handle_new_user` trigger didn't fire. Run this manually in SQL editor:
```sql
insert into public.profiles (id, full_name, role)
select id, email, 'staff' from auth.users
where id not in (select id from public.profiles);
```

**Daily update fails with "Requires role: facility_manager, leadership"** — your profile is still `staff`. Re-run the promotion SQL in step 5.

**API returns 401 "Invalid or expired token"** — your frontend session expired. Sign out, sign back in.
