/** Client-generated UUIDs (instead of autoincrement ids) so a row created
 * offline never collides with a row created elsewhere before either has
 * synced. Available natively in the Tauri webview and all modern browsers. */
export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
