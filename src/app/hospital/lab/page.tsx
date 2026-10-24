"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri } from "@/lib/platform";
import { hospitalLabRepo, hospitalPatientsRepo, type HospitalLabOrder, type HospitalPatient } from "@/lib/repo/hospital";
import { canProcess, reportLabResult, listLabTests, listOpenVisits, orderLabTests } from "@/lib/repo/hospitalOpd";
import type { OrderPriority, HospitalService, HospitalEpisode } from "@/lib/types-hospital";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  collected: "bg-blue-100 text-blue-700",
  reported: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-neutral-100 text-neutral-500",
};

export default function LabPage() {
  const [rows, setRows] = useState<HospitalLabOrder[]>([]);
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [filter, setFilter] = useState("pending");
  const [showNew, setShowNew] = useState(false);
  const [resulting, setResulting] = useState<HospitalLabOrder | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const all = await hospitalLabRepo.list({ orderBy: "ordered_at DESC" });
    setRows(filter ? all.filter((r) => r.status === filter) : all);
    setPatients(await hospitalPatientsRepo.list({ orderBy: "name ASC" }));
  }
  useEffect(() => { void reload(); }, [filter]);

  const patientName = (id: string) => patients.find((p) => p.id === id)?.name ?? "—";

  const columns: Column<HospitalLabOrder>[] = [
    { header: "Order No", render: (r) => <span className="font-mono text-xs">{r.order_no}</span> },
    { header: "Patient", render: (r) => <span className="font-medium">{patientName(r.patient_id)}</span> },
    { header: "Test", render: (r) => r.test_name },
    { header: "Priority", render: (r) => r.priority },
    { header: "Fee", render: (r) => (Number(r.fee) > 0 ? <span className="tabular-nums">Rs {Number(r.fee).toFixed(0)}{Number(r.paid) ? " · paid" : ""}</span> : "—") },
    { header: "Status", render: (r) => <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[r.status] ?? ""}`}>{r.status}</span> },
    { header: "Result", render: (r) => (r.result_value ? `${r.result_value} ${r.unit ?? ""} ${r.flag && r.flag !== "N" ? `(${r.flag})` : ""}` : "—") },
    {
      header: "",
      render: (r) => (r.status === "reported" || r.status === "cancelled"
        ? null
        : canProcess(r)
          ? <Button variant="ghost" onClick={() => setResulting(r)}>Enter Result</Button>
          : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Awaiting fee Rs {Number(r.fee).toFixed(0)}</span>),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Laboratory"
        actions={
          <>
            <div className="flex rounded-lg overflow-hidden border border-neutral-200 text-sm">
              {["pending", "reported", ""].map((s) => (
                <button key={s} type="button" onClick={() => setFilter(s)} className={`px-3 py-1.5 ${filter === s ? "bg-amber-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                  {s === "pending" ? "Pending" : s === "reported" ? "Reported" : "All"}
                </button>
              ))}
            </div>
            <Button variant="primary" onClick={() => setShowNew(true)}><Plus size={14} className="mr-1" />New Lab Order</Button>
          </>
        }
      />
      <DataTable columns={columns} rows={rows} />
      {showNew && <NewLabOrder patients={patients} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); void reload(); }} />}
      {resulting && <ResultModal order={resulting} onClose={() => setResulting(null)} onSaved={() => { setResulting(null); void reload(); }} />}
    </div>
  );
}

function NewLabOrder({ patients, onClose, onSaved }: { patients: HospitalPatient[]; onClose: () => void; onSaved: () => void }) {
  const [patientId, setPatientId] = useState("");
  const [tests, setTests] = useState<HospitalService[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const [visits, setVisits] = useState<HospitalEpisode[]>([]);
  const [visitId, setVisitId] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("routine");
  const [orderedBy, setOrderedBy] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void listLabTests().then(setTests); }, []);
  useEffect(() => {
    setVisitId("");
    if (!patientId) return setVisits([]);
    void listOpenVisits(patientId).then(setVisits);
  }, [patientId]);

  const term = find.trim().toLowerCase();
  const shown = tests.filter((t) => !term || t.name.toLowerCase().includes(term) || t.code.toLowerCase().includes(term) || (t.sample_type ?? "").toLowerCase().includes(term));
  const total = tests.filter((t) => chosen.includes(t.id)).reduce((s, t) => s + Number(t.rate || 0), 0);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function save() {
    if (!patientId || chosen.length === 0 || saving) return;
    setSaving(true);
    try {
      await orderLabTests({ patientId, serviceIds: chosen, episodeId: visitId || null, priority, orderedBy: orderedBy.trim() || null });
      onSaved();
    } catch (e) {
      window.alert(`Could not place the order: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New Lab Order" onClose={onClose}>
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Patient *">
          <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">— Select —</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.mr_no})</option>)}
          </Select>
        </Field>
        <Field label="Visit (bill)">
          <Select value={visitId} onChange={(e) => setVisitId(e.target.value)} disabled={!patientId}>
            <option value="">{visits.length ? "Today's open visit, or a new lab visit" : "A new lab visit"}</option>
            {visits.map((v) => <option key={v.id} value={v.id}>{v.episode_no}{v.department ? ` · ${v.department}` : ""} · {v.date}</option>)}
          </Select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Tests * (from Performing Tests)">
            <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search test, code or sample…" />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-neutral-200">
              {shown.length === 0 ? (
                <p className="px-3 py-2 text-xs text-neutral-400">
                  {tests.length === 0 ? "No tests yet. Add them in Labs › Performing Tests." : "No test matches."}
                </p>
              ) : shown.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 border-b border-neutral-50 px-3 py-1.5 text-sm hover:bg-amber-50">
                  <input type="checkbox" checked={chosen.includes(t.id)} onChange={() => toggle(t.id)} />
                  <span className="flex-1"><span className="font-medium">{t.name}</span>{t.sample_type && <span className="ml-2 text-xs text-neutral-400">{t.sample_type}</span>}</span>
                  <span className="tabular-nums text-neutral-600">Rs {Number(t.rate).toFixed(0)}</span>
                </label>
              ))}
            </div>
          </Field>
        </div>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as OrderPriority)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">STAT</option>
          </Select>
        </Field>
        <Field label="Ordered by"><Input value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} placeholder="Doctor name" /></Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-sm text-neutral-600">
          {chosen.length} test{chosen.length === 1 ? "" : "s"} · <span className="font-semibold tabular-nums">Rs {total.toFixed(0)}</span>
          {total > 0 && <span className="block text-xs text-neutral-400">Added to the patient&apos;s bill; Reception takes the fee before the lab starts.</span>}
        </span>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !patientId || chosen.length === 0}>{saving ? "Saving…" : "Place Order"}</Button>
      </div>
    </Modal>
  );
}

function ResultModal({ order, onClose, onSaved }: { order: HospitalLabOrder; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(order.result_value ?? "");
  const [unit, setUnit] = useState(order.unit ?? "");
  const [range, setRange] = useState(order.ref_range ?? "");
  const [flag, setFlag] = useState<"N" | "H" | "L">(order.flag ?? "N");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await reportLabResult(order.id, { result_value: value, unit: unit.trim() || null, ref_range: range.trim() || null, flag });
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Result: ${order.test_name}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="Result *"><Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus /></Field>
        <Field label="Unit"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="mg/dL" /></Field>
        <Field label="Reference Range"><Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="70-140" /></Field>
        <Field label="Flag">
          <Select value={flag} onChange={(e) => setFlag(e.target.value as "N" | "H" | "L")}>
            <option value="N">Normal</option>
            <option value="H">High</option>
            <option value="L">Low</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !value.trim()}>{saving ? "Saving…" : "Save Result"}</Button>
      </div>
    </Modal>
  );
}
