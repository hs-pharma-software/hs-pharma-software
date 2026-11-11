// Writes resources/schema.sql: the server database's structure (every
// schema_sql_vN in src-tauri/src/lib.rs, in order), so the desktop's
// read-only copy has exactly the tables and columns the web screens query.
const fs = require("fs");
const path = require("path");
const rs = fs.readFileSync(path.join(__dirname, "..", "..", "src-tauri", "src", "lib.rs"), "utf8");
const parts = [];
for (let v = 1; ; v++) {
  const name = v === 1 ? "schema_sql" : `schema_sql_v${v}`;
  const m = new RegExp(`fn ${name}\\(\\)[^{]*\\{\\s*r#"([\\s\\S]*?)"#`).exec(rs);
  if (!m) break;
  // Each version ends its own last statement (one of them has no closing ";").
  parts.push(`-- ${name}\n${m[1]}\n;`);
}
fs.mkdirSync(path.join(__dirname, "..", "resources"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "..", "resources", "schema.sql"), parts.join("\n"));
console.log(`schema.sql: ${parts.length} versions`);
