/**
 * inspect-turso.cjs  (read-only)
 *
 * Checks the Turso database against what the code needs: every clinic, hospital
 * and pharmacy-mailbox table, the columns that must exist / must be optional, and
 * a fingerprint of the pharmacy data (row counts and money / stock totals) so a
 * migration can be proven not to have touched it. Never prints credentials.
 *
 *   node scripts/inspect-turso.cjs                       report
 *   node scripts/inspect-turso.cjs --save=before.json    also save the pharmacy fingerprint
 *   node scripts/inspect-turso.cjs --compare=before.json compare the fingerprint with a saved one
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(fs.readFileSync(envPath, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};
const url = ((env.TURSO_DATABASE_URL || env.NEXT_PUBLIC_TURSO_DATABASE_URL) ?? '').replace('libsql://', 'https://');
const token = (env.TURSO_AUTH_TOKEN || env.NEXT_PUBLIC_TURSO_AUTH_TOKEN) ?? '';
if (!url || !token) { console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (or the NEXT_PUBLIC_TURSO_* pair) in .env.local'); process.exit(1); }
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=').slice(1).join('=');

async function run(sql) {
  const res = await fetch(`${url}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args: [] } }, { type: 'close' }] }),
  });
  const data = await res.json();
  const r = data.results?.[0];
  if (!r || r.type === 'error') throw new Error(r?.error?.message ?? 'request failed');
  return r.response.result.rows.map((row) => row.map((c) => (c.type === 'null' ? null : c.value)));
}

// Tables the clinic / hospital / mailbox code uses, and columns it relies on.
const REQUIRED = {
  clinic_patients: ['tenant_id', 'mrn', 'name'],
  clinic_doctors: ['tenant_id', 'name', 'consultation_fee'],
  clinic_appointments: ['tenant_id', 'patient_id', 'doctor_id', 'date', 'status'],
  clinic_consultations: ['tenant_id', 'appointment_id', 'patient_id', 'doctor_id'],
  clinic_prescriptions: ['tenant_id', 'consultation_id', 'patient_id', 'doctor_id', 'status'],
  clinic_rx_items: ['tenant_id', 'prescription_id', 'product_name', 'qty'],
  clinic_pharmacy_link: ['clinic_tenant_id', 'pharmacy_tenant_id'],
  pharmacy_rx_notifications: ['pharmacy_tenant_id', 'clinic_tenant_id', 'prescription_id', 'rx_notes'],
  pharmacy_rx_items: ['pharmacy_tenant_id', 'clinic_tenant_id', 'prescription_id', 'deleted_at'],
  hospital_patients: ['tenant_id', 'mr_no', 'name'],
  hospital_services: ['tenant_id', 'code', 'rate'],
  hospital_episodes: ['tenant_id', 'episode_no', 'patient_id', 'status'],
  hospital_charges: ['tenant_id', 'episode_id', 'amount'],
  hospital_payments: ['tenant_id', 'episode_id', 'type', 'amount'],
  hospital_departments: ['tenant_id', 'name', 'is_active'],
  hospital_lab_orders: ['tenant_id', 'order_no', 'patient_id', 'test_name'],
  hospital_imaging_orders: ['tenant_id', 'order_no', 'patient_id', 'modality'],
};
// Columns that must accept NULL (walk-ins, consultations without appointment...).
const OPTIONAL = { clinic_appointments: ['doctor_id'], clinic_consultations: ['appointment_id', 'doctor_id'], clinic_prescriptions: ['doctor_id'] };
// Pharmacy data that a clinic / hospital migration must never change.
const PHARMACY = ['tenants', 'users', 'products', 'product_batches', 'price_list', 'customers', 'suppliers', 'invoices', 'invoice_items', 'purchases', 'purchase_items', 'cash_register_entries', 'bank_ledger_entries', 'expenses', 'revenues', 'staff'];
const MONEY = ['total', 'amount', 'qty', 'paid', 'balance', 'sale_price', 'purchase_price'];

(async () => {
  console.log(`Database: ${new URL(url).host} (read-only check)\n`);
  const existing = new Set((await run(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r[0]));

  let problems = 0;
  for (const [t, cols] of Object.entries(REQUIRED)) {
    if (!existing.has(t)) { console.log(`  MISSING table   ${t}`); problems++; continue; }
    const info = await run(`PRAGMA table_info("${t}")`);
    const have = new Map(info.map((r) => [r[1], String(r[3]) === '1']));
    const missing = cols.filter((c) => !have.has(c));
    const stuck = (OPTIONAL[t] ?? []).filter((c) => have.get(c));
    const n = (await run(`SELECT COUNT(*) FROM "${t}"`))[0][0];
    const notes = [missing.length ? `missing column ${missing.join(', ')}` : '', stuck.length ? `${stuck.join(', ')} still NOT NULL` : ''].filter(Boolean);
    if (notes.length) problems++;
    console.log(`  ${notes.length ? 'PROBLEM' : 'ok     '} ${t} (${n} rows)${notes.length ? '  <- ' + notes.join('; ') : ''}`);
  }

  const fingerprint = {};
  for (const t of PHARMACY) {
    if (!existing.has(t)) continue;
    const info = await run(`PRAGMA table_info("${t}")`);
    const sums = MONEY.filter((c) => info.some((r) => r[1] === c));
    const sel = ['COUNT(*)', ...sums.map((c) => `ROUND(COALESCE(SUM("${c}"), 0), 2)`)].join(', ');
    const row = (await run(`SELECT ${sel} FROM "${t}"`))[0];
    fingerprint[t] = { rows: Number(row[0]), ...Object.fromEntries(sums.map((c, i) => [`sum_${c}`, Number(row[i + 1])])) };
  }
  console.log('\nPharmacy data fingerprint:');
  for (const [t, v] of Object.entries(fingerprint)) console.log(`  ${t}: ${Object.entries(v).map(([k, x]) => `${k}=${x}`).join(' ')}`);

  const save = arg('save');
  if (save) { fs.writeFileSync(save, JSON.stringify(fingerprint, null, 2)); console.log(`\nSaved fingerprint to ${save}`); }
  const compare = arg('compare');
  if (compare) {
    const before = JSON.parse(fs.readFileSync(compare, 'utf8'));
    const diffs = Object.keys({ ...before, ...fingerprint }).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(fingerprint[t]));
    console.log(diffs.length ? `\nPHARMACY DATA CHANGED in: ${diffs.join(', ')}` : '\nPharmacy data identical to the saved fingerprint.');
    if (diffs.length) problems++;
  }

  console.log(problems ? `\n${problems} problem(s). Run: node scripts/migrate-turso.cjs --from=34` : '\nAll clinic and hospital tables are present and correct.');
  process.exitCode = problems ? 1 : 0;
})().catch((e) => { console.error(e.message); process.exit(1); });
