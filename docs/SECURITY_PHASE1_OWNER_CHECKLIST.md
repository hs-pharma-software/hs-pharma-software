# Security phase 1: owner checklist

These steps are for the owner, because each one changes production. **Never paste a secret into chat, a ticket or a commit.** Where a value has to be copied, the commands below put it straight into the clipboard instead of printing it.

## Order

1. Rotate the Turso credentials (A).
2. Upgrade Next.js and deploy the phase 1 branch (C).
3. Migrate the plaintext FBR and AI keys (B).

A comes first because a working full-access token may be in git history.

---

## A. Rotate the Turso database credentials (audit C3)

**Why:** `seed-users.mjs` (commit `0a3b674`, 20 Oct 2026) contains a read-write Turso token that never expires, for the production database. It is not the token the app uses now, but whether it still works is unknown. Rotating makes it worthless however far the repository has spread. Git history is **not** rewritten in this phase.

| # | Step | Check |
|---|---|---|
| A1 | Note every place the token is used: Vercel → Project → Settings → Environment Variables (`TURSO_AUTH_TOKEN`, separately for Production and Preview); `.env.local` on each development PC; GitHub → Settings → Secrets (if any workflow uses it); the FBR gateway VPS (it has none). | A written list of every location |
| A2 | Choose a low-traffic time. There is a short outage between invalidating and updating Vercel. | — |
| A3 | Back up first: `node scripts/backup-turso-snapshot.cjs` | "Verified: integrity ok" |
| A4 | Invalidate **all** existing tokens: `turso db tokens invalidate <database-name>`. This rotates the signing key, so every old token stops working, including the one in git. Check the current Turso CLI help first (`turso db tokens invalidate --help`) in case the command has changed. | The CLI reports success |
| A5 | Create a new token straight into the clipboard, without printing it: `turso db tokens create <database-name> \| clip` (Git Bash) or `turso db tokens create <database-name> \| Set-Clipboard` (PowerShell). | — |
| A6 | Paste it into Vercel `TURSO_AUTH_TOKEN` for **Production**. Use a **separate** database and token for Preview if possible, so preview deployments never touch production data. Clear the clipboard afterwards. | Vercel shows the variable updated |
| A7 | Redeploy Production (Vercel → Deployments → Redeploy). | Sign-in works; Super Admin pages load |
| A8 | Update `.env.local` on each development PC (paste from the clipboard; never echo it). | `node scripts/backup-turso-snapshot.cjs` works locally |
| A9 | Delete `seed-users.mjs` from the repository in a normal commit, which leaves history unchanged. Decide separately whether to rewrite history; after A4 it is no longer urgent. | `git ls-files seed-users.mjs` prints nothing |
| A10 | Optional: confirm the old token is refused. Only the owner should run this, against production, with a read query only. | 401 / "unauthorized" |

Also consider rotating `SESSION_SECRET`, which signs everyone out, if there is any doubt about where `.env.local` has been copied. Turn on GitHub secret scanning for the repository.

---

## B. Move the plaintext FBR and AI keys to encrypted storage (audit H2)

**Current state** (read-only count on 12 Nov 2026, no values read):
- 3 FBR sandbox tokens and 2 FBR production tokens are stored as plain text in `settings`;
- 3 AI keys are stored as plain text;
- 1 business already uses encrypted FBR storage.

Phase 1 (C1) stops other businesses from reading them through `/api/db`, but they are still plain text at rest.

| # | Step | Check |
|---|---|---|
| B1 | Make sure `FBR_TOKEN_KEY` is set in Vercel Production. **Keep a copy in your password manager:** if it is lost, every business re-enters its tokens. | Super Admin → FBR Integration → Token storage: "Encrypted" |
| B2 | For each business with FBR: Super Admin → Tenants → business → FBR setup. Re-enter its token(s) and **Save**. Saving stores them encrypted **and deletes the plaintext copies** (`src/server/fbr/service.ts` `saveTokens`). Just opening the page copies an old token into encrypted storage but leaves the plaintext. | "Token test" still passes for that business |
| B3 | Recount, numbers only: plaintext FBR tokens left in `settings` should be **0**. I can run this read-only count on request. | 0 |
| B4 | **AI keys:** there is no encrypted store for them yet. Choose one: (a) one platform key held only in a Vercel environment variable, with the per-business keys removed; or (b) a small change that encrypts them with `FBR_TOKEN_KEY` the same way. Until then, keep them server-only, which they are (`SERVER_ONLY_SETTINGS`). | Your decision |
| B5 | **Rotate** any FBR or AI key that was stored in plain text, because it may have been readable through C1 before the fix. Ask PRAL for new FBR tokens, create new AI keys, and enter them through the screens. | Old keys revoked at the provider |

---

## C. Upgrade Next.js (audit H1)

**Installed:** `next@16.3.5`.

**Verified against the advisories** (GitHub Advisory Database pages, plus `npm audit`, which reads the same database; checked 12 Nov 2026):

| Advisory | Severity | Affected | First fixed |
|---|---|---|---|
| GHSA-vcvr-r3jv-pc5j: RCE in `next/og` `ImageResponse` | Critical | >= 16.2.0, < 16.3.6 | **16.3.6** |
| GHSA-2464-fhr4-w9xw: RCE in the image optimizer with SVG | Critical | >= 16.0.0, <= 16.4.0 | **16.4.1** |
| GHSA-673q-mjm6-r5xr: RCE in `use cache` functions | Critical | >= 16.0.0, <= 16.4.0 | **16.4.1** |
| GHSA-p3m5-59mp-jv5r: denial of service with Server Actions | High | >= 16.0.0, <= 16.4.0 | (above 16.4.0) |
| GHSA-cjq9-62q9-8jv4, GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p, GHSA-f87g-xv8r-7p7x, GHSA-3w37-wq28-93x7, GHSA-h694-7cp9-m8p3, GHSA-39w2-rjm5-chcv | High / moderate / low | up to < 16.3.8 | 16.3.8 |

**Recommendation: `next@16.4.6`.**
- It is the current `latest` on npm, published 9 Nov 2026.
- It is in the same 16.4 line as the first release that fixes everything (16.4.1).
- `npm audit` reports it as the fix for all 11 advisories.
- **Reachable in MAVIN:** only `next/og`, through the public route `src/app/site/og/route.server.tsx`.
- **Not reachable:** the image optimizer (`images.unoptimized`), `use cache` and Server Actions are not used. They are fixed by the same upgrade anyway.

| # | Step | Check |
|---|---|---|
| C1 | On a branch: `npm install next@16.4.6` (and `eslint-config-next@16.4.6` if it is a dependency). | `npm ls next` shows 16.4.6 |
| C2 | `npm audit --omit=dev` | No `next` entry; the `sharp` advisory needs sharp >= 0.35.5 and comes with the upgrade or a fresh install |
| C3 | `npm test`, `npx tsc --noEmit`, `npm run build` | All pass |
| C4 | Deploy to **Preview** first. Open `/og/?t=Test`, sign in, make a sale, open reports. | All work |
| C5 | Promote to Production. | Same checks on app.mavin.pk |
| C6 | Rebuild the desktop apps afterwards (`desktop`, `desktop-standalone`): they bundle the same web code. | The installers build |

---

## What phase 1 changes (for the deploy)

The branch `security/phase1-sql-scope` changes code only: there is **no migration** and no new setting. Deploy it together with C, or right after.

After deploying, staff logins that lack the Purchase, Suppliers or Reports section can no longer open purchases. Staff without "See purchase rate while billing" (or the Purchase or Reports section) no longer receive purchase prices. If someone needs these, grant them in Staff → permissions.
