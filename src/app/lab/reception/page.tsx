"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ClinicPatientPicker } from "@/components/clinic/ClinicPatientPicker";
import { ServiceBillModal } from "@/components/print/ServiceBillModal";
import { VisitProgress, PRIORITY_CLS, money } from "@/components/lab/labUi";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { patientsRepo } from "@/lib/repo/clinic";
import { listClinicServices, type ClinicService } from "@/lib/repo/clinicServices";
import { createLabVisit, labBillLines, listLabVisits, type LabVisit, type LabVisitRow } from "@/lib/repo/lab";
import type { ServiceLine } from "@/lib/serviceFbr";
import type { ClinicPatient } from "@/lib/types-clinic";

/** Lab reception: the patient, the tests, the bill. The tests then go to
 * the technologist (Samples & Results). */
export default function LabReceptionPage() {
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [tests, setTests] = useState<ClinicService[]>([]);
  const [patientId, setPatientId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const [priority, setPriority] = useState<LabVisit["priority"]>("routine");
  const [discount, setDiscount] = useState("");
  const [paid, setPaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState<LabVisitRow[]>([]);
  const [bill, setBill] = useState<{ invoiceId: string; lines: ServiceLine[]; autoPrint: boolean } | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const [p, t, v] = await Promise.all([
      patientsRepo.list({ orderBy: "name ASC" }),
      listClinicServices({ category: "lab" }),
      listLabVisits({ date: localDate() }).catch(() => []),
    ]);
    setPatients(p);
    setTests(t.filter((x) => x.is_active));
    setToday(v);
  }
  useEffect(() => { void reload(); }, []);

  const chosen = useMemo(() => picked.map((id) => tests.find((t) => t.id === id)).filter((t): t is ClinicService => Boolean(t)), [picked, tests]);
  const total = chosen.reduce((s, t) => s + Number(t.rate || 0), 0);
  const payable = Math.max(0, total - (Number(discount) || 0));

  function addTest(id: string) {
    if (id && !picked.includes(id)) setPicked((p) => [...p, id]);
    setPick("");
  }

  async function openBill(invoiceId: string, autoPrint = false) {
    const lines = (await labBillLines(invoiceId)).map((o) => ({ name: o.name, qty: Number(o.qty) || 1, rate: Number(o.rate) || 0 }));
    setBill({ invoiceId, lines, autoPrint });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await createLabVisit({
        patientId, serviceIds: picked, referredBy, priority,
        discount: Number(discount) || 0, paid: paid === "" ? payable : Number(paid) || 0,
      });
      setPicked([]);
      setDiscount("");
      setPaid("");
      setReferredBy("");
      setPriority("routine");
      setPatientId("");
      await reload();
      await openBill(r.invoice.id, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<LabVisitRow>[] = [
    { header: "Visit", render: (v) => <span className="font-mono text-xs">{v.visit_no}</span> },
    { header: "Patient", render: (v) => <span><span className="font-medium">{v.patient_name}</span> <span className="text-xs text-neutral-500">{v.mrn ?? ""}</span></span> },
    { header: "Tests", render: (v) => <span title={v.test_names} className="inline-block max-w-[18rem] truncate align-bottom">{v.test_names}</span> },
    { header: "Priority", render: (v) => <span className={`text-xs font-semibold uppercase ${PRIORITY_CLS[v.priority] ?? ""}`}>{v.priority}</span> },
    { header: "Progress", render: (v) => <VisitProgress v={v} /> },
    { header: "Balance", render: (v) => <span className={`tabular-nums ${v.balance > 0.009 ? "font-semibold text-rose-700" : "text-neutral-500"}`}>{money(v.balance)}</span> },
    {
      header: "",
      render: (v) => v.invoice_id && (
        <button type="button" title="Print bill" aria-label="Print bill" onClick={(e) => { e.stopPropagation(); void openBill(v.invoice_id!); }} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100"><Printer size={15} /></button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Reception" />
      <section className="mb-5 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">New lab visit</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Field label="Patient" required>
              <ClinicPatientPicker patients={patients} value={patientId} onChange={setPatientId} onRegistered={(p) => setPatients((ps) => [...ps, p])} />
            </Field>
          </div>
          <Field label="Referred by"><Input id="lr-ref" value={referredBy} onChange={(e) => setReferredBy(e.target.value)} placeholder="Doctor / self" /></Field>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px]">
          <Field label="Add test">
            <SearchSelect id="lr-test" value={pick} onChange={addTest} placeholder="Type to find a test…" emptyText="No tests yet: add them in Tests & Rates"
              options={tests.filter((t) => !picked.includes(t.id)).map((t) => ({ value: t.id, label: t.name, hint: [`Rs ${Number(t.rate).toFixed(0)}`, t.section ?? t.sample_type].filter(Boolean).join(" · ") }))} />
          </Field>
          <Field label="Priority">
            <Select id="lr-priority" value={priority} onChange={(e) => setPriority(e.target.value as LabVisit["priority"])}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="stat">STAT</option>
            </Select>
          </Field>
        </div>
        {chosen.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {chosen.map((t) => (
                <tr key={t.id} className="border-b border-neutral-100">
                  <td className="py-1.5">{t.name}<span className="ml-2 text-xs text-neutral-500">{t.sample_type ?? ""}</span></td>
                  <td className="py-1.5 text-right tabular-nums">{money(t.rate)}</td>
                  <td className="w-8 py-1.5 text-right">
                    <button type="button" aria-label={`Remove ${t.name}`} title="Remove" onClick={() => setPicked((p) => p.filter((x) => x !== t.id))} className="rounded-full p-1 text-rose-600 hover:bg-rose-50"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-3 flex flex-wrap items-end justify-end gap-3">
          <p className="mr-auto text-sm text-neutral-600">{chosen.length} test{chosen.length === 1 ? "" : "s"} · Total <b className="tabular-nums">{money(total)}</b> · Payable <b className="tabular-nums">{money(payable)}</b></p>
          <div className="w-32"><Field label="Discount"><Input id="lr-disc" type="number" min="0" step="any" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field></div>
          <div className="w-32"><Field label="Paid"><Input id="lr-paid" type="number" min="0" step="any" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={money(payable)} /></Field></div>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !patientId || !chosen.length}>{saving ? "Saving…" : "Save and print bill"}</Button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </section>

      <h2 className="mb-2 text-sm font-semibold text-neutral-700">Today&apos;s visits</h2>
      <DataTable columns={columns} rows={today} emptyMessage="No visits today yet." />
      {bill && <ServiceBillModal invoiceId={bill.invoiceId} lines={bill.lines} title="Lab Bill" autoPrint={bill.autoPrint} onClose={() => setBill(null)} />}
    </div>
  );
}
