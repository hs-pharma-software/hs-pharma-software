/** Plan prices: the yearly option (a year of terms less the discount) and the
 * description's style on the pricing page; modules follow business types. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { annualPrice, descriptionClasses, offersAnnual, parseDescriptionStyle, termLabel, termsPerYear } from "@/lib/planPricing";
import { visibleNavFor } from "@/config/navFilter";

test("yearly price: twelve months less 20% by default; other terms; no offer for yearly or unpriced plans", () => {
  assert.deepEqual(annualPrice(1000, 30, undefined), { full: 12000, price: 9600, saving: 2400, pct: 20 });
  assert.deepEqual(annualPrice(1000, 30, 25), { full: 12000, price: 9000, saving: 3000, pct: 25 });
  assert.equal(termsPerYear(90), 4);
  assert.equal(termsPerYear(365), 1);
  assert.equal(annualPrice(3000, 90, 20).price, 9600);
  assert.equal(annualPrice(1000, 30, 150).pct, 90, "discount capped");
  assert.ok(offersAnnual({ price: 1000, duration_days: 30 }));
  assert.ok(!offersAnnual({ price: 0, duration_days: 30 }), "price on quote");
  assert.ok(!offersAnnual({ price: 10000, duration_days: 365 }), "already yearly");
  assert.ok(!offersAnnual({ price: 1000, duration_days: 30, annual_enabled: 0 }));
  assert.equal(termLabel(30), "per month");
  assert.equal(termLabel(365), "per year");
});

test("description style: safe defaults, only known sizes and alignments", () => {
  assert.deepEqual(parseDescriptionStyle(null), { size: "sm", align: "left", bold: false, italic: false });
  assert.deepEqual(parseDescriptionStyle('{"size":"lg","align":"center","bold":true}'), { size: "lg", align: "center", bold: true, italic: false });
  assert.deepEqual(parseDescriptionStyle('{"size":"huge","align":"justify; color:red"}'), { size: "sm", align: "left", bold: false, italic: false });
  assert.deepEqual(parseDescriptionStyle("not json"), { size: "sm", align: "left", bold: false, italic: false });
  assert.equal(descriptionClasses({ size: "xl", align: "right", bold: true, italic: true }), "text-xl text-right font-semibold italic");
});

test("modules offered in a plan follow its business types", () => {
  const lab = new Set(visibleNavFor("lab", null, null).map((n) => n.moduleKey));
  const pharmacy = new Set(visibleNavFor("retail_pharmacy", null, null).map((n) => n.moduleKey));
  assert.ok(lab.has("lab_reception") && !pharmacy.has("lab_reception"));
  assert.ok(pharmacy.has("invoices"));
});
