"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import { listLabTests, listOpenVisits, orderLabTests } from "@/lib/repo/hospitalOpd";
import {
  labCapabilities, listLabWorklist, receiveSample, enterLabResult, verifyLabResult, returnLabResult, cancelLabTest, testStatusLabel,
  type LabCapabilities, type WorklistRow, type WorklistView,
} from "@/lib/repo/labReports";
import type { OrderPriority, HospitalService, HospitalEpisode, HospitalLabOrder, LabRequest } from "@/lib/types-hospital";

const VIEWS: { key: WorklistView; label: string }[] = [
  { key: "active", label: "In progress" },
  { key: "verify", label: "Awaiting verification" },
  { key: "done", label: "Completed" },
  { key: "all", label: "All" },
];

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  collected: "bg-sky-100 text-sky-800",
  processing: "bg-sky-100 text-sky-800",
  awaiting_verification: "bg-violet-100 text-violet-800",
  reported: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-neutral-100 text-neutral-500",
  superseded: "bg-neutral-100 text-neutral-500",
};

const fail = (what: string, e: unknown) => window.alert(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);

/** Lab Orders: every lab order of the hospital and its collection centers, one
 * card per order (Unique Lab Number), with what this user may do on it. */
export default function LabOrdersPage() {
  const [caps, setCaps] = useState<LabCapabilities | null>(null);
  const [view, setView] = useState<WorklistView>("active");
  const [rows, setRows] = useState<WorklistRow[]>([]);
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [resulting, setResulting] = useState<HospitalLabOrder | null>(null);
  const [created, setCreated] = useState<LabRequest | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    try {
      const c = await labCapabilities();
      setCaps(c);
      setRows(await listLabWorklist(view));
      setPatients(await hospitalPatientsRepo.list({ orderBy: "name ASC" }));
    } catch (e) {
      fail("load the lab orders", e);
    }
  }
  useEffect(() => { void reload(); }, [view]);

  const act = async (what: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      fail(what, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Lab Orders"
        actions={
          <>
            <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
              {VIEWS.map((v) => (
                <button key={v.key} type="button" onClick={() => setView(v.key)}
                  className={`px-3 py-1.5 ${view === v.key ? "bg-amber-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                  {v.label}
                </button>
              ))}
            </div>
            {caps?.register && <Button variant="primary" onClick={() => setShowNew(true)}><Plus size={14} className="mr-1" />New Lab Order</Button>}
          </>
        }
      />

      {created && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          <span>Registered. Unique Lab Number <b className="font-mono">{created.lab_no}</b> · Lab Invoice <b className="font-mono">{created.invoice_no}</b></span>
          <span className="text-xs text-emerald-700">Give these numbers to the patient; any counter or collection center can find the report with them.</span>
          <button type="button" className="ml-auto text-xs underline" onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-neutral-400 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">No lab orders here.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const anyPending = r.tests.some((t) => t.status === "pending");
            return (
              <div key={r.request.id} className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{r.patientName} <span className="text-xs font-normal text-neutral-500">{r.mrNo}</span></p>
                    <p className="font-mono text-xs text-neutral-600">{r.request.lab_no} · {r.request.invoice_no}{r.request.external_ref ? ` · Ref ${r.request.external_ref}` : ""}</p>
                    <p className="text-xs text-neutral-500">
                      {r.location}
                      {r.request.referring_doctor ? ` · ${r.request.referring_doctor}` : ""}
                      {r.request.sample_received_at ? ` · Sample received ${r.request.sample_received_at}` : r.request.sample_collected_at ? ` · Sample collected ${r.request.sample_collected_at}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">{r.status}</span>
                    {caps?.process && anyPending && <Button onClick={() => void act("receive the sample", () => receiveSample(r.request.id))} disabled={busy}>Receive sample</Button>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                      <th className="pb-1 pr-2 font-medium">Test</th><th className="pb-1 pr-2 font-medium">Sample</th><th className="pb-1 pr-2 font-medium">Status</th>
                      <th className="pb-1 pr-2 font-medium">Result</th><th className="pb-1 text-right font-medium">Actions</th>
                    </tr></thead>
                    <tbody>
                      {r.tests.map((t) => {
                        const unpaid = Number(t.fee) > 0 && Number(t.paid) !== 1;
                        const showResult = caps?.process || caps?.verify;
                        return (
                          <tr key={t.id} className="border-b border-neutral-50 align-top">
                            <td className="py-1.5 pr-2"><span className="font-medium">{t.test_name}</span><span className="block font-mono text-[11px] text-neutral-400">{t.order_no}</span></td>
                            <td className="py-1.5 pr-2 text-neutral-600">{t.sample_type ?? "—"}</td>
                            <td className="py-1.5 pr-2">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[t.status] ?? ""}`}>{testStatusLabel(t)}</span>
                              {t.status === "reported" && t.verified_by_name && <span className="mt-0.5 block text-[11px] text-neutral-500">{t.verified_by_name}</span>}
                            </td>
                            <td className="py-1.5 pr-2 tabular-nums">
                              {showResult && t.result_value ? `${t.result_value} ${t.unit ?? ""}${t.flag && t.flag !== "N" ? ` (${t.flag})` : ""}` : "—"}
                            </td>
                            <td className="py-1.5 text-right">
                              <div className="flex flex-wrap justify-end gap-1">
                                {unpaid && t.status === "pending" && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">Awaiting fee Rs {Number(t.fee).toFixed(0)}</span>}
                                {caps?.process && !unpaid && ["pending", "collected", "processing", "awaiting_verification"].includes(t.status) && (
                                  <Button variant="ghost" onClick={() => setResulting(t)}>{t.status === "awaiting_verification" ? "Edit result" : "Enter result"}</Button>
                                )}
                                {caps?.verify && t.status === "awaiting_verification" && (
                                  <Button variant="primary" onClick={() => void act("verify the result", () => verifyLabResult(t.id))} disabled={busy}>Verify &amp; release</Button>
                                )}
                                {caps?.verify && (t.status === "awaiting_verification" || t.status === "reported") && (
                                  <Button variant="ghost" onClick={() => { const why = window.prompt("Why is this result returned for correction?"); if (why) void act("return the result", () => returnLabResult(t.id, why)); }}>Return</Button>
                                )}
                                {caps?.process && t.status !== "reported" && t.status !== "cancelled" && (
                                  <Button variant="ghost" onClick={() => { const why = window.prompt(`Cancel ${t.test_name}? Reason:`); if (why) void act("cancel the test", () => cancelLabTest(t.id, why)); }}>Cancel</Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewLabOrder
          patients={patients}
          onClose={() => setShowNew(false)}
          onSaved={(req) => { setShowNew(false); setCreated(req); void reload(); }}
        />
      )}
      {resulting && <ResultModal order={resulting} onClose={() => setResulting(null)} onSaved={() => { setResulting(null); void reload(); }} />}
    </div>
  );
}

function NewLabOrder({ patients, onClose, onSaved }: { patients: HospitalPatient[]; onClose: () => void; onSaved: (req: LabRequest) => void }) {
  const [patientId, setPatientId] = useState("");
  const [tests, setTests] = useState<HospitalService[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const [visits, setVisits] = useState<HospitalEpisode[]>([]);
  const [visitId, setVisitId] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("routine");
  const [orderedBy, setOrderedBy] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [collected, setCollected] = useState(true);
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
      const { request } = await orderLabTests({
        patientId, serviceIds: chosen, episodeId: visitId || null, priority, orderedBy: orderedBy.trim() || null,
        externalRef: externalRef.trim() || null, sampleCollected: collected,
      });
      onSaved(request);
    } catch (e) {
      fail("place the order", e);
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
                  {tests.length === 0 ? <>No tests yet. Add them in <Link href="/hospital/lab/tests" className="underline">Performing Tests</Link>.</> : "No test matches."}
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
        <Field label="Referring doctor"><Input value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} placeholder="Doctor name" /></Field>
        <Field label="Collection center reference"><Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="Optional, the center's own slip number" /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
          <input type="checkbox" checked={collected} onChange={(e) => setCollected(e.target.checked)} />
          Sample collected now
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-sm text-neutral-600">
          {chosen.length} test{chosen.length === 1 ? "" : "s"} · <span className="font-semibold tabular-nums">Rs {total.toFixed(0)}</span>
          {total > 0 && <span className="block text-xs text-neutral-400">Added to the patient&apos;s bill; Reception takes the fee before the lab starts.</span>}
        </span>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !patientId || chosen.length === 0}>{saving ? "Saving…" : "Register order"}</Button>
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
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      await enterLabResult(order.id, { result_value: value, unit: unit.trim() || null, ref_range: range.trim() || null, flag });
      onSaved();
    } catch (e) {
      fail("save the result", e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Result: ${order.test_name}`} onClose={onClose}>
      <div className="mb-4 grid grid-cols-2 gap-3">
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
      <p className="mb-3 text-xs text-neutral-500">The result is saved as &ldquo;Awaiting Verification&rdquo;. It is released to the patient only after a pathologist verifies it.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !value.trim()}>{saving ? "Saving…" : "Save result"}</Button>
      </div>
    </Modal>
  );
}
