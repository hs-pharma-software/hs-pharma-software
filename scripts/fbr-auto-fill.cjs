/**
 * fbr-auto-fill.cjs
 *
 * Reads all products from Turso and auto-fills FBR fields:
 *   hs_code, fbr_sale_type, fbr_sale_rate, fbr_uom,
 *   sro_no, sro_item_serial_no
 *
 * Rules (Pakistan FBR / Sales Tax Act 1990):
 *  - Registered medicines          → HS 3004.9099, Exempt goods, Eighth Schedule Table 1 item 81
 *  - Antibiotics                   → HS 3004.2000
 *  - Vitamins / Supplements        → HS 3004.5000
 *  - Hormones / Steroids           → HS 3004.3200
 *  - Diagnostic rapid-test kits    → HS 3822.1900, Standard 17%
 *  - Surgical sutures / dressings  → HS 3005.9090, Exempt
 *  - Syringes / Cannulas           → HS 9018.3100, Standard 17%
 *  - Catheters / Urological bags   → HS 9018.3900, Standard 17%
 *  - Orthopaedic braces / slings   → HS 9021.1000, Standard 17%
 *  - Breast pump                   → HS 9018.9000, Standard 17%
 *  - Spinal / Lumbar needles       → HS 9018.3200, Standard 17%
 *  - Herbal / Tinct                → HS 3004.9010, Standard 17%
 *  - Polypropylene suture          → HS 3005.9090, Exempt
 */

const fs = require('fs');
const envPath = require('path').join(__dirname, '..', '.env.local');
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
if (!TURSO_URL || !TURSO_TOKEN) { console.error('Missing Turso env vars'); process.exit(1); }

async function query(sql, args = []) {
  const res = await fetch(`${TURSO_URL}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TURSO_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql, args } }, { type: 'close' }] }),
  });
  const data = await res.json();
  if (data.results?.[0]?.type === 'error') throw new Error(data.results[0].error.message);
  return data.results[0].response.result.rows ?? [];
}

// ── FBR field classifier ──────────────────────────────────────────────────────
function classifyProduct(name, description) {
  const N = (name || '').toUpperCase();
  const D = (description || '').toUpperCase();
  const combined = N + ' ' + D;

  // UOM is almost always "Numbers, pieces, units" for a pharmacy
  const uom = 'Numbers, pieces, units'; // overridden per HS code in main()

  // ── Medical devices / equipment (standard rated 17%) ─────────────────────
  if (/SYRINGE|INSULIN SYRING/.test(combined))
    return { hs: '9018.3110', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };
  if (/CANNULA/.test(combined))
    return { hs: '9018.3990', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };
  if (/CATHETER|FOLEY/.test(combined))
    return { hs: '9018.3990', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };
  if (/BREAST PUMP/.test(combined))
    return { hs: '9018.9090', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };
  if (/SPINAL NEEDLE|LUMBAR PUNCURE|LUMBER PUCTURE/.test(combined))
    return { hs: '9018.3200', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };
  if (/SLING|BRACE|ORTHOPEDIC|POLISLING|POLYSLING/.test(combined))
    return { hs: '9021.1000', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };
  if (/URINE.*BAG|DRAINAGE BAG|URINE DRAINAGE/.test(combined))
    return { hs: '9018.3990', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };

  // ── Diagnostic rapid tests ─────────────────────────────────────────────────
  if (/RAPID TEST|HCV|MALARIA ANTIGEN|TEST CASSETTE|DIAGNOSTIC/.test(combined))
    return { hs: '3822.1900', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };

  // ── Surgical sutures / dressings (exempt) ─────────────────────────────────
  if (/CATGUT|SUTURE|POLYPROPYLENE|PACRYL|TRULENE|UNILENE|SILK BRAIDED|NYLON SUTURE/.test(combined))
    return { hs: '3005.9090', saleType: 'Exempt goods', rate: 0, uom, sro: 'Eighth Schedule Table 1', sroItem: '81' };
  if (/DRESSING|BANDAGE|WOUND WASH/.test(combined))
    return { hs: '3005.9090', saleType: 'Exempt goods', rate: 0, uom, sro: 'Eighth Schedule Table 1', sroItem: '81' };

  // ── Herbal / Tinct / Unregistered ─────────────────────────────────────────
  if (/TINCT|HERBAL|ARQ |UNANI/.test(combined))
    return { hs: '3004.9010', saleType: 'Goods at standard rate (default)', rate: 18, uom, sro: '', sroItem: '' };

  // ── Vitamins / Supplements ────────────────────────────────────────────────
  if (/VITAMIN|ASCORBIC ACID|FOLIC ACID|FOLATE|CALCIUM|VITAMIN C|VITAMIN D|VITAMIN B|IRON|ZINC|SELENIUM|L-ARGININE|OMEGA|FISH OIL/.test(combined))
    return { hs: '3004.5090', saleType: 'Exempt goods', rate: 0, uom, sro: 'Eighth Schedule Table 1', sroItem: '81' };

  // ── Antibiotics ───────────────────────────────────────────────────────────
  if (/AMOXICILLIN|AMOXICLAV|CO-AMOX|CEFTRIAXONE|CEFTRIXONE|CEFIXIME|CEPHRADINE|CIPROFLOXACIN|CIPROFLAXACIN|DOXYCYCLINE|LEVOFLOXACIN|AZITHROMYCIN|CLARITHROMYCIN|METRONIDAZOLE|CLINDAMYCIN|PENICILLIN|OFLOXACIN|MEROPENEM|IMIPENEM|ERTAPENEM|CEFUROXIME/.test(combined))
    return { hs: '3004.2000', saleType: 'Exempt goods', rate: 0, uom, sro: 'Eighth Schedule Table 1', sroItem: '81' };

  // ── Corticosteroids / Steroids ────────────────────────────────────────────
  if (/DEXAMETHASONE|PREDNISOLONE|HYDROCORTISONE|TRIAMCINOLONE|BUDESONIDE|FLUTICASONE|BETAMETHASONE|MOMETASONE|CLOBETASOL/.test(combined))
    return { hs: '3004.3200', saleType: 'Exempt goods', rate: 0, uom, sro: 'Eighth Schedule Table 1', sroItem: '81' };

  // ── Hormones / Endocrine ──────────────────────────────────────────────────
  if (/INSULIN|METFORMIN|SITAGLIPTIN|GLIPIZIDE|GLIBENCLAMIDE|GLICLAZIDE|PIOGLITAZONE|LEVOTHYROXINE|THYROXINE/.test(combined))
    return { hs: '3004.3900', saleType: 'Exempt goods', rate: 0, uom, sro: 'Eighth Schedule Table 1', sroItem: '81' };

  // ── Default: all other registered medicines → Exempt, HS 3004.9099 ────────
  return { hs: '3004.9099', saleType: 'Exempt goods', rate: 0, uom, sro: 'Eighth Schedule Table 1', sroItem: '81' };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching products from Turso...');
  const rows = await query(
    'SELECT id, name, company_name, description FROM products WHERE deleted_at IS NULL'
  );
  console.log(`Found ${rows.length} products.\n`);

  const now = new Date().toISOString();
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const id   = row[0].value;
    const name = row[1].value ?? '';
    const desc = row[3].value ?? '';

    const { hs, saleType, rate, sro, sroItem } = classifyProduct(name, desc);
    // FBR HS_UOM: medicines take Packs, dressings/sutures KG, devices pieces.
    const uom = hs.startsWith('3004.') ? 'Packs' : hs.startsWith('3005.') ? 'KG' : 'Numbers, pieces, units';

    try {
      await query(
        `UPDATE products SET
           hs_code = ?,
           fbr_sale_type = ?,
           fbr_sale_rate = ?,
           fbr_uom = ?,
           sro_no = ?,
           sro_item_serial_no = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          { type: 'text', value: hs },
          { type: 'text', value: saleType },
          { type: 'float', value: rate },
          { type: 'text', value: uom },
          { type: 'text', value: sro },
          { type: 'text', value: sroItem },
          { type: 'text', value: now },
          { type: 'text', value: id },
        ]
      );
      console.log(`  ✓  ${name.padEnd(40)} → HS ${hs}  |  ${saleType}`);
      updated++;
    } catch (e) {
      console.error(`  ✗  ${name}: ${e.message}`);
      skipped++;
    }
  }

  console.log(`\nDone. ${updated} updated, ${skipped} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
