/** The app's complete local schema (every migration v1..v29 from
 * src-tauri/src/lib.rs, in order) in an in-memory SQLite database. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const RS = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
function schema(n: number): string {
  const name = n === 1 ? "schema_sql" : `schema_sql_v${n}`;
  const m = new RegExp(`fn ${name}\\(\\)[^{]*\\{\\s*r#"([\\s\\S]*?)"#`).exec(RS);
  if (!m) throw new Error(`${name} not found`);
  return m[1];
}

/** Applies one migration (schema_sql_v<n>) to an existing database. */
export function applySchema(db: DatabaseSync, n: number): void {
  db.exec(schema(n));
}

export function fullSchemaDb(upTo = 40): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (let v = 1; v <= upTo; v++) db.exec(schema(v));
  return db;
}
