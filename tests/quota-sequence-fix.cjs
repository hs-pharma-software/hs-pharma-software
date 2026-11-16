const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function edit(file, fn) { const p = path.join(root, file); const old = fs.readFileSync(p, 'utf8'); const next = fn(old); if (next === old) throw Error(file); fs.writeFileSync(p, next); }
function sub(s, a, b) { if (!s.includes(a)) throw Error(a); return s.replace(a, b); }
edit('src/server/offline/service.ts', s => {
  s = sub(s, '  let cutoff: string | null = null;\n  if (HISTORY[name])', `  let cutoff: string | null = null;
  // A sequence cursor uses the existing (tenant_id, seq) index, avoiding
  // scanning every cached row just to discover that updated_at is unchanged.
  const sequence = typeof since === "string" && /^seq:\\d+$/.test(since) ? Number(since.slice(4)) : null;
  if (!HISTORY[name] && !MIRROR[name]) throw new HttpError(400, "Unknown table.");
  const top = Number((await sql.execute(\`SELECT COALESCE(MAX(seq), 0) AS m FROM data_changes\`)).rows[0]?.m ?? 0);
  const oldest = sequence === null ? 0 : Number((await sql.execute(\`SELECT COALESCE(MIN(seq), 0) AS m FROM data_changes\`)).rows[0]?.m ?? 0);
  const reset = sequence !== null && (sequence > top || (sequence > 0 && oldest > sequence + 1));
  const delta = sequence !== null && !reset;
  const timestamp = sequence === null && typeof since === "string" && since ? since : null;
  if (HISTORY[name])`);
  s = sub(s, 'if (typeof since === "string" && since) { where += ` AND updated_at > ?`; args.push(since); }\n    else where += ` AND deleted_at IS NULL`;', 'if (timestamp) { where += ` AND updated_at > ?`; args.push(timestamp); }\n    else if (!delta) where += ` AND deleted_at IS NULL`;');
  s = sub(s, '  if (MIRROR[name] && typeof since === "string" && since) {', '  if (MIRROR[name] && (timestamp || delta)) {');
  s = sub(s, '    where += ` AND updated_at > ?`;\n    args.push(since);', '    if (timestamp) { where += ` AND updated_at > ?`; args.push(timestamp); }');
  s = sub(s, '  const rows = (await sql.execute(`SELECT * FROM ${name} WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`,', `  if (delta) {
    const key = name === "settings" ? "key" : "id";
    where += \` AND \${key} IN (
      SELECT row_id FROM data_changes WHERE tenant_id = ? AND seq > ? AND seq <= ? AND tbl = ?
      UNION SELECT row_id FROM data_changes WHERE tenant_id IS NULL AND seq > ? AND seq <= ? AND tbl = ?
    )\`;
    args.push(d.tenant_id, sequence, top, name, sequence, top, name);
  }
  const rows = (await sql.execute(\`SELECT * FROM \${name} WHERE \${where} ORDER BY rowid LIMIT ? OFFSET ?\`,`);
  return sub(s, 'cutoff, syncedAt: now.toISOString() };', 'cutoff, syncedAt: now.toISOString(), changeCursor: `seq:${top}`, reset };');
});
for (const file of ['desktop/src/core/device.ts', 'desktop/src/core/mirror.ts']) {
  edit(file, s => sub(s, 'syncedAt?: string', 'syncedAt?: string; changeCursor?: string; reset?: boolean'));
}
edit('desktop/src/core/mirror.ts', s => {
  s = sub(s, '    let syncedAt: string | null = null;', '    let syncedAt: string | null = null;\n    let changeCursor: string | null = null;\n    let reset = false;');
  s = sub(s, '      offset = page.next;', `      if (page.changeCursor && /^seq:\\d+$/.test(page.changeCursor)) {
        if (!changeCursor || Number(page.changeCursor.slice(4)) < Number(changeCursor.slice(4))) changeCursor = page.changeCursor;
      }
      reset ||= !!page.reset;
      offset = page.next;`);
  s = sub(s, 'return { rows, cutoff, syncedAt };', 'return { rows, cutoff, syncedAt, changeCursor, reset };');
  s = sub(s, 'const since = full ? null : new Date(Date.parse(seen!) - 10 * 60_000).toISOString();', 'const since = full ? null : this.meta(`mirror_cursor:${table}`) ?? new Date(Date.parse(seen!) - 10 * 60_000).toISOString();');
  s = sub(s, '        if (full) {', '        if (full || got.reset) {');
  s = sub(s, '        if (full) this.setMeta(`mirror_full:${table}`, now.toISOString());', '        if (got.changeCursor) this.setMeta(`mirror_cursor:${table}`, got.changeCursor);\n        if (full || got.reset) this.setMeta(`mirror_full:${table}`, now.toISOString());');
  s = sub(s, 'const since = full ? null : new Date(Date.parse(seen!) - margin).toISOString();', 'const since = full ? null : this.meta(`hist_cursor:${table}`) ?? new Date(Date.parse(seen!) - margin).toISOString();');
  // The remaining full branch belongs to refreshHistory.
  s = sub(s, '        if (full) {', '        if (full || got.reset) {');
  return sub(s, '        if (full) this.setMeta(`hist_full:${table}`, now.toISOString());', '        if (got.changeCursor) this.setMeta(`hist_cursor:${table}`, got.changeCursor);\n        if (full || got.reset) this.setMeta(`hist_full:${table}`, now.toISOString());');
});
