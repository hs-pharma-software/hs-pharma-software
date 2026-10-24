/**
 * inspect-turso.cjs  (read-only)
 *
 * Lists which clinic / hospital / mailbox tables exist in a Turso database, how
 * many rows each has, and whether the columns that must be optional really are.
 * It runs SELECT / PRAGMA statements only and never prints the credentials.
 *
 *   node scripts/inspect-turso.cjs [--target=platform|hospital|clinic]
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(fs.readFileSync(envPath, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};
const TARGET = ((process.argv.find((a) => a.startsWith('--target=')) ?? '--target=platform').split('=')[1] || 'platform').toLowerCase();
const KEYS = {
  platform: ['NEXT_PUBLIC_TURSO_DATABASE_URL', 'NEXT_PUBLIC_TURSO_AUTH_TOKEN'],
  hospital: ['NEXT_PUBLIC_TURSO_HOSPITAL_DATABASE_URL', 'NEXT_PUBLIC_TURSO_HOSPITAL_AUTH_TOKEN'],
  clinic: ['NEXT_PUBLIC_TURSO_CLINIC_DATABASE_URL', 'NEXT_PUBLIC_TURSO_CLINIC_AUTH_TOKEN'],
};
if (!KEYS[TARGET]) { console.error('Unknown --target'); process.exit(1); }
const url = (env[KEYS[TARGET][0]] ?? '').replace('libsql://', 'https://');
const token = env[KEYS[TARGET][1]] ?? '';
if (!url || !token) { console.error(`Missing ${KEYS[TARGET][0]} / ${KEYS[TARGET][1]} in .env.local`); process.exit(1); }

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

const WANTED = [
  'clinic_patients', 'clinic_doctors', 'clinic_appointments', 'clinic_consultations', 'clinic_prescriptions', 'clinic_rx_items',
  'clinic_pharmacy_link', 'pharmacy_rx_notifications', 'pharmacy_rx_items',
  'hospital_patients', 'hospital_services', 'hospital_episodes', 'hospital_charges', 'hospital_payments',
  'hospital_departments', 'hospital_lab_orders', 'hospital_imaging_orders',
];
// Columns that must accept NULL once v36 / v37 are applied.
const MUST_BE_OPTIONAL = { clinic_appointments: ['doctor_id'], clinic_consultations: ['appointment_id', 'doctor_id'], clinic_prescriptions: ['doctor_id'] };

(async () => {
  console.log(`Inspecting the ${TARGET} database (read-only)\n`);
  const existing = new Set((await run(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r[0]));
  let missing = 0;
  for (const t of WANTED) {
    if (!existing.has(t)) { console.log(`  MISSING  ${t}`); missing++; continue; }
    const n = (await run(`SELECT COUNT(*) FROM ${t}`))[0][0];
    let note = '';
    if (MUST_BE_OPTIONAL[t]) {
      const cols = await run(`PRAGMA table_info(${t})`);
      const stuck = MUST_BE_OPTIONAL[t].filter((c) => cols.some((r) => r[1] === c && String(r[3]) === '1'));
      if (stuck.length) note = `  <- ${stuck.join(', ')} still NOT NULL (v36/v37 pending)`;
    }
    console.log(`  ok       ${t}  (${n} rows)${note}`);
  }
  const hasRxNotes = existing.has('pharmacy_rx_notifications') && (await run(`PRAGMA table_info(pharmacy_rx_notifications)`)).some((r) => r[1] === 'rx_notes');
  console.log(`\n  pharmacy_rx_notifications.rx_notes: ${existing.has('pharmacy_rx_notifications') ? (hasRxNotes ? 'ok' : 'MISSING (v38 pending)') : 'n/a'}`);
  console.log(missing ? `\n${missing} table(s) missing: run  node scripts/migrate-turso.cjs  to create them.` : '\nAll tables present.');
})().catch((e) => { console.error(e.message); process.exit(1); });
