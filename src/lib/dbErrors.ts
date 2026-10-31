/** Whether an error says a table or column does not exist yet (a migration
 * not run): SQLite's own words, or the web server's ("Unknown table x",
 * "Table x is not available"). */
export function isMissingSchemaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such (table|column)|has no column named|unknown table|table [a-z0-9_]+ is not available|is not up to date/i.test(msg);
}

/** A missing table or column means the database was not brought up to date: say what to do. */
export function explainMissingTable(err: unknown): Error | null {
  const msg = err instanceof Error ? err.message : String(err);
  const table = /no such table:\s*([a-z0-9_]+)/i.exec(msg);
  const column = /(?:has no column named|no such column:)\s*([a-z0-9_.]+)/i.exec(msg);
  const what = table ? `table "${table[1]}"` : column ? `column "${column[1]}"` : null;
  if (!what) return null;
  return new Error(
    `The database is not up to date: ${what} is missing. ` +
      `Desktop app: close and reopen it. Web version: the administrator backs up the shared database and applies its migrations ` +
      `(node scripts/backup-turso-snapshot.cjs, then node scripts/migrate-turso.cjs --check to see what is missing). (${msg})`
  );
}
