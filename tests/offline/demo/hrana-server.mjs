// A local stand-in for Turso (test/demo only): the Hrana-over-HTTP pipeline
// the server's @libsql/client/web speaks, backed by a SQLite FILE through
// node:sqlite. Lets the real MAVIN web server run against demo data, never
// production.  node tests/offline/demo/hrana-server.mjs <dbFile> <port>
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

const [file, port] = [process.argv[2], Number(process.argv[3] ?? 8089)];
const db = new DatabaseSync(file);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const fromArg = (a) => {
  if (!a || a.type === "null") return null;
  if (a.type === "integer") return BigInt(a.value) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(a.value) >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(a.value) : BigInt(a.value);
  if (a.type === "float") return Number(a.value);
  if (a.type === "text") return a.value;
  if (a.type === "blob") return Buffer.from(a.base64, "base64");
  return null;
};
const toValue = (v) => {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "bigint") return { type: "integer", value: v.toString() };
  if (typeof v === "number") return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  if (typeof v === "string") return { type: "text", value: v };
  if (v instanceof Uint8Array) return { type: "blob", base64: Buffer.from(v).toString("base64") };
  return { type: "text", value: String(v) };
};

/** SQL the client stored once and now refers to by number (store_sql / sql_id). */
const stored = new Map();

function execute(stmt) {
  const st = db.prepare(stmt.sql ?? stored.get(stmt.sql_id));
  const args = stmt.named_args?.length
    ? Object.fromEntries(stmt.named_args.map((n) => [n.name.replace(/^[:@$]/, ""), fromArg(n.value)]))
    : (stmt.args ?? []).map(fromArg);
  const reader = typeof st.columns === "function" ? st.columns() : [];
  if (reader.length) {
    const rows = Array.isArray(args) ? st.all(...args) : st.all(args);
    const cols = reader.map((c) => ({ name: c.name, decltype: c.type ?? null }));
    return { cols, rows: rows.map((r) => cols.map((c) => toValue(r[c.name]))), affected_row_count: 0, last_insert_rowid: null };
  }
  const r = Array.isArray(args) ? st.run(...args) : st.run(args);
  return { cols: [], rows: [], affected_row_count: Number(r.changes), last_insert_rowid: r.lastInsertRowid == null ? null : String(r.lastInsertRowid) };
}

function evalCond(c, outcomes) {
  if (!c) return true;
  switch (c.type) {
    case "ok": return outcomes[c.step] === "ok";
    case "error": return outcomes[c.step] === "error";
    case "not": return !evalCond(c.cond, outcomes);
    case "and": return (c.conds ?? []).every((x) => evalCond(x, outcomes));
    case "or": return (c.conds ?? []).some((x) => evalCond(x, outcomes));
    case "is_autocommit": return db.isTransaction === undefined ? true : !db.isTransaction;
    default: return false;
  }
}

function handle(req) {
  try {
    switch (req.type) {
      case "execute": return { type: "ok", response: { type: "execute", result: execute(req.stmt) } };
      case "batch": {
        const outcomes = [];
        const step_results = [];
        const step_errors = [];
        for (const s of req.batch.steps) {
          if (!evalCond(s.condition, outcomes)) { outcomes.push(null); step_results.push(null); step_errors.push(null); continue; }
          try { step_results.push(execute(s.stmt)); step_errors.push(null); outcomes.push("ok"); } catch (e) { step_results.push(null); step_errors.push({ message: e.message }); outcomes.push("error"); }
        }
        return { type: "ok", response: { type: "batch", result: { step_results, step_errors } } };
      }
      case "sequence": db.exec(req.sql ?? stored.get(req.sql_id)); return { type: "ok", response: { type: "sequence" } };
      case "store_sql": stored.set(req.sql_id, req.sql); return { type: "ok", response: { type: "store_sql" } };
      case "close_sql": stored.delete(req.sql_id); return { type: "ok", response: { type: "close_sql" } };
      case "get_autocommit": return { type: "ok", response: { type: "get_autocommit", is_autocommit: true } };
      case "close": return { type: "ok", response: { type: "close" } };
      case "describe": return { type: "ok", response: { type: "describe", result: { params: [], cols: [], is_explain: false, is_readonly: true } } };
      default: return { type: "error", error: { message: `unsupported ${req.type}` } };
    }
  } catch (e) {
    return { type: "error", error: { message: e.message, code: "SQLITE_ERROR" } };
  }
}

createServer(async (req, res) => {
  if (req.method === "GET") { res.writeHead(req.url.startsWith("/v2") ? 200 : 404).end(); return; }
  let raw = "";
  for await (const c of req) raw += c;
  if (!/\/v[23]\/pipeline$/.test(req.url)) { res.writeHead(404).end(); return; }
  const body = JSON.parse(raw || "{}");
  const results = (body.requests ?? []).map(handle);
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ baton: null, base_url: null, results }));
}).listen(port, "127.0.0.1", () => console.log(`demo database on ${port} (${file})`));
