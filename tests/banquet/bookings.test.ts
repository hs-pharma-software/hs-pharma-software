/** Marquee / banquet hall: halls, menu, bookings by date and slot, payments
 * and the booking's bill. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { invoicesRepo } from "@/lib/repo/invoices";
import {
  saveHall, saveDish, savePackage, saveBooking, hallClash, addBookingPayment, cancelBooking, getBooking, listBookings,
  bookingBillLines, bookingTotals, banquetStats, type BookingInput,
} from "@/lib/repo/banquet";

const tenant: SessionTenant = {
  id: "hall-a", name: "Royal Marquee", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "banquet_hall",
};

beforeEach(() => {
  setTestDb(fullSchemaDb());
  useAuthStore.setState({ currentUser: { id: "u", username: "u", displayName: "Manager", role: "owner", tenantId: "hall-a", permissions: null }, currentTenant: tenant });
});

async function setup() {
  const hall = await saveHall(null, { name: "Hall A", capacity: 500, rent: 50000 });
  const korma = await saveDish(null, { name: "Chicken Korma", category: "Main course", price_per_head: 600 });
  const biryani = await saveDish(null, { name: "Mutton Biryani", category: "Rice", price_per_head: 700 });
  const kheer = await saveDish(null, { name: "Kheer", category: "Dessert", price_per_head: 200 });
  const pkg = await savePackage(null, { name: "Silver", price_per_head: 1400, dish_ids: [korma.id, biryani.id, kheer.id] });
  const base: BookingInput = {
    customer_name: "Ahmed Khan", mobile: "0300-1234567", cnic: "35201-1234567-1", event_type: "Walima", event_date: "2026-12-12",
    slot: "dinner", hall_id: hall.id, guests: 300, package_id: pkg.id, dish_ids: [korma.id, biryani.id, kheer.id],
    extras: [{ name: "Stage decoration", qty: 1, rate: 40000 }, { name: "", qty: 1, rate: 5 }], discount: 20000,
  };
  return { hall, korma, biryani, kheer, pkg, base };
}

test("totals: menu x guests + hall + extras - discount", () => {
  assert.deepEqual(bookingTotals({ guests: 300, per_head_rate: 1400, hall_rent: 50000, extras: [{ qty: 1, rate: 40000 }], discount: 20000 }), { menu: 420000, extras: 40000, gross: 510000, total: 490000 });
});

test("a booking with a package, an advance, the bill kept in step, payments to the end", async () => {
  const { base, korma, kheer } = await setup();
  await assert.rejects(saveBooking(null, { ...base, mobile: "123" }), /03001234567/);
  await assert.rejects(saveBooking(null, { ...base, guests: 0 }), /number of guests/);
  await assert.rejects(saveBooking(null, { ...base, package_id: null, dish_ids: [] }), /menu package or the dishes/);
  const b = await saveBooking(null, base, { amount: 100000 });
  assert.match(b.booking_no, /^BK-\d{6}-001$/);
  assert.equal(b.mobile, "03001234567");
  assert.equal(b.cnic, "3520112345671");
  assert.equal(b.per_head_rate, 1400, "the package price per head");
  assert.equal(b.total, 490000);
  assert.equal(b.paid, 100000);
  const inv = (await invoicesRepo.get(b.invoice_id!))!;
  assert.equal(inv.invoice_type, "banquet_booking");
  assert.equal(inv.payable, 490000);
  assert.equal(inv.balance, 390000);

  const d = await getBooking(b.id);
  assert.equal(d.dishes.length, 3);
  assert.equal(d.extras.length, 1, "an empty extra row is left out");
  assert.deepEqual(bookingBillLines(d).map((l) => [l.name, l.qty, l.rate]), [
    ["Menu: Silver (per head)", 300, 1400], ["Hall: Hall A (Dinner)", 1, 50000], ["Stage decoration", 1, 40000],
  ]);

  // Guests change: the bill follows.
  const more = await saveBooking(b.id, { ...base, guests: 350 });
  assert.equal(more.total, 560000);
  assert.equal((await invoicesRepo.get(b.invoice_id!))!.balance, 460000);
  await assert.rejects(addBookingPayment(b.id, 500000), /Only Rs 460000/);
  const done = await addBookingPayment(b.id, 460000, "bank");
  assert.equal(done.paid, 560000);
  assert.equal((await invoicesRepo.get(b.invoice_id!))!.inv_on, "cash");
  assert.equal((await getBooking(b.id)).payments.length, 2);

  // A custom menu: the dishes' total per head unless a rate is given.
  const custom = await saveBooking(null, { ...base, event_date: "2026-12-13", package_id: null, dish_ids: [korma.id, kheer.id], extras: [], discount: 0 });
  assert.equal(custom.per_head_rate, 800);
  const fixed = await saveBooking(custom.id, { ...base, event_date: "2026-12-13", package_id: null, dish_ids: [korma.id], per_head_rate: 750, extras: [], discount: 0 });
  assert.equal(fixed.per_head_rate, 750);
});

test("one booking per hall, date and slot; a full day holds both; cancelling frees the hall", async () => {
  const { base, hall } = await setup();
  const dinner = await saveBooking(null, base);
  await assert.rejects(saveBooking(null, { ...base, customer_name: "Other" }), /already booked on 2026-12-12 \(Dinner\) for Ahmed Khan/);
  await saveBooking(null, { ...base, slot: "lunch", customer_name: "Lunch Party" });
  await assert.rejects(saveBooking(null, { ...base, slot: "full_day", event_date: "2026-12-12" }), /already booked/);
  assert.ok(await hallClash(hall.id, "2026-12-12", "dinner"));
  assert.equal(await hallClash(hall.id, "2026-12-12", "dinner", dinner.id), null, "a booking does not clash with itself");
  const other = await saveHall(null, { name: "Lawn", rent: 0 });
  await saveBooking(null, { ...base, hall_id: other.id, customer_name: "On the lawn" });
  await assert.rejects(cancelBooking(dinner.id, " "), /reason/);
  await cancelBooking(dinner.id, "Family emergency");
  await saveBooking(null, { ...base, customer_name: "New party" });
  await assert.rejects(addBookingPayment(dinner.id, 10), /cancelled/);
  assert.equal((await listBookings({ from: "2026-12-12", to: "2026-12-12" })).length, 3);
  assert.equal((await listBookings({ status: "cancelled" })).length, 1);
});

test("dashboard figures", async () => {
  const { base } = await setup();
  await saveBooking(null, { ...base, event_date: "2026-11-05" }, { amount: 50000 });
  await saveBooking(null, { ...base, event_date: "2026-11-20", slot: "lunch" });
  const s = await banquetStats("2026-11-05");
  assert.equal(s.today, 1);
  assert.equal(s.upcoming30, 2);
  assert.equal(s.monthBookings, 2);
  assert.equal(s.monthRevenue, 980000);
  assert.equal(s.received, 50000);
});
