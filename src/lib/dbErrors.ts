/** A missing table or column means the database was not brought up to date: say what to do. */
export function explainMissingTable(err: unknown): Error | null {
  const msg = err instanceof Error ? err.message : String(err);
  const table = /no such table:\s*([a-z0-9_]+)/i.exec(msg);
  const column = /(?:has no column named|no such column:)\s*([a-z0-9_.]+)/i.exec(msg);
  const what = table ? `table "${table[1]}"` : column ? `column "${column[1]}"` : null;
  if (!what) return null;
  return new Error(
    `The database is not up to date: ${what} is missing. ` +
      `Desktop app: close and reopen it. Web version: run "node scripts/migrate-turso.cjs" once. (${msg})`
  );
}
