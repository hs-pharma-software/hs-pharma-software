/** Lab report designs (Settings > Lab Report Templates): more than 30 distinct
 * designs, and an unknown saved design falls back to the default instead of
 * breaking the print. (The layout itself, LabReportDocument.tsx, is checked by
 * the type check and build: the test runner does not load .tsx.) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGN_FAMILIES, LAB_REPORT_DESIGNS, labDesign } from "@/lib/labReportDesigns";
import { DEFAULT_CLINIC_TEMPLATES } from "@/lib/clinicPrintTemplates";


test("more than 30 designs, unique ids and names, valid colours, every style family used", () => {
  assert.ok(LAB_REPORT_DESIGNS.length > 30, `${LAB_REPORT_DESIGNS.length} designs`);
  assert.equal(new Set(LAB_REPORT_DESIGNS.map((d) => d.id)).size, LAB_REPORT_DESIGNS.length);
  assert.equal(new Set(LAB_REPORT_DESIGNS.map((d) => d.name)).size, LAB_REPORT_DESIGNS.length);
  for (const d of LAB_REPORT_DESIGNS) assert.match(d.accent, /^#[0-9a-f]{6}$/i, d.id);
  for (const f of DESIGN_FAMILIES) assert.ok(LAB_REPORT_DESIGNS.some((d) => d.family === f), f);
  const looks = new Set(LAB_REPORT_DESIGNS.map((d) => [d.accent, d.font, d.header, d.title, d.info, d.table, d.flag, d.frame].join("|")));
  assert.equal(looks.size, LAB_REPORT_DESIGNS.length, "no two designs look the same");
});

test("the lab template starts on the classic design", () => {
  assert.equal(DEFAULT_CLINIC_TEMPLATES.lab.design, "classic");
  assert.equal(labDesign(DEFAULT_CLINIC_TEMPLATES.lab.design).name, "Classic");
});

test("an unknown or missing saved design prints with the default", () => {
  assert.equal(labDesign("removed-design").id, "classic");
  assert.equal(labDesign(undefined).id, "classic");
  assert.equal(labDesign("hospital-blue").name, "Hospital Blue");
});
