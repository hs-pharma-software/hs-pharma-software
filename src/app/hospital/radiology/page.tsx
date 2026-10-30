"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ClipboardList, Clock, FileText, Monitor, Search, Users, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import PatientFormModal from "@/app/hospital/patients/PatientFormModal";
import { isTauri } from "@/lib/platform";
import { listImagingStudies, orderImaging } from "@/lib/repo/radiology";
import {
  radiologyStats, listPortalOrders, listMachinesWithQueue, machineQueue, searchPatients, cancelImagingOrder,
  type RadiologyStats, type PortalOrderRow, type MachineWithQueue, type OrderFilter,
} from "@/lib/repo/radiologyPortal";
import type { WorklistOrder } from "@/lib/dicomApi";
import type { HospitalPatient, HospitalService, OrderPriority } from "@/lib/types-hospital";
import { Tabs, Panel, StatTile, StatusPill, PriorityPill, FeePill, ageGender, errMsg } from "@/components/hospital/radiology/common";

type Tab = "dashboard" | "orders" | "worklist" | "create";

/** Radiology reception: today's figures, the order list, the machines'
 * queues, and new orders for registered or new patients. */
export default function RadiologyReceptionPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  return (
    <div>
      <PageHeader title="Radiology Reception" actions={<Link href="/hospital/radiology/reports" className="text-sm font-medium text-neutral-600 hover:underline">Radiology Reports →</Link>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "dashboard", label: "Dashboard" }, { key: "orders", label: "Orders" }, { key: "worklist", label: "Worklist" }, { key: "create", label: "Create Order" },
      ]} />
      {tab === "dashboard" && <Dashboard />}
      {tab === "orders" && <Orders />}
      {tab === "worklist" && <Worklist />}
      {tab === "create" && <CreateOrder onCreated={() => setTab("orders")} />}
    </div>
  );
}

function Dashboard() {
  const [s, setS] = useState<RadiologyStats | null>(null);
  useEffect(() => { if (isTauri()) void radiologyStats().then(setS).catch(() => setS(null)); }, []);
  const v = (n: number | undefined) => (s ? n ?? 0 : "…");
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Today's orders" value={v(s?.todaysOrders)} icon={<FileText size={16} />} />
      <StatTile label="Pending tests" value={v(s?.pending)} icon={<Clock size={16} />} />
      <StatTile label="Fee not paid" value={v(s?.awaitingFee)} tone="warn" />
      <StatTile label="Active machines" value={v(s?.activeMachines)} icon={<Monitor size={16} />} />
      <StatTile label="Waiting queue" value={v(s?.waitingQueue)} icon={<Users size={16} />} tone="info" />
      <StatTile label="In progress" value={v(s?.inProgress)} icon={<Activity size={16} />} tone="warn" />
      <StatTile label="To report" value={v(s?.toReport)} />
      <StatTile label="Reported today" value={v(s?.reportedToday)} tone="good" />
    </div>
  );
}

function Orders() {
  const [f, setF] = useState<OrderFilter>({ status: "pending", sort: "newest", page: 1, perPage: 20 });
  const [data, setData] = useState<{ rows: PortalOrderRow[]; total: number }>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const set = (p: Partial<OrderFilter>) => setF((x) => ({ ...x, page: 1, ...p }));

  async function load() {
    if (!isTauri()) return;
    setLoading(true);
    try { setData(await listPortalOrders(f)); } catch (e) { window.alert(errMsg(e)); } finally { setLoading(false); }
  }
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cancel(o: PortalOrderRow) {
    const reason = window.prompt(`Cancel ${o.order_no} (${o.modality}) for ${o.patient_name}? Reason:`);
    if (!reason) return;
    try { await cancelImagingOrder(o.id, reason); await load(); } catch (e) { window.alert(errMsg(e)); }
  }

  const pages = Math.max(1, Math.ceil(data.total / (f.perPage ?? 20)));
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <Input id="rad-order-search" className="pl-9" value={f.search ?? ""} onChange={(e) => set({ search: e.target.value })} placeholder="Search by order number, patient name, MR number, CNIC, phone or study…" />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><Input id="rad-from" type="date" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} /></Field>
        <Field label="To"><Input id="rad-to" type="date" value={f.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} /></Field>
        <Field label="Status">
          <Select id="rad-status" value={f.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">All status</option><option value="pending">Waiting</option><option value="in_progress">In progress</option>
            <option value="performed">Examined, to report</option><option value="reported">Reported</option><option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Priority">
          <Select id="rad-priority" value={f.priority ?? ""} onChange={(e) => set({ priority: e.target.value || undefined })}>
            <option value="">All priority</option><option value="stat">STAT</option><option value="urgent">Urgent</option><option value="routine">Routine</option>
          </Select>
        </Field>
        <Field label="Sort">
          <Select id="rad-sort" value={f.sort} onChange={(e) => set({ sort: e.target.value as OrderFilter["sort"] })}>
            <option value="newest">Date (newest)</option><option value="oldest">Date (oldest)</option><option value="priority">Priority</option>
          </Select>
        </Field>
        <Button variant="ghost" onClick={() => setF({ sort: "newest", page: 1, perPage: f.perPage })}><X size={14} />Clear filters</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral-600">
        <span>{loading ? "Loading…" : `Showing ${data.rows.length} of ${data.total} orders (page ${f.page} of ${pages})`}</span>
        <div className="flex items-center gap-2">
          <label htmlFor="rad-per-page">Per page</label>
          <Select id="rad-per-page" className="w-20" value={f.perPage} onChange={(e) => set({ perPage: Number(e.target.value) })}>
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <Button variant="secondary" disabled={(f.page ?? 1) <= 1} onClick={() => setF((x) => ({ ...x, page: (x.page ?? 1) - 1 }))}>Previous</Button>
          <Button variant="secondary" disabled={(f.page ?? 1) >= pages} onClick={() => setF((x) => ({ ...x, page: (x.page ?? 1) + 1 }))}>Next</Button>
        </div>
      </div>
      {!loading && data.rows.length === 0 && <Panel><p className="text-sm text-neutral-500">No orders match. New orders are placed on the Create Order tab or by doctors from the OPD.</p></Panel>}
      {data.rows.map((o) => (
        <Panel key={o.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-mono text-base font-semibold">{o.order_no}</div>
              <div className="text-sm text-neutral-600">{o.patient_name} · MR {o.mr_no}{o.cnic ? ` · CNIC ${o.cnic}` : ""}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5"><PriorityPill priority={o.priority} /><StatusPill status={o.status} /><FeePill fee={o.fee} paid={o.paid} /></div>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-neutral-500">Ordered</dt><dd>{o.ordered_at}</dd></div>
            <div><dt className="text-neutral-500">Age / gender</dt><dd>{ageGender(o)}</dd></div>
            <div><dt className="text-neutral-500">Source</dt><dd>{o.episode_type ? `${o.episode_type.toUpperCase()} · ${o.episode_no}` : "—"}</dd></div>
            <div><dt className="text-neutral-500">Prescribed by</dt><dd>{o.ordered_by ?? "—"}</dd></div>
            {o.clinical_history && <div className="sm:col-span-2"><dt className="text-neutral-500">Clinical history</dt><dd>{o.clinical_history}</dd></div>}
          </dl>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2 text-sm">
            <span><span className="font-medium">{o.modality}</span>{o.body_part ? ` · ${o.body_part}` : ""}{o.machine_name ? ` · ${o.machine_name}` : ""}</span>
            <span className="flex items-center gap-2">
              <span className="font-semibold tabular-nums text-emerald-700">Rs {Number(o.fee ?? 0).toFixed(0)}</span>
              {o.status === "pending" && <Button variant="ghost" onClick={() => void cancel(o)}>Cancel order</Button>}
            </span>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function Worklist() {
  const [machines, setMachines] = useState<MachineWithQueue[]>([]);
  const [machineId, setMachineId] = useState("");
  const [queue, setQueue] = useState<WorklistOrder[]>([]);
  const [loadedAt, setLoadedAt] = useState(0);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    void listMachinesWithQueue().then((ms) => {
      const active = ms.filter((m) => m.status === "active");
      setMachines(active);
      setMachineId((id) => id || active[0]?.id || "");
    }).catch((e) => window.alert(errMsg(e)));
  }, []);
  useEffect(() => {
    const m = machines.find((x) => x.id === machineId);
    if (m) void machineQueue(m).then((q) => { setQueue(q); setLoadedAt(Date.now()); }).catch(() => setQueue([]));
  }, [machineId, machines]);

  if (!machines.length) return <Panel><p className="text-sm text-neutral-500">No active machines. Add them on <Link className="underline" href="/hospital/radiology/machines">Radiology › Machines</Link>; each machine then gets its own queue.</p></Panel>;
  const minutes = (at: string) => Math.max(0, Math.round((loadedAt - new Date(at.replace(" ", "T")).getTime()) / 60000));
  const shown = queue.map((o, i) => ({ o, pos: i + 1 })).filter(({ o }) => (!status || o.status === status) && (!priority || o.priority === priority));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Select id="wl-machine" className="w-auto" value={machineId} onChange={(e) => setMachineId(e.target.value)} aria-label="Machine">
          {machines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.modality_code}) · queue {m.queue}</option>)}
        </Select>
        <Select id="wl-status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All status</option><option value="pending">Waiting</option><option value="in_progress">In progress</option>
        </Select>
        <Select id="wl-priority" className="w-auto" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">All priority</option><option value="stat">STAT</option><option value="urgent">Urgent</option><option value="routine">Routine</option>
        </Select>
      </div>
      {shown.length === 0 && <Panel><p className="text-sm text-neutral-500">Nobody is waiting for this machine. Paid orders of its modality join the queue automatically.</p></Panel>}
      {shown.map(({ o, pos }) => (
        <Panel key={o.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{o.patient_name} <span className="text-sm font-normal text-neutral-500">· MR {o.mr_no} · {o.order_no}</span></div>
            <div className="flex items-center gap-1.5"><PriorityPill priority={o.priority} /><StatusPill status={o.status} /></div>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div><span className="text-neutral-500">Test: </span>{o.study}{o.body_part ? ` · ${o.body_part}` : ""}</div>
            <div><span className="text-neutral-500">Queue position: </span><span className="font-semibold">#{pos}</span></div>
            <div className="flex items-center gap-1 text-neutral-600"><Clock size={14} />waiting {minutes(o.ordered_at)} minutes</div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function CreateOrder({ onCreated }: { onCreated: () => void }) {
  const [q, setQ] = useState({ mrn: "", cnic: "", phone: "", name: "" });
  const [results, setResults] = useState<HospitalPatient[] | null>(null);
  const [patient, setPatient] = useState<HospitalPatient | null>(null);
  const [registering, setRegistering] = useState(false);
  const [studies, setStudies] = useState<HospitalService[]>([]);
  const [studyId, setStudyId] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("routine");
  const [orderedBy, setOrderedBy] = useState("");
  const [history, setHistory] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (isTauri()) void listImagingStudies().then(setStudies).catch(() => setStudies([])); }, []);
  const study = studies.find((s) => s.id === studyId);
  const anyCriterion = Object.values(q).some((v) => v.trim());

  async function search() {
    try { setResults(await searchPatients(q)); } catch (e) { window.alert(errMsg(e)); }
  }
  async function save() {
    if (!patient || !studyId) return;
    setSaving(true);
    try {
      const { order } = await orderImaging({ patientId: patient.id, serviceId: studyId, bodyPart, priority, orderedBy, clinicalHistory: history });
      window.alert(`Order ${order.order_no} placed.${Number(order.fee) > 0 ? ` Fee Rs ${Number(order.fee).toFixed(0)} is on the patient's bill; the patient joins the machine's queue once it is paid.` : ""}`);
      onCreated();
    } catch (e) {
      window.alert(`Could not place the order: ${errMsg(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (!patient) {
    return (
      <Panel title="Create new order">
        <p className="mb-3 text-sm text-neutral-500">Search for the patient first, then create the radiology order.</p>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (anyCriterion) void search(); }}>
          <Field label="MR number"><Input id="co-mrn" value={q.mrn} onChange={(e) => setQ({ ...q, mrn: e.target.value })} placeholder="Enter MR number" /></Field>
          <Field label="CNIC"><Input id="co-cnic" value={q.cnic} onChange={(e) => setQ({ ...q, cnic: e.target.value })} placeholder="12345-1234567-1" /></Field>
          <Field label="Mobile"><Input id="co-phone" value={q.phone} onChange={(e) => setQ({ ...q, phone: e.target.value })} placeholder="03xx-xxxxxxx" /></Field>
          <Field label="Name"><Input id="co-name" value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} placeholder="Patient name" /></Field>
          <p className="text-xs text-neutral-500 md:col-span-2">Enter at least one of these.</p>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" variant="primary" className="flex-1 justify-center" disabled={!anyCriterion}><Search size={14} />Search patients</Button>
            <Button type="button" variant="secondary" onClick={() => setRegistering(true)}>Register new patient</Button>
          </div>
        </form>
        {results && (
          <div className="mt-4 divide-y divide-neutral-100 rounded-xl ring-1 ring-neutral-200">
            {results.length === 0 && <p className="p-3 text-sm text-neutral-500">No patient found. Register the patient to continue.</p>}
            {results.map((p) => (
              <button key={p.id} type="button" onClick={() => setPatient(p)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50">
                <span><span className="font-medium">{p.name}</span> <span className="text-neutral-500">MR {p.mr_no}{p.cnic ? ` · ${p.cnic}` : ""}{p.phone ? ` · ${p.phone}` : ""}</span></span>
                <span className="text-neutral-500">{ageGender(p)}</span>
              </button>
            ))}
          </div>
        )}
        {registering && <PatientFormModal patient={null} initialName={q.name} onClose={() => setRegistering(false)} onSaved={(p) => { setRegistering(false); if (p) setPatient(p); }} />}
      </Panel>
    );
  }

  return (
    <Panel title="Create new order" actions={<Button variant="ghost" onClick={() => setPatient(null)}>Change patient</Button>}>
      <div className="mb-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm ring-1 ring-emerald-200">
        <span className="font-semibold">{patient.name}</span> · MR {patient.mr_no} · {ageGender(patient)}{patient.phone ? ` · ${patient.phone}` : ""}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Test" required>
            <Select id="co-study" value={studyId} onChange={(e) => setStudyId(e.target.value)}>
              <option value="">{studies.length ? "— Choose a test —" : "No tests performed yet (Radiology › Performing Images)"}</option>
              {studies.map((s) => <option key={s.id} value={s.id}>{s.name}{s.modality ? ` · ${s.modality}` : ""} · Rs {Number(s.rate).toFixed(0)}</option>)}
            </Select>
          </Field>
          {study && <p className="mt-1 text-xs text-neutral-500">{Number(study.rate) > 0 ? `Fee Rs ${Number(study.rate).toFixed(0)} goes on the patient's bill.` : "No fee for this test."}{study.turnaround_hours ? ` Usual reporting time ${study.turnaround_hours} h.` : ""}</p>}
        </div>
        <Field label="Body part / side"><Input id="co-body" value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} placeholder="e.g. Left knee" /></Field>
        <Field label="Priority">
          <Select id="co-priority" value={priority} onChange={(e) => setPriority(e.target.value as OrderPriority)}>
            <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="stat">STAT</option>
          </Select>
        </Field>
        <Field label="Prescribed by"><Input id="co-doctor" value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} placeholder="Doctor name" /></Field>
        <div className="md:col-span-2"><Field label="Clinical history"><Textarea id="co-history" rows={2} value={history} onChange={(e) => setHistory(e.target.value)} placeholder="Reason for the study, e.g. fall on outstretched hand, pain right wrist" /></Field></div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={() => void save()} disabled={saving || !studyId}><ClipboardList size={14} />{saving ? "Placing…" : "Place order"}</Button>
      </div>
    </Panel>
  );
}
