/**
 * Catalog ownership migration against Turso (see src/lib/catalogOwnership.ts).
 *
 *   node --import ./tests/register.mjs scripts/catalog-ownership.ts            # dry run (default): prints the plan, changes nothing
 *   node --import ./tests/register.mjs scripts/catalog-ownership.ts --apply    # backs up, then applies; prints the run id
 *   node --import ./tests/register.mjs scripts/catalog-ownership.ts --rollback <runId>
 *
 * Run `npm run migrate:turso` first (schema v29). Credentials come from
 * .env.local and are never printed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { applyCatalogOwnership, planCatalogOwnership, rollbackCatalogOwnership, type OwnDb } from "../src/lib/catalogOwnership.ts";

const root = join(import.meta.dirname, "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL = String(env.NEXT_PUBLIC_TURSO_DATABASE_URL ?? "").replace("libsql://", "https://");
const TOKEN = String(env.NEXT_PUBLIC_TURSO_AUTH_TOKEN ?? "");
if (!URL || !TOKEN) throw new Error("Missing Turso settings in .env.local");

type Val = { type: string; value?: string };
const arg = (v: unknown): Val =>
  v == null ? { type: "null" } : typeof v === "number" ? (Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v } as never) : { type: "text", value: String(v) };

async function run(sql: string, params: unknown[] = []) {
  const res = await fetch(`${URL}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql, args: params.map(arg) } }, { type: "close" }] }),
  });
  const r = (await res.json()).results[0];
  if (r.type === "error") throw new Error(`${r.error.message} :: ${sql.slice(0, 100)}`);
  return r.response.result as { cols: { name: string }[]; rows: Val[][]; affected_row_count: number };
}

const db: OwnDb = {
  async select<T>(sql: string, params: unknown[] = []) {
    const r = await run(sql, params);
    return r.rows.map((row) => Object.fromEntries(row.map((v, i) => [r.cols[i].name, v.type === "null" ? null : v.type === "integer" || v.type === "float" ? Number(v.value) : v.value]))) as T[];
  },
  async execute(sql: string, params: unknown[] = []) {
    const r = await run(sql, params);
    return { changes: r.affected_row_count };
  },
};

const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--rollback") ? "rollback" : "dry";
const outDir = join(root, "..", "catalog-ownership-runs");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

if (mode === "rollback") {
  const runId = process.argv[process.argv.indexOf("--rollback") + 1];
  if (!runId) throw new Error("Give the run id: --rollback <runId>");
  const n = await rollbackCatalogOwnership(db, runId, new Date().toISOString());
  console.log(`Rolled back ${n} logged change(s) of run ${runId}.`);
} else {
  const plan = await planCatalogOwnership(db);
  const file = join(outDir, `${stamp}-${mode}-plan.json`);
  writeFileSync(file, JSON.stringify(plan, null, 2));
  console.log("Summary per table:", plan.summary);
  console.log(`Shared rows (copied per tenant): ${plan.decisions.filter((d) => d.copies.length).map((d) => `${d.table}:${d.name} -> keeps ${d.owner?.slice(0, 8)}, copies for ${d.copies.map((t) => t.slice(0, 8)).join(", ")}`).join("; ") || "none"}`);
  console.log(`Line re-points: ${plan.repoints.length}, catalog re-points: ${plan.catalogRepoints.length}`);
  console.log(`Quarantined for review: ${plan.decisions.filter((d) => !d.owner).length}`);
  console.log(`Plan written to ${file}`);
  if (mode === "apply") {
    const backup: Record<string, unknown[]> = {};
    for (const t of ["products", "categories", "sub_categories", "uoms", "generic_names"]) backup[t] = await db.select(`SELECT * FROM ${t}`);
    for (const r of plan.repoints) (backup[`${r.table}.${r.column}`] ??= []).push({ id: r.id, [r.column]: r.from });
    const bfile = join(outDir, `${stamp}-backup.json`);
    writeFileSync(bfile, JSON.stringify(backup));
    console.log(`Backup written to ${bfile}`);
    const runId = `catalog-${stamp}-${randomUUID().slice(0, 8)}`;
    const counts = await applyCatalogOwnership(db, plan, { runId, now: new Date().toISOString(), newId: randomUUID });
    console.log(`Applied run ${runId}:`, counts);
    console.log(`Undo with: --rollback ${runId}`);
  }
}
