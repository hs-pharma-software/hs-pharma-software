/** One invoice line over several batches: earliest expiry first, paid
 * quantity before bonus, batches shared between lines, and the shortfall. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateBatches, batchLabel, totalStock, type BatchStock } from "@/lib/batchAllocation";

const b = (id: string, qty: number): BatchStock => ({ id, batch_no: id.toUpperCase(), expiry_date: null, qty, purchase_price: 10 });
const batches = [b("a1", 4), b("b2", 10), b("c3", 3)];

test("a quantity larger than one batch continues into the next ones", () => {
  const { parts, short } = allocateBatches(batches, 12, 0);
  assert.deepEqual(parts.map((p) => [p.batch.id, p.qty, p.bonus]), [["a1", 4, 0], ["b2", 8, 0]]);
  assert.equal(short, 0);
  assert.equal(totalStock(batches), 17);
  assert.equal(batchLabel(batches, 12, 0), "A1, B2");
  assert.equal(batchLabel(batches, 0, 0), "A1");
});

test("bonus comes after the paid quantity; lines share what is left", () => {
  const used = new Map<string, number>();
  const first = allocateBatches(batches, 3, 2, used);
  assert.deepEqual(first.parts.map((p) => [p.batch.id, p.qty, p.bonus]), [["a1", 3, 1], ["b2", 0, 1]]);
  const second = allocateBatches(batches, 10, 0, used);
  assert.deepEqual(second.parts.map((p) => [p.batch.id, p.qty]), [["b2", 9], ["c3", 1]]);
});

test("more than all batches hold leaves a shortfall", () => {
  const { parts, short } = allocateBatches(batches, 20, 0);
  assert.equal(parts.reduce((s, p) => s + p.qty, 0), 17);
  assert.equal(short, 3);
});
