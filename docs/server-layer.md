# Server layer (web version)

## Why

Until this is switched on, the web version's JavaScript carries a Turso
token with full read and write access to the whole shared database: every
tenant, every patient, every login. Anyone who opens the site's developer tools
can copy it.

With the server layer switched on:

- **The token is not in the page.** The database token lives only in
  Vercel's server environment, and the browser talks to the app's own server
  (`/api/...`).
- **Login is checked by the server,** which sets a signed session cookie
  (`HttpOnly`, `SameSite=Strict`, `Secure`, 12 hours). Scripts in the page
  cannot read it. Repeated failed logins from one address are slowed down.
- **Password hashes never reach the browser.** The server removes
  `password_hash` and `password_salt` from every result. Logins are created and
  passwords changed only through `/api/auth/...`.
- **Every statement the browser sends is checked** (`src/server/sqlPolicy.ts`)
  before it runs:
  - it must come from a logged-in, active user;
  - it must be one plain read or write: no `CREATE` / `ALTER` / `DROP` /
    `PRAGMA` / `ATTACH`, and no second statement hidden after a `;`;
  - it must use known tables only, never `sqlite_master` or device-only tables;
  - tenants and subscription plans are written by the Super Admin only;
  - logins are managed by owners (and HR), not other staff.
- **Every write is logged** in `server_audit_log`: who, role, tenant, which
  tables and the statement. Argument values, which can hold patient data, are
  never logged.
- **The public lab report (QR code) still opens without a login.** The server
  builds it from the report's random token.

- **Every statement of a business login is kept inside that business**
  (`src/server/tenantScope.ts`). The server rewrites it before running it, so
  nothing the query says can reach another business:
  - every table read is replaced by a copy filtered to the caller's tenant;
  - updates and deletes get the same condition added to their WHERE;
  - inserts must carry the caller's own tenant;
  - records cannot be moved to another business.

  Shared by design, and allowed:
  - the shared product catalogue for pharmacy businesses;
  - a hospital or clinic reading its linked pharmacy's products (read-only);
  - prescription mailbox rows between the two businesses involved;
  - the caller's own settings, plus the global keys the app reads;
  - the list of hospital pharmacies.

  The Super Admin is not rewritten.
- **Hospital records are role-limited:** a staff login with no hospital section
  (for example a pharmacy cashier) cannot read or write `hospital_*` tables.
- **Staff HR records are limited further** (appraisals, credentials,
  training):
  - a login with the HR section reads and changes them for the whole hospital;
  - a login with Quality & Safety reads them (the MSDS self-assessment needs
    them) and records training, but cannot change appraisals or verify
    credentials;
  - every other staff login sees only their own records, and can change only
    the acknowledgement of their own appraisal (status, date, comments).

  Incidents, complaints and corrective actions stay readable by hospital staff
  logins: every staff member can report an incident or complaint, and
  anonymous incident reports store no name.

`npm run test:scoped` runs the whole test suite with every statement rewritten
exactly as the server does; it must pass before the rules are changed.

- **The AI assistant's key stays on the server.** The assistant's calls go
  to `/api/ai`, and the server adds the key (the business's own, or the
  global one the Super Admin set) and calls Gemini. Business logins can no
  longer read `billori_api_key` or their own `ai_gemini_api_key` from the
  settings. Each login is limited to 30 assistant calls a minute. Once server
  mode is on, **create a new Gemini key** in Google AI Studio, save it on the
  Super Admin's Billori page and delete the old one: the old key was readable
  by every business before.

The desktop app is unchanged. It keeps its local database and its own sync
token (built in by the release workflow).

## Rollout order

Do these in order. Each step can be checked before the next.

1. **Back up:** `node scripts/backup-turso-snapshot.cjs` (read-only; it verifies
   itself). Keep the folder it prints; `backups/` is never committed.
2. **Migrate:** `node scripts/migrate-turso.cjs --check`, then
   `--from=<first missing version>`, then `node scripts/check-turso-schema.cjs`.
   The schema banner on the site disappears once the database is up to date.
3. **Switch on the server layer** (below), redeploy.
4. **Run the live check** (below).
5. **Rotate the Turso token** (step 6 below), redeploy, run the live check again.
6. **Update the desktop installs** to a release built with the new token.

## Switching it on (Vercel)

1. **Apply the migrations**, so `server_audit_log` exists:
   `node scripts/migrate-turso.cjs --check`, then `--from=<N>`
   (see [database-migrations.md](database-migrations.md)).
2. **Create a session secret:** 48 random characters, for example from
   `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
3. **Set these in Vercel** → Project → Settings → Environment Variables
   (Production, and Preview if used):
   - `TURSO_DATABASE_URL`: the same value as `NEXT_PUBLIC_TURSO_DATABASE_URL`;
   - `TURSO_AUTH_TOKEN`: the database token (see step 6);
   - `SESSION_SECRET`: from step 2;
   - `NEXT_PUBLIC_DB_MODE` = `server`.
4. **Delete `NEXT_PUBLIC_TURSO_DATABASE_URL` and `NEXT_PUBLIC_TURSO_AUTH_TOKEN`
   from Vercel.** While they exist, Next.js puts them in the page. Keep them in
   GitHub Actions secrets and your local `.env.local`; the desktop build needs
   them.
5. **Redeploy.** Everyone is logged out once and logs in again.
6. **Rotate the Turso token.** The old one was in every copy of the site served
   so far:
   1. Create a new token in the Turso dashboard.
   2. Put it in Vercel `TURSO_AUTH_TOKEN`, in the GitHub Actions secret
      `NEXT_PUBLIC_TURSO_AUTH_TOKEN`, and in your local `.env.local`.
   3. Redeploy.
   4. Revoke the old token.

   Desktop installs built with the old token stop syncing until they are
   updated to a release built with the new one.

### Check it worked

Run the read-only check against the live site. It only sends GET requests
and one unauthenticated POST, and never prints a token:

```
node scripts/live-check.cjs https://<your-site>
```

It checks that every hospital page answers, that `/api/db` refuses a
request without a session, that no Turso address or token is in the page's
scripts, and that a QR report link opens without a login.

By hand:

- Open the site and log in.
- In the browser's developer tools, search the loaded scripts for `turso`:
  there should be no token.
- `https://<your-site>/api/db/` without logging in answers
  `{"error":"Your session has ended. Log in again."}`.
- Open a lab report QR link: it shows without logging in.

### Switching it off

Set `NEXT_PUBLIC_DB_MODE` to anything else and put the `NEXT_PUBLIC_TURSO_*`
variables back (a new token), then redeploy. This exposes the token again, so
use it only as a short-term fallback.

## Local development

`.env.local` keeps `NEXT_PUBLIC_TURSO_*` for the desktop build. To run the web
version through the server locally, add `SESSION_SECRET=<any 32+ characters>`
and `NEXT_PUBLIC_DB_MODE=server`. In development the server falls back to the
`NEXT_PUBLIC_TURSO_*` values; production requires the `TURSO_*` names.
