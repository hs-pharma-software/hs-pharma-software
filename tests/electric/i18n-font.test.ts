/** Urdu interface completeness, font-file checks, and electric route access. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DICT, translate, translateError } from "@/lib/i18n/dict";
import { isJameelNoori, readFontNames } from "@/lib/electric/fontName";
import { SPEC_FIELDS } from "@/lib/electric/engine";
import { NAV } from "@/config/nav";
import { moduleKeyForPath } from "@/lib/moduleAccess";

const ROOT = join(import.meta.dirname, "..", "..");
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const rel = `${dir}/${f}`;
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(f) ? [rel] : [];
  });
}
const FILES = ["src/components/electric", "src/app/electric", "src/lib/electric"].flatMap((d) => walk(d));
const ARABIC = /[\u0600-\u06FF]/;

test("every literal t(\"key\") used by the store screens has English and Urdu text", () => {
  const missing: string[] = [];
  let used = 0;
  for (const f of FILES) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/\bt\("([a-zA-Z]+\.[a-zA-Z_.]+)"\)/g)) {
      used++;
      if (!DICT[m[1]]) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.ok(used > 150, `expected many keys, found ${used}`);
  assert.deepEqual(missing, []);
});

test("templated keys (payment methods, statuses, types, groups, doc types) all exist", () => {
  const keys = [
    ...["cash", "card", "bank", "digital", "cheque"].map((k) => `pay.${k}`),
    ...["general", "electrical", "cable", "solar_panel", "inverter", "battery", "electronics"].map((k) => `type.${k}`),
    ...["electrical", "electronics", "solar", "other"].map((k) => `grp.${k}`),
    ...["opening", "purchase", "sale", "sale_return", "purchase_return", "adjustment", "count"].map((k) => `mv.${k}`),
    ...["in_stock", "sold", "returned_to_supplier", "defective"].map((k) => `sts.${k}`),
    ...["open", "sent_to_supplier", "repaired", "replaced", "rejected", "closed"].map((k) => `cl.${k}`),
    ...["sale", "sale_return", "purchase", "purchase_return", "quotation"].map((k) => `inv.${k}`),
    ...Object.values(SPEC_FIELDS).flat().map((f) => f.label),
    ...NAV.filter((n) => n.onlyFor?.includes("electronics_solar")).flatMap((n) => [n.labelKey!, ...(n.children ?? []).map((c) => c.labelKey!)]),
  ];
  assert.deepEqual(keys.filter((k) => !DICT[k]), []);
});

test("every Urdu entry is actually Urdu script (or a deliberate brand / code)", () => {
  const latinOk = new Set(["lang.en"]);
  const notUrdu = Object.entries(DICT).filter(([k, [, ur]]) => !latinOk.has(k) && !ARABIC.test(ur)).map(([k]) => k);
  assert.deepEqual(notUrdu, []);
  assert.equal(translate("c.save", "ur"), "محفوظ کریں");
  assert.equal(translate("c.save", "en"), "Save");
});

test("store validation errors are shown in Urdu", () => {
  assert.equal(translateError("Only 2 m of Cable 6mm in stock.", "ur"), "Cable 6mm کا اسٹاک صرف 2 m ہے۔");
  assert.equal(translateError("Select exactly 1 serial number(s) for Inverter.", "ur"), "Inverter کے لیے بالکل 1 سیریل نمبر منتخب کریں۔");
  assert.ok(ARABIC.test(translateError("Something unexpected", "ur")));
  assert.equal(translateError("Something unexpected", "en"), "Something unexpected");
});

/** Minimal sfnt with a `name` table holding family (1) and full name (4). */
function fakeFont(family: string, full: string, tag = 0x00010000): ArrayBuffer {
  const enc = (s: string) => Array.from(s).flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]);
  const strs = [enc(family), enc(full)];
  const nameLen = 6 + 2 * 12 + strs[0].length + strs[1].length;
  const buf = new ArrayBuffer(12 + 16 + nameLen);
  const v = new DataView(buf);
  v.setUint32(0, tag);
  v.setUint16(4, 1);
  [..."name"].forEach((c, i) => v.setUint8(12 + i, c.charCodeAt(0)));
  const off = 28;
  v.setUint32(12 + 8, off);
  v.setUint32(12 + 12, nameLen);
  v.setUint16(off + 2, 2);
  v.setUint16(off + 4, 6 + 24);
  let so = 0;
  [1, 4].forEach((id, i) => {
    const r = off + 6 + i * 12;
    v.setUint16(r, 3);
    v.setUint16(r + 2, 1);
    v.setUint16(r + 4, 0x409);
    v.setUint16(r + 6, id);
    v.setUint16(r + 8, strs[i].length);
    v.setUint16(r + 10, so);
    strs[i].forEach((b, j) => v.setUint8(off + 30 + so + j, b));
    so += strs[i].length;
  });
  return buf;
}

test("font check accepts a file named Jameel Noori Nastaleeq and rejects others", () => {
  const ok = readFontNames(fakeFont("Jameel Noori Nastaleeq", "Jameel Noori Nastaleeq Regular"));
  assert.equal(ok.family, "Jameel Noori Nastaleeq");
  assert.ok(isJameelNoori(ok));
  const other = readFontNames(fakeFont("Noto Nastaliq Urdu", "Noto Nastaliq Urdu Regular", 0x4f54544f));
  assert.equal(other.family, "Noto Nastaliq Urdu");
  assert.equal(isJameelNoori(other), false);
  assert.throws(() => readFontNames(new TextEncoder().encode("not a font at all, just text").buffer as ArrayBuffer), /\.ttf or \.otf/);
});

test("font check reads a real installed font file", (t) => {
  const file = ["arial.ttf", "Candara.ttf", "calibri.ttf", "segoeui.ttf"].map((f) => `C:/Windows/Fonts/${f}`).find(existsSync);
  if (!file) return t.skip("no Windows font available on this machine");
  const b = readFileSync(file);
  const names = readFontNames(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  assert.ok(names.family && names.family.length > 2, `family read from ${file}: ${names.family}`);
  assert.equal(isJameelNoori(names), false);
});

test("electric routes map to electric modules (including the /new screens)", () => {
  const cases: [string, string][] = [
    ["/electric/products", "es_products"],
    ["/electric/categories", "es_products"],
    ["/electric/sales/new", "es_sales"],
    ["/electric/quotations/new", "es_sales"],
    ["/electric/returns", "es_sales"],
    ["/electric/purchases/new", "es_purchases"],
    ["/electric/warranty", "es_inventory"],
    ["/electric/parties", "es_parties"],
    ["/electric/reports", "es_reports"],
    ["/electric/settings", "es_settings"],
  ];
  for (const [path, key] of cases) assert.equal(moduleKeyForPath(path), key, path);
});
