const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function edit(file, fn) {
  const p = path.join(root, file);
  const old = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const next = fn(old);
  if (next === old) throw new Error(`No change: ${file}`);
  fs.writeFileSync(p, next);
}
function replace(s, old, next) {
  if (!s.includes(old)) throw new Error(`Missing anchor: ${old.slice(0, 90)}`);
  return s.replace(old, next);
}
edit('src/server/offline/service.ts', s => {
  s = replace(s, '  } else throw new HttpError(400, "Unknown table.");\n  const rows =', '  } else throw new HttpError(400, "Unknown table.");\n  if (MIRROR[name] && typeof since === "string" && since) {\n    // Tombstones must reach an incremental cache too.\n    where = where.replace(/ AND deleted_at IS NULL/g, "");\n    where += ` AND updated_at > ?`;\n    args.push(since);\n  }\n  const rows =');
  return replace(s, 'next: more ? from + MIRROR_PAGE : null, cutoff };', 'next: more ? from + MIRROR_PAGE : null, cutoff, syncedAt: now.toISOString() };');
});
edit('desktop/src/core/device.ts', s => replace(s, 'cutoff?: string | null } }>', 'cutoff?: string | null; syncedAt?: string } }>'));
edit('desktop/src/core/mirror.ts', s => {
  s = replace(s, 'cutoff?: string | null }>', 'cutoff?: string | null; syncedAt?: string }>');
  s = replace(s, '    let cutoff: string | null = null;\n    for (let offset:', '    let cutoff: string | null = null;\n    let syncedAt: string | null = null;\n    for (let offset:');
  s = replace(s, '      cutoff = page.cutoff ?? cutoff;', '      cutoff = page.cutoff ?? cutoff;\n      // The earliest page start is safe even when a later page takes minutes.\n      if (page.syncedAt && Number.isFinite(Date.parse(page.syncedAt))) {\n        if (!syncedAt || page.syncedAt < syncedAt) syncedAt = page.syncedAt;\n      }');
  s = replace(s, '    return { rows, cutoff };', '    return { rows, cutoff, syncedAt };');
  const a = s.indexOf('  /** Replaces the cached tables');
  const b = s.indexOf('  /** Recent history', a);
  if (a < 0 || b < 0) throw new Error('refresh anchors');
  s = s.slice(0, a) + `  /** Changed rows after the first copy; a daily full copy catches hard deletes
   * and visibility changes. Older servers keep the full-copy behavior. */
  async refresh(tables: string[], fetchPage: FetchPage, now = new Date()) {
    for (const table of tables) {
      const seen = this.meta(\`mirror_since:\${table}\`);
      const lastFull = this.meta(\`mirror_full:\${table}\`);
      const full = !seen || !lastFull || now.getTime() - Date.parse(lastFull) >= 24 * 3_600_000;
      const since = full ? null : new Date(Date.parse(seen!) - 10 * 60_000).toISOString();
      const got = await this.fetchAll(table, fetchPage, since);
      if (!got) continue;
      this.tx(() => {
        if (full) {
          this.rw.prepare(\`DELETE FROM \${table}\`).run();
          this.rw.prepare(\`DELETE FROM mirror_overlay WHERE tbl = ?\`).run(table);
        }
        const key = table === "settings" ? "key" : "id";
        const gone = got.rows.filter((r) => r.deleted_at != null);
        for (const r of gone) this.rw.prepare(\`DELETE FROM \${table} WHERE \${key} = ?\`).run(String(r[key]));
        this.upsert(table, got.rows.filter((r) => r.deleted_at == null));
        // No watermark means an older server: next time copy in full again.
        if (got.syncedAt) this.setMeta(\`mirror_since:\${table}\`, got.syncedAt);
        if (full) this.setMeta(\`mirror_full:\${table}\`, now.toISOString());
      });
    }
    this.setMeta("refreshed_at", now.toISOString());
  }

` + s.slice(b);
  return replace(s, '        const keep = [seen, newest]', '        const keep = [seen, got.syncedAt, newest]');
});
edit('desktop/src/main.ts', s => {
  s = replace(s, '/** Copied in full each time (small: catalogue, people, settings). */', '/** Incremental after the initial copy; full refresh once daily. */');
  s = replace(s, 'const REPLICA_EVERY_MS = 15_000;', 'const REPLICA_EVERY_MS = 60_000;\nlet replicaFailures = 0;\nlet replicaRetryAt = 0;');
  s = replace(s, 'if (quitting || online === false) return;', 'if (quitting || online === false || Date.now() < replicaRetryAt) return;');
  s = replace(s, '        replicaNote = null;', '        replicaNote = null;\n        replicaFailures = 0;\n        replicaRetryAt = 0;');
  s = replace(s, '        console.error("[copy]",', '        replicaRetryAt = Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(replicaFailures++, 6));\n        console.error("[copy]",');
  s = replace(s, 'let syncing: Promise<void> | null = null;', 'let syncing: Promise<void> | null = null;\nlet syncFailures = 0;\nlet syncRetryAt = 0;');
  s = replace(s, 'if (!device?.provisioned || quitting) return;', 'if (!device?.provisioned || quitting || (!force && Date.now() < syncRetryAt)) return;');
  s = replace(s, '      if (r?.error) console.error("[sync]", r.error);', '      if (!r || r.error) {\n        syncRetryAt = Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(syncFailures++, 6));\n        if (r?.error) console.error("[sync]", r.error);\n        pushStatus();\n        return;\n      }\n      syncFailures = 0;\n      syncRetryAt = 0;');
  s = replace(s, 'await mirror.refresh(MIRROR_TABLES, (t, off) => device.mirrorPage(t, off));', 'await mirror.refresh(MIRROR_TABLES, (t, off, since) => device.mirrorPage(t, off, since));');
  return s;
});
edit('src/lib/queriesClient.ts', s => {
  s = replace(s, 'const POLL_MS = 30_000;', 'const POLL_MS = 5 * 60_000;');
  s = replace(s, 'refreshed every 30 seconds', 'refreshed every five minutes while visible');
  return replace(s, '    const refresh = () => void queriesCall<{ unread: number }>("unread").then((r) => alive && setN(r.unread)).catch(() => undefined);', `    let running = false;
    let failures = 0;
    let retryAt = 0;
    const refresh = async () => {
      if (!alive || running || document.hidden || Date.now() < retryAt) return;
      running = true;
      try {
        const r = await queriesCall<{ unread: number }>("unread");
        if (alive) setN(r.unread);
        failures = 0;
        retryAt = 0;
      } catch {
        retryAt = Date.now() + Math.min(3_600_000, POLL_MS * 2 ** Math.min(failures++, 4));
      } finally { running = false; }
    };`);
});
