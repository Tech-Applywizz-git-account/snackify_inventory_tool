# Microsoft (Azure AD) sign-in — setup guide

Result: only `@applywizz.ai` accounts can sign in, `ramakrishna@applywizz.ai`
is automatically promoted to `leadership`, and the rest are managed from the
in-app Admin page.

There are 4 parts. Do them in order.

---

## 1. Apply the new auth migration in Supabase

This adds the domain check and the admin RPC. Run once.

1. Open https://supabase.com/dashboard/project/twmadauhauuypioznpus/sql/new
2. Copy the contents of `supabase/migrations/0002_auth_policy.sql`
3. Paste, click **Run**. Should say "Success. No rows returned."

After this:
- New signups with email ending in anything other than `@applywizz.ai` fail.
- `ramakrishna@applywizz.ai` is auto-promoted to `leadership` (back-fill runs
  even if he signed in earlier).

## 2. Register an app in Microsoft Entra (Azure AD)

1. Go to https://portal.azure.com → **Microsoft Entra ID** → **App registrations**
2. Click **New registration**
3. Fields:
   - **Name**: `Applyways Pantry`
   - **Supported account types**: pick *"Accounts in this organizational directory only (Applywizz)"* if you have an Entra tenant for the company. If not, pick *"Personal Microsoft accounts only"*. Choosing single-tenant is more secure.
   - **Redirect URI**: select **Web**, value:
     ```
     https://twmadauhauuypioznpus.supabase.co/auth/v1/callback
     ```
4. Click **Register**
5. On the overview page, copy these two values into a notes app — you'll need them:
   - **Application (client) ID**
   - **Directory (tenant) ID**

6. Left sidebar → **Certificates & secrets** → **New client secret**
   - Description: `supabase`
   - Expires: 24 months
   - Click **Add**
   - **Copy the secret VALUE immediately** (you can't see it again). This is your **Client Secret**.

7. Left sidebar → **API permissions**. The default `User.Read` is fine. Click **Grant admin consent for Applywizz** if shown.

## 3. Enable Azure provider in Supabase

1. Open https://supabase.com/dashboard/project/twmadauhauuypioznpus/auth/providers
2. Find **Azure** in the list, click it → toggle **Enable Sign in with Azure**
3. Fill in:
   - **Azure Tenant URL**: `https://login.microsoftonline.com/<TENANT-ID-FROM-STEP-2>`
     - If you chose "personal Microsoft accounts only", use `https://login.microsoftonline.com/common` instead
   - **Application (client) ID**: paste from step 2.5
   - **Application Secret**: paste the value from step 2.6
4. Click **Save**
5. While here, click **URL Configuration** in the left auth sidebar and add to **Redirect URLs**:
   - `http://localhost:5173/dashboard`
   - `http://localhost:5173/**`
6. **Site URL**: `http://localhost:5173`

## 4. Restart your local dev servers

In each of the BACKEND and FRONTEND PowerShell windows:

```
Ctrl+C
y
npm run dev
```

Then go to `http://localhost:5173`. You should see the new login page with a
**Sign in with Microsoft** button.

---

## Test it

1. Click **Sign in with Microsoft**
2. You'll be redirected to Microsoft's sign-in page
3. Sign in as `ramakrishna@applywizz.ai`
4. You'll land back on `http://localhost:5173/dashboard`
5. Top nav should show: Dashboard | Daily Update | Finance | What's Available | **Admin**

In the **Admin** page:
- Invite users by entering their `@applywizz.ai` email + role
- Change existing users' roles via the dropdown
- Users invited here will receive an email; they can also just sign in with Microsoft directly

## Troubleshooting

**"AADSTS50011: The redirect URI specified in the request does not match"** — the redirect URI in Azure AD doesn't match Supabase. Make sure step 2.3 value matches exactly: `https://twmadauhauuypioznpus.supabase.co/auth/v1/callback`

**"Signups restricted to @applywizz.ai"** — you tried to sign in with a non-allowed email. Expected behavior.

**"Access denied for role: staff" even for ramakrishna** — the back-fill UPDATE in migration 0002 didn't match. Run manually:
```sql
update public.profiles set role='leadership'
where id = (select id from auth.users where email='ramakrishna@applywizz.ai');
```
Sign out, sign back in.

**Microsoft sign-in works but the app shows blank/error after redirect** — open DevTools (F12) → Console. Most likely the Supabase Azure provider isn't enabled (step 3) or the secret is wrong.
