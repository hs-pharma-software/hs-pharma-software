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
  Finer per-table rules (staff health records, incident investigations) are
  added as those registers are built.

`npm run test:scoped` runs the whole test suite with every statement rewritten
exactly as the server does; it must pass before the rules are changed.

**Known exposure, unchanged:** the AI assistant's API key is a global setting
that every business's browser reads, because the assistant calls the AI
service from the page. Moving those calls to the server would remove it.

The desktop app is unchanged. It keeps its local database and its own sync
token (built in by the release workflow).

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
