/** "no such table" means the database has not been brought up to date: say what to do. */
export function explainMissingTable(err: unknown): Error | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /no such table:\s*([a-z0-9_]+)/i.exec(msg);
  if (!m) return null;
  return new Error(
    `The database is not up to date: table "${m[1]}" is missing. ` +
      `Desktop app: close and reopen it. Web version: run "node scripts/migrate-turso.cjs" once. (${msg})`
  );
}
