import { test } from "node:test";
import assert from "node:assert/strict";
import { addQty, calcDoc, canDeduct, cleanSerials, cleanSpecs, settle, toBaseQty, warrantyEnd, weightedAverage } from "../../src/lib/electric/engine.ts";

test("cable roll: 100 m sold in odd lengths ends at exactly zero", () => {
  let stock = toBaseQty({ unit: "m", purchase_unit: "roll", purchase_factor: 100 }, 1, "purchase");
  assert.equal(stock, 100);
  for (const cut of [37.5, 12.25, 0.1, 0.2, 49.95]) stock = addQty(stock, -cut);
  assert.equal(stock, 0);
  assert.equal(0.1 + 0.2 === 0.3, false, "plain floats would drift");
  assert.ok(canDeduct(0.3, 0.3, false));
  assert.ok(!canDeduct(0.299, 0.3, false));
  assert.ok(canDeduct(0, 5, true), "negative allowed only when enabled");
});

test("line and document totals with a bill discount spread before tax", () => {
  const d = calcDoc(
    [
      { qty: 2, price: 1000, discount: 100, taxRate: 18 },
      { qty: 37.5, price: 120, discount: 0, taxRate: 0 },
    ],
    500
  );
  assert.equal(d.grossPaisa, 200000 + 450000);
  assert.equal(d.discountPaisa, 10000 + 50000);
  assert.equal(d.lines.reduce((s, l) => s + l.discountPaisa, 0), d.discountPaisa);
  const taxable0 = d.lines[0].grossPaisa - d.lines[0].discountPaisa;
  assert.equal(d.lines[0].taxPaisa, Math.round((taxable0 * 18) / 100), "tax on the discounted value");
  assert.equal(d.totalPaisa, d.grossPaisa - d.discountPaisa + d.taxPaisa);
});

test("payments: change only from overpayment, balance for credit", () => {
  assert.deepEqual(settle(100000, [{ method: "cash", amount: 1200 }]), { paidPaisa: 100000, balancePaisa: 0, changePaisa: 20000 });
  assert.deepEqual(settle(100000, [{ method: "card", amount: 400 }]), { paidPaisa: 40000, balancePaisa: 60000, changePaisa: 0 });
});

test("weighted average cost", () => {
  assert.equal(weightedAverage(10, 100, 10, 120), 110);
  assert.equal(weightedAverage(0, 0, 5, 80), 80);
  assert.equal(weightedAverage(-3, 50, 5, 80), 80, "negative stock ignored");
});

test("warranty end dates", () => {
  assert.equal(warrantyEnd("2026-01-01", 12), "2026-12-31");
  assert.equal(warrantyEnd("2026-10-23", 24), "2028-10-22");
  assert.equal(warrantyEnd("2026-01-31", 1), "2026-02-28");
  assert.equal(warrantyEnd("2026-10-23", 0), null);
});

test("specs keep only the fields of the product type", () => {
  assert.deepEqual(cleanSpecs("cable", { cores: "3", size_mm2: 4, watt: 500, junk: "x" }), { cores: 3, size_mm2: 4 });
  assert.throws(() => cleanSpecs("solar_panel", { watt: -5 }), /must be a number/);
  assert.deepEqual(cleanSerials([" ab-1 ", "AB-1", "", "c2"]), ["AB-1", "C2"]);
});
