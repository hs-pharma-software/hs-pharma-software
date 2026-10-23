/**
 * categorize-products.cjs
 *
 * Audits all existing products in Turso and classifies them as:
 *   pharma        — pharmaceutical product (medicines, medical supplies)
 *   general_store — FMCG / household / personal-care / non-pharmaceutical
 *   uncertain     — insufficient data, requires manual review
 *
 * Outputs a detailed report (console + JSON file).
 *
 * Flags:
 *   --apply       Apply catalog_group + product_classification to the DB
 *   --report-only (default) Only print the report, no DB changes
 *   --output=PATH Write JSON report to this path (default: scripts/product-audit.json)
 *
 * Usage:
 *   node scripts/categorize-products.cjs
 *   node scripts/categorize-products.cjs --apply
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ── Credentials ────────────────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.existsSync(envPath)
  ? Object.fromEntries(
      fs.readFileSync(envPath, 'utf8')
        .split('\n')
        .filter(l => l.includes('='))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    )
  : {};

const TURSO_URL   = (env.NEXT_PUBLIC_TURSO_DATABASE_URL ?? '').replace('libsql://', 'https://');
const TURSO_TOKEN = env.NEXT_PUBLIC_TURSO_AUTH_TOKEN ?? '';
if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('Missing TURSO credentials in .env.local');
  process.exit(1);
}

// ── CLI flags ───────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const APPLY       = args.includes('--apply');
const outputArg   = args.find(a => a.startsWith('--output='));
const OUTPUT_PATH = outputArg
  ? outputArg.split('=')[1]
  : path.join(__dirname, 'product-audit.json');

// ── DB helpers ──────────────────────────────────────────────────────────────
async function query(sql, params = []) {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args: params.map(v => ({ type: v === null ? 'null' : 'text', value: v === null ? null : String(v) })) } },
        { type: 'close' },
      ],
    }),
  });
  const data = await res.json();
  const result = data.results?.[0];
  if (result?.type === 'error') throw new Error(`SQL error: ${result.error?.message}\nSQL: ${sql.slice(0, 120)}`);
  const cols = result?.response?.result?.cols ?? [];
  const rows = result?.response?.result?.rows ?? [];
  return rows.map(row =>
    Object.fromEntries(cols.map((c, i) => [c.name, row[i]?.value ?? null]))
  );
}

async function execute(sql, params = []) {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args: params.map(v => ({ type: v === null ? 'null' : 'text', value: v === null ? null : String(v) })) } },
        { type: 'close' },
      ],
    }),
  });
  const data = await res.json();
  const result = data.results?.[0];
  if (result?.type === 'error') {
    const msg = result.error?.message ?? '';
    if (msg.includes('duplicate column') || msg.includes('already exists')) return 'skipped';
    throw new Error(`SQL error: ${msg}\nSQL: ${sql.slice(0, 120)}`);
  }
  return 'ok';
}

// ── Classification keywords ────────────────────────────────────────────────
// Keywords in product name / description / company that strongly indicate
// a PHARMACEUTICAL product.
const PHARMA_KEYWORDS = [
  // Dosage forms
  'tablet', 'capsule', 'syrup', 'injection', 'injectable', 'infusion', 'suspension',
  'solution', 'ointment', 'cream', 'gel', 'drops', 'inhaler', 'suppository',
  'patch', 'sachet', 'granule', 'powder', 'ampoule', 'vial',
  // Medical / pharmacy terms
  'mg', 'mcg', 'ml ', 'iu ', 'u/', 'antibiotic', 'antifungal', 'antiviral',
  'analgesic', 'antipyretic', 'antiseptic', 'antihistamine', 'antacid',
  'antihypertensive', 'antidiabetic', 'antidepressant', 'antipsychotic',
  'vitamin', 'mineral', 'supplement', 'medicine', 'pharma', 'drug',
  'bandage', 'dressing', 'glove', 'syringe', 'needle', 'canula', 'cannula',
  'stethoscope', 'glucometer', 'strip', 'lancet', 'bp monitor', 'oximeter',
  'nebulizer', 'thermometer', 'surgical', 'gauze', 'cotton', 'iv set',
  'drap reg', 'generic', 'branded',
  // Common medicine names / active ingredients
  'paracetamol', 'ibuprofen', 'aspirin', 'omeprazole', 'metformin',
  'amoxicillin', 'ciprofloxacin', 'azithromycin', 'metronidazole',
  'diclofenac', 'ranitidine', 'pantoprazole', 'atenolol', 'amlodipine',
  'cefixime', 'clarithromycin', 'clindamycin', 'doxycycline', 'erythromycin',
  'fluconazole', 'ketoconazole', 'salbutamol', 'budesonide', 'prednisolone',
  'dexamethasone', 'hydrocortisone', 'loperamide', 'domperidone', 'ondansetron',
  'metoclopramide', 'losartan', 'enalapril', 'simvastatin', 'atorvastatin',
  'insulin', 'thyroxine', 'levothyroxine', 'folic acid', 'iron', 'calcium',
  'zinc', 'magnesium', 'b12', 'b6', 'b1', 'c vitamin', 'ascorbic',
  'alprazolam', 'diazepam', 'tramadol', 'codeine', 'morphine',
  'panadol', 'brufen', 'flagyl', 'augmentin', 'septran', 'disprin',
  'ponstan', 'voltaren', 'mobic', 'nexum', 'losec', 'zantac', 'zithromax',
];

// Keywords that strongly indicate a GENERAL STORE (non-pharmaceutical) product.
const GENERAL_STORE_KEYWORDS = [
  'biscuit', 'cookie', 'snack', 'chips', 'juice', 'drink', 'beverage', 'water',
  'soft drink', 'cola', 'pepsi', 'sprite', 'fanta', 'tea', 'coffee', 'milk',
  'rice', 'flour', 'oil', 'ghee', 'sugar', 'salt', 'spice', 'masala', 'sauce',
  'ketchup', 'jam', 'pickle', 'honey', 'noodle', 'pasta', 'bread',
  'shampoo', 'conditioner', 'soap', 'face wash', 'moisturizer', 'lotion',
  'toothpaste', 'toothbrush', 'razor', 'deo', 'deodorant', 'perfume', 'cologne',
  'tissue', 'toilet paper', 'napkin', 'wipe', 'diaper', 'sanitary',
  'detergent', 'bleach', 'phenyl', 'dishwash', 'floor cleaner', 'air freshener',
  'candle', 'match', 'lighter', 'torch', 'battery', 'bulb', 'wire',
  'pen', 'pencil', 'notebook', 'stationery', 'tape', 'glue',
  'toy', 'game', 'doll', 'ball',
  'pouch', 'bag', 'wallet', 'belt',
  // FMCG brands
  'nestle', 'unilever', 'p&g', 'colgate', 'palmolive', 'reckitt', 'henkel',
  'head & shoulders', 'dove', 'lux', 'lifebuoy', 'closeup', 'pepsodent',
  'surf', 'ariel', 'omo', 'vanish', 'comfort', 'dettol', 'savlon',
  'lay\'s', 'kurkure', 'nimco', 'mitchells', 'shezan', 'national foods',
  'shan', 'ahmed', 'mehran', 'knorr', 'maggi', 'wall\'s', 'igloo', 'movenpick',
];

// HS code prefixes that indicate pharma
const PHARMA_HS_PREFIXES = ['3001', '3002', '3003', '3004', '3005', '3006',
  '9018', '9019', '9020', '9021', '9022', '3822', '3824'];

// HS code prefixes that indicate non-pharma / general store
const GENERAL_HS_PREFIXES = ['0', '1', '2', '3301', '3302', '3303', '3304',
  '3305', '3306', '3307', '3401', '3402', '3407', '3924', '4818', '4819',
  '4820', '4823', '6217', '6302', '6304', '7610', '8506', '8513', '8531',
  '9503', '9504', '9505', '9608', '9609'];

function classify(p) {
  const text = [
    p.name, p.description, p.company_name, p.category_name, p.sub_category_name,
  ].join(' ').toLowerCase();

  const hsCode = (p.hs_code ?? '').replace('.', '');

  // Check HS code first (most reliable)
  if (hsCode) {
    if (PHARMA_HS_PREFIXES.some(pfx => hsCode.startsWith(pfx.replace('.', '')))) {
      return { classification: 'pharma', confidence: 'high', reason: `HS code ${p.hs_code}` };
    }
    if (GENERAL_HS_PREFIXES.some(pfx => hsCode.startsWith(pfx.replace('.', '')))) {
      return { classification: 'general_store', confidence: 'high', reason: `HS code ${p.hs_code}` };
    }
  }

  // Check FBR sale type
  const fbr = (p.fbr_sale_type ?? '').toLowerCase();
  if (fbr && (fbr.includes('pharma') || fbr.includes('exempt') || fbr.includes('reduced'))) {
    // Exempt / reduced rate usually means medicine
    // (but not conclusive — some general items are also exempt)
  }

  // Check DRAP registration (always pharma)
  if (p.drap_reg_no) {
    return { classification: 'pharma', confidence: 'high', reason: 'Has DRAP registration' };
  }

  // Check is_narcotic
  if (Number(p.is_narcotic) === 1) {
    return { classification: 'pharma', confidence: 'high', reason: 'Narcotic / controlled drug' };
  }

  // Keyword matching
  const pharmaScore  = PHARMA_KEYWORDS.filter(k => text.includes(k)).length;
  const generalScore = GENERAL_STORE_KEYWORDS.filter(k => text.includes(k)).length;

  if (pharmaScore > 0 && pharmaScore > generalScore) {
    const matched = PHARMA_KEYWORDS.filter(k => text.includes(k)).slice(0, 3).join(', ');
    return { classification: 'pharma', confidence: pharmaScore >= 2 ? 'high' : 'medium', reason: `Keywords: ${matched}` };
  }
  if (generalScore > 0 && generalScore > pharmaScore) {
    const matched = GENERAL_STORE_KEYWORDS.filter(k => text.includes(k)).slice(0, 3).join(', ');
    return { classification: 'general_store', confidence: generalScore >= 2 ? 'high' : 'medium', reason: `Keywords: ${matched}` };
  }

  // Ambiguous
  return { classification: 'uncertain', confidence: 'low', reason: 'Insufficient data for automatic classification' };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Billora Product Catalog Audit ===\n');

  // Fetch all products (including NULL-tenant quarantined rows)
  const products = await query(`
    SELECT
      p.id, p.name, p.company_name, p.description, p.barcode,
      p.hs_code, p.fbr_sale_type, p.is_narcotic, p.drap_reg_no,
      p.catalog_group, p.product_classification,
      p.tenant_id, p.deleted_at,
      c.name AS category_name, sc.name AS sub_category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN sub_categories sc ON sc.id = p.sub_category_id
    ORDER BY p.name
  `);

  const active = products.filter(p => !p.deleted_at);
  console.log(`Total product rows: ${products.length}`);
  console.log(`Active (not deleted): ${active.length}`);
  console.log(`Deleted: ${products.length - active.length}\n`);

  const report = [];
  let nPharma = 0, nGeneral = 0, nUncertain = 0, nAlreadySet = 0, nDeleted = 0;

  for (const p of products) {
    if (p.deleted_at) {
      nDeleted++;
      report.push({ id: p.id, name: p.name, tenant_id: p.tenant_id, status: 'deleted', classification: null, confidence: null, reason: 'Soft-deleted' });
      continue;
    }

    if (p.catalog_group || p.product_classification) {
      // Already classified by v31 or manually
      nAlreadySet++;
      report.push({ id: p.id, name: p.name, tenant_id: p.tenant_id, status: 'already_set', classification: p.product_classification ?? p.catalog_group, confidence: 'n/a', reason: 'Already has catalog_group / product_classification' });
      continue;
    }

    const result = classify(p);
    const row = {
      id: p.id, name: p.name, company: p.company_name, tenant_id: p.tenant_id,
      category: p.category_name, sub_category: p.sub_category_name,
      hs_code: p.hs_code, drap_reg_no: p.drap_reg_no, is_narcotic: p.is_narcotic,
      status: 'classified',
      ...result,
    };
    report.push(row);

    if (result.classification === 'pharma')        nPharma++;
    else if (result.classification === 'general_store') nGeneral++;
    else                                            nUncertain++;
  }

  // Print summary
  console.log('── Classification Summary ──────────────────────────────────────');
  console.log(`  Pharma:             ${nPharma}`);
  console.log(`  General Store:      ${nGeneral}`);
  console.log(`  Uncertain (review): ${nUncertain}`);
  console.log(`  Already classified: ${nAlreadySet}`);
  console.log(`  Deleted (skipped):  ${nDeleted}`);
  console.log(`  TOTAL:              ${products.length}`);
  console.log();

  // Print uncertain items for manual review
  const uncertain = report.filter(r => r.classification === 'uncertain');
  if (uncertain.length) {
    console.log(`── ${uncertain.length} Products requiring manual review ──────────────────`);
    uncertain.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.id}] ${r.name}${r.company ? ` (${r.company})` : ''}`);
      console.log(`     Category: ${r.category ?? '—'}  |  HS: ${r.hs_code ?? '—'}`);
      console.log(`     Reason: ${r.reason}`);
    });
    console.log();
  }

  // Print duplicate candidates (products with same name, case-insensitive)
  const nameMap = {};
  for (const r of report) {
    if (!r.name || r.status === 'deleted') continue;
    const key = r.name.trim().toUpperCase();
    (nameMap[key] = nameMap[key] ?? []).push(r);
  }
  const duplicates = Object.entries(nameMap).filter(([, rows]) => rows.length > 1);
  if (duplicates.length) {
    console.log(`── ${duplicates.length} Potential Duplicate Product Name(s) ─────────────────`);
    duplicates.forEach(([name, rows]) => {
      console.log(`  "${name}" appears ${rows.length} times:`);
      rows.forEach(r => console.log(`    [${r.id}] tenant: ${r.tenant_id ?? 'unowned'} | ${r.classification ?? '?'}`));
    });
    console.log();
  }

  // Write JSON report
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), summary: { total: products.length, pharma: nPharma, general_store: nGeneral, uncertain: nUncertain, already_set: nAlreadySet, deleted: nDeleted, duplicateCandidates: duplicates.length }, report }, null, 2));
  console.log(`Full report written to: ${OUTPUT_PATH}`);

  // Apply changes
  if (APPLY) {
    console.log('\n── Applying catalog_group + product_classification ────────────');
    let applied = 0, skipped = 0;
    const now = new Date().toISOString();
    for (const r of report) {
      if (r.status !== 'classified' || r.classification === 'uncertain') {
        skipped++;
        continue;
      }
      const res = await execute(
        `UPDATE products SET catalog_group = ?, product_classification = ?, updated_at = ? WHERE id = ? AND catalog_group IS NULL AND product_classification IS NULL`,
        [r.classification, r.classification, now, r.id]
      );
      if (res !== 'skipped') applied++;
    }
    console.log(`  Applied: ${applied}  |  Skipped (uncertain / already set): ${skipped}`);
    console.log('\nDone. Run without --apply to re-check or update uncertain items manually.');
  } else {
    console.log('\nRun with --apply to write catalog_group + product_classification to the DB.');
    console.log('Uncertain items will be skipped; assign them manually after reviewing.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
