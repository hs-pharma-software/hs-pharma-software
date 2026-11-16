const fs = require('node:fs'); const path = require('node:path');
const p = path.resolve(__dirname, '../src/server/offline/service.ts');
let s = fs.readFileSync(p, 'utf8');
const a = `    where += \` AND \${key} IN (
      SELECT row_id FROM data_changes WHERE tenant_id = ? AND seq > ? AND seq <= ? AND tbl = ?
      UNION SELECT row_id FROM data_changes WHERE tenant_id IS NULL AND seq > ? AND seq <= ? AND tbl = ?
    )\`;
    args.push(d.tenant_id, sequence, top, name, sequence, top, name);`;
const b = `    let changed = \`
      SELECT row_id FROM data_changes WHERE tenant_id = ? AND seq > ? AND seq <= ? AND tbl = ?
      UNION SELECT row_id FROM data_changes WHERE tenant_id IS NULL AND seq > ? AND seq <= ? AND tbl = ?
    \`;
    args.push(d.tenant_id, sequence, top, name, sequence, top, name);
    if (name === "products") {
      // Newly stocked catalogue products become visible through their batch,
      // even when nobody edited the product itself.
      changed += \` UNION SELECT product_id FROM product_batches WHERE tenant_id = ? AND branch_id = ? AND id IN (
        SELECT row_id FROM data_changes WHERE tenant_id = ? AND seq > ? AND seq <= ? AND tbl = 'product_batches'
      )\`;
      args.push(d.tenant_id, d.branch_id, d.tenant_id, sequence, top);
    }
    where += \` AND \${key} IN (\${changed})\`;`;
if (!s.includes(a)) throw Error('anchor');
fs.writeFileSync(p, s.replace(a,b));
