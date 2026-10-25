# Database migrations

Pharmacy POS, the Hospital Management System, the Clinic and every other module
share **one Turso (libSQL) database**. There is no separate hospital, clinic or
lab database, and none should be created.

## Where the schema lives

- **The source of truth** is `src-tauri/src/lib.rs`. `schema_sql()` is v1,
  `schema_sql_v2()` … `schema_sql_vN()` are the later versions, and each one is
  registered as a Tauri migration.
- **Desktop app:** applies these versions to its own local `pharmacy.db` at
  startup. Its migration runner tracks them in `_sqlx_migrations`.
- **Shared Turso database:** gets them through `scripts/migrate-turso.cjs`. It
  records each version that verifies in the `schema_migrations` table:
  - `applied`: this script applied it;
  - `schema-verified`: its tables, columns and indexes were found present.
- **Web version (Vercel):** a static export that talks to Turso directly. It
  runs no migrations. A full-access user sees a "Database update needed" banner
  when `schema_migrations` is behind `REQUIRED_SCHEMA_VERSION` in
  `src/lib/schemaVersion.ts`.

Never edit a version that has already been released: desktop installs that
applied it reject a changed migration. Add a new version instead.

## Adding a migration

1. Add `schema_sql_vN()` to `src-tauri/src/lib.rs` and register it in `all_migrations()`.
2. Add `{ version: N, label: '…', statements: rustSchemaStatements(N) }` to
   `scripts/migrate-turso.cjs`.
3. Set `REQUIRED_SCHEMA_VERSION = N` in `src/lib/schemaVersion.ts`.
4. Run `npm test`. `tests/hospital/schema.test.ts` fails if any of these three is missing.

Keep migrations additive:
- add columns as nullable or with a default;
- use `CREATE … IF NOT EXISTS`;
- never drop or rebuild a populated table just to add a column.

SQLite cannot add a foreign key to an existing table without rebuilding it, so
references on added columns are checked in the repository layer (the `refs` of
`createTenantRepo`, which also checks the tenant).

## Applying migrations to Turso: before you push

Vercel deploys on every `git push`. Code that needs a new column fails on the
web until Turso has it. Migrate first, then push.

```
node scripts/backup-turso-snapshot.cjs         # 1. verified backup (read-only)
node scripts/migrate-turso.cjs --check         # 2. read-only: target host + what is missing
node scripts/migrate-turso.cjs --from=<N>      # 3. apply (N = first missing version from step 2)
node scripts/check-turso-schema.cjs            # 4. read-only: confirm "Every table, column and index … is present"
git push                                       # 5. deploy
```

### Check the target database before step 3

- Step 2 prints `Target: Turso <host>`. The host comes from
  `NEXT_PUBLIC_TURSO_DATABASE_URL` in your `.env.local`. Credentials are never
  printed.
- Compare that host with the one the deployment uses. In Vercel, open Project →
  Settings → Environment Variables → `NEXT_PUBLIC_TURSO_DATABASE_URL`.
- Also compare it with the GitHub Actions secret of the same name, which the
  release workflow uses.
- If the hosts differ, run the steps once for each database, each time with
  `.env.local` pointing at that database.
- Running the script on your own computer does not touch any other database.

### What the runner guarantees

- Before applying a version, it skips the parts that already exist (columns,
  tables, indexes).
- The rest of the version runs as **one atomic batch**: all of it is applied,
  or none of it.
- The two versions that rebuild a table (v36, v37) run statement by statement
  and stop at the first error, so a failed copy never reaches its `DROP`.
- After each version, the schema is compared with what the code expects. Only a
  verified version is recorded.
- The exit code is 1 if any statement failed or anything is still missing.
- Running it again is safe: nothing is applied twice.

### Rehearse first

You can run the same runner against a copy instead of Turso:

```
node scripts/migrate-turso.cjs --from=<N> --target-file=backups/turso-snapshot-<stamp>/database.db
```

Run this on a copy of the backup's `database.db`, not the backup itself. The
full rehearsal test also checks that the pharmacy data is unchanged, and runs
POS, clinic and hospital workflows (including admission and discharge) on a
migrated copy:

```
node scripts/backup-turso.cjs
LIVE_REPLICA_DIR=backups/turso-<stamp> npm test
```

## Restoring a backup

Each `backups/turso-snapshot-<stamp>/` folder (git-ignored) contains:
- `database.db`: a standalone SQLite copy;
- `dump.sql`: the same data as SQL statements;
- `manifest.json`: row counts and SHA-256 checksums.

To restore into a **new** Turso database, using the Turso CLI (on Windows, in WSL):

```
turso db create <new-name> --from-file /mnt/d/Pharmacy/hs-pharma-software/backups/turso-snapshot-<stamp>/database.db
```

Then point `NEXT_PUBLIC_TURSO_DATABASE_URL` and the token, in `.env.local` and
in Vercel, at the new database. Never apply `dump.sql` to the live database: it
re-creates tables that already exist there.
