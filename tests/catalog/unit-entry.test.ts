/** Units on invoices: a price shown in the secondary unit has at most 2
 * decimals, and an edited invoice reopens each line in the unit it was
 * entered in (3 capsules, not 0.43 of a pack). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertPriceOnUnitToggle, inferEntryUnit, roundPrice, toSecondaryQty } from "@/lib/uom";

test("prices converted between units keep 2 decimals", () => {
  assert.equal(convertPriceOnUnitToggle(415.84, true, 7), 59.41);
  assert.equal(convertPriceOnUnitToggle(1110, true, 50), 22.2);
  assert.equal(convertPriceOnUnitToggle(59.41, false, 7), 415.87);
  assert.equal(roundPrice(12.345), 12.35);
});

test("a saved quantity reopens in the unit it was entered in", () => {
  assert.equal(inferEntryUnit(3 / 7, 0, 7, true), "secondary");
  assert.equal(toSecondaryQty(3 / 7, 7), 3);
  assert.equal(inferEntryUnit(0.3, 0, 10, true), "secondary");
  assert.equal(toSecondaryQty(0.06, 50), 3);
  assert.equal(inferEntryUnit(2, 0, 10, true), "base", "whole packs stay packs");
  assert.equal(inferEntryUnit(0.3, 0, 10, false), "base", "no secondary unit");
  assert.equal(inferEntryUnit(2, 0.5, 10, true), "secondary", "a part-pack bonus is in the secondary unit");
});
