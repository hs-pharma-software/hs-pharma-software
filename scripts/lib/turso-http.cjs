/**
 * The Turso database in .env.local over its HTTP API. Credentials are read
 * here and never printed; only the host is shown.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '..', '.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};
const URL_ = (env.NEXT_PUBLIC_TURSO_DATABASE_URL ?? '').replace('libsql://', 'https://');
const TOKEN = env.NEXT_PUBLIC_TURSO_AUTH_TOKEN ?? '';

function requireConfig() {
  if (!URL_ || !TOKEN) throw new Error('Missing NEXT_PUBLIC_TURSO_DATABASE_URL or NEXT_PUBLIC_TURSO_AUTH_TOKEN in .env.local');
}

function tursoHost() {
  requireConfig();
  return new URL(URL_).host;
}

const plain = (c) => (c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.value);

/** Runs one statement; returns rows as objects. Throws with the database's message (never the token). */
async function tursoQuery(sql, args = []) {
  requireConfig();
  const res = await fetch(`${URL_}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args: args.map(toArg) } }, { type: 'close' }] }),
  });
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}`);
  const data = await res.json();
  const r = data.results?.[0];
  if (!r || r.type === 'error') throw new Error(r?.error?.message ?? 'request failed');
  const { cols, rows } = r.response.result;
  return rows.map((row) => Object.fromEntries(cols.map((c, i) => [c.name, plain(row[i])])));
}

function toArg(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  return { type: 'text', value: String(v) };
}

module.exports = { tursoQuery, tursoHost };
