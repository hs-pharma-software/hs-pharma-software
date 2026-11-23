"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { hospitalPatientsRepo } from "@/lib/repo/hospital";
import { pharmacyInvoicesForHospital, type PharmacyHospitalInvoice } from "@/lib/repo/brandSelections";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const money = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 0 });

/** Finance > Pharmacy Payments: the hospital pharmacy's bills of this hospital's patients, paid or unpaid. */
export default function PharmacyPaymentsPage() {
  const [rows, setRows] = useState<PharmacyHospitalInvoice[]>([]);
  const [mrs, setMrs] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState<"" | "paid" | "unpaid">("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const [inv, patients] = await Promise.all([pharmacyInvoicesForHospital(), hospitalPatientsRepo.list()]);
        setRows(inv);
        setMrs(new Map(patients.map((p) => [p.id, p.mr_no])));
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!status || r.status === status) && (!q || `${r.patientName} ${r.invoiceNo ?? ""} ${mrs.get(r.patientId ?? "") ?? ""}`.toLowerCase().includes(q)));
  const unpaid = rows.filter((r) => r.status === "unpaid").reduce((a, r) => a + r.balance, 0);

  return (
    <div>
      <PageHeader title="Pharmacy Payments" />
      <div className={card}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Find"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Patient, MR or invoice no" /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="">All</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option></Select></Field>
          <p className="pb-2 text-sm">{rows.length} bills · unpaid <b className="text-rose-700">Rs {money(unpaid)}</b></p>
        </div>
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {shown.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No pharmacy bills.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 pr-3 font-medium">Invoice</th><th className="pb-1.5 pr-3 font-medium">Patient</th><th className="pb-1.5 pr-3 text-right font-medium">Amount</th><th className="pb-1.5 pr-3 text-right font-medium">Balance</th><th className="pb-1.5 font-medium">Status</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.invoiceId} className="border-t border-neutral-100">
                    <td className="py-1.5 pr-3">#{r.invoiceNo ?? "—"}<span className="block text-[11px] text-neutral-500">{r.date}</span></td>
                    <td className="py-1.5 pr-3">{r.patientName}<span className="block font-mono text-[11px] text-neutral-500">{mrs.get(r.patientId ?? "") ?? ""}</span></td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.amount)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.balance)}</td>
                    <td className="py-1.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{r.status === "paid" ? "Paid" : "Unpaid"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
