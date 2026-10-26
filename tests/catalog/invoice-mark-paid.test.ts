/** Marking a sales invoice paid from the list: an ordinary invoice takes the
 * balance as paid (the customer's receivable drops); a surgery invoice
 * records the payment on the admission and follows from it. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "./fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { invoicesRepo } from "@/lib/repo/invoices";
import { customersRepo } from "@/lib/repo/customers";
import { getPartyTradeBalance } from "@/lib/repo/ledger";
import { hospitalPatientsRepo, hospitalEpisodesRepo, listPaymentsForEpisode, nextMrNo } from "@/lib/repo/hospital";
import { markInvoicePaid } from "@/lib/repo/invoicePayments";
import type { Invoice } from "@/lib/types2";

const T = "biz-a";
const tenant = (businessType: string): SessionTenant => ({
  id: T, name: "Business", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType,
});
const login = (bt: string) => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Owner", role: "owner", tenantId: T, permissions: null }, currentTenant: tenant(bt) });
const inv = (over: Partial<Invoice>) => invoicesRepo.create({
  invoice_no: 7, date: "2026-10-26", inv_on: "2026-10-26", invoice_type: "sale", description: null, salesman_id: null, customer_id: null,
  total: 1000, charges: 0, discount_pct: 0, discount_rs: 0, tax_pct: 0, payable: 1000, paid: 400, balance: 600, is_return: 0, is_memorized: 0,
  converted_invoice_id: null, original_invoice_id: null, is_quotation: 0, quotation_no: null, fbr_invoice_no: null, customer_name: null,
  customer_phone: null, buyer_ntn_cnic: null, buyer_province: null, buyer_address: null, buyer_registration_type: null, ...over,
} as Partial<Invoice>);

beforeEach(() => setTestDb(fullSchemaDb()));

test("ordinary invoice: the balance becomes paid and the customer owes nothing for it", async () => {
  login("retail_pharmacy");
  const c = await customersRepo.create({ name: "Ali Traders", opening_balance: 0, balance_type: "receivable" } as never);
  const i = await inv({ customer_id: c.id });
  assert.equal(await getPartyTradeBalance("customer", c.id), 600);
  const paid = await markInvoicePaid(i.id);
  assert.deepEqual([paid.paid, paid.balance], [1000, 0]);
  assert.equal(await getPartyTradeBalance("customer", c.id), 0);
  await assert.rejects(markInvoicePaid(i.id), /already paid/);
  const ret = await inv({ is_return: 1 });
  await assert.rejects(markInvoicePaid(ret.id), /return invoice/);
});

test("surgery invoice: the balance is recorded as a payment on the admission", async () => {
  login("hospital");
  const p = await hospitalPatientsRepo.create({ mr_no: await nextMrNo(), name: "Zahid Iqbal", gender: "Male" });
  const ep = await hospitalEpisodesRepo.create({
    episode_no: "IPD-1", type: "ipd", patient_id: p.id, doctor_id: null, department: "Surgery", date: "2026-10-26", time: null, status: "open",
    room_ward: null, bed_no: null, admission_date: "2026-10-26", discharge_date: null, diagnosis: null, notes: null,
  });
  const i = await inv({ invoice_type: "hospital_surgery", hospital_episode_id: ep.id, paid: 0, balance: 1000 });
  const paid = await markInvoicePaid(i.id, "card");
  assert.deepEqual([paid.paid, paid.balance], [1000, 0]);
  const pays = await listPaymentsForEpisode(ep.id);
  assert.deepEqual(pays.map((x) => [x.amount, x.method, x.reference]), [[1000, "card", "Invoice 7"]]);
});
