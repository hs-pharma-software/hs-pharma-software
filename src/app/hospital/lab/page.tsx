"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { PatientPicker } from "@/components/hospital/PatientPicker";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import { listLabTests, listOpenVisits, orderLabTests } from "@/lib/repo/hospitalOpd";
import {
  labCapabilities, listLabWorklist, receiveSample, enterLabResult, verifyLabResult, returnLabResult, cancelLabTest, testStatusLabel,
  type LabCapabilities, type WorklistRow, type WorklistView,
} from "@/lib/repo/labReports";
import { panelFor, flagFor, rangeForSex, parseComponents, summarizeComponents, type PanelParam } from "@/config/labPanels";
import type { OrderPriority, HospitalService, HospitalEpisode, HospitalLabOrder, LabComponent, LabRequest } from "@/lib/types-hospital";

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
                              {!showResult || !t.result_value ? "—" : t.components ? <PanelResult json={t.components} /> : `${t.result_value} ${t.unit ?? ""}${t.flag && t.flag !== "N" ? ` (${t.flag})` : ""}`}
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
          <PatientPicker patients={patients} value={patientId} onChange={setPatientId} />
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

/** A panel result in the worklist: the abnormal values, and every parameter on
 * demand (so the pathologist sees them all before verifying). */
function PanelResult({ json }: { json: string }) {
  const parts = parseComponents(json);
  return (
    <details>
      <summary className="cursor-pointer">
        {summarizeComponents(parts.filter((c) => c.flag === "H" || c.flag === "L")) || "All in range"} <span className="text-xs text-neutral-400">({parts.length} parameters)</span>
      </summary>
      <table className="mt-1 text-xs">
        <tbody>
          {parts.map((c) => (
            <tr key={c.key}>
              <td className="pr-3 text-neutral-600">{c.name}</td>
              <td className={`pr-2 font-medium ${c.flag === "H" || c.flag === "L" ? "text-rose-600" : ""}`}>{c.value}{c.flag === "H" || c.flag === "L" ? ` ${c.flag}` : ""}</td>
              <td className="pr-2 text-neutral-500">{c.unit}</td>
              <td className="text-neutral-400">{c.ref_range}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function ResultModal({ order, onClose, onSaved }: { order: HospitalLabOrder; onClose: () => void; onSaved: () => void }) {
  const panel = panelFor(order.test_name);
  if (panel) return <PanelResultModal order={order} panel={panel} onClose={onClose} onSaved={onSaved} />;
  return <SingleResultModal order={order} onClose={onClose} onSaved={onSaved} />;
}

type PanelRow = { key: string; name: string; group: string | null; value: string; unit: string; range: string; flag: "N" | "H" | "L" | ""; auto: boolean };

/** CBC and other panels: one line per parameter with its default unit and
 * range; the flag follows the value and the patient's sex unless changed. */
function PanelResultModal({ order, panel, onClose, onSaved }: { order: HospitalLabOrder; panel: PanelParam[]; onClose: () => void; onSaved: () => void }) {
  const [gender, setGender] = useState<string | null>(null);
  const [rows, setRows] = useState<PanelRow[]>(() => {
    const saved = new Map(parseComponents(order.components).map((c) => [c.key, c]));
    return panel.map((p) => {
      const c = saved.get(p.key);
      return { key: p.key, name: p.name, group: p.group, value: c?.value ?? "", unit: c?.unit ?? p.unit, range: c?.ref_range ?? p.range, flag: c?.flag ?? "", auto: !c };
    });
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void hospitalPatientsRepo.get(order.patient_id).then((p) => setGender(p?.gender ?? null)).catch(() => setGender(null));
  }, [order.patient_id]);

  const flagOf = (r: PanelRow) => (r.auto ? flagFor(r.value, r.range, gender) ?? "" : r.flag);
  const set = (i: number, patch: Partial<PanelRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.value.trim());

  async function save() {
    if (!filled.length || saving) return;
    setSaving(true);
    try {
      const components: LabComponent[] = filled.map((r) => {
        const flag = flagOf(r);
        return { key: r.key, name: r.name, group: r.group, value: r.value.trim(), unit: r.unit.trim() || null, ref_range: r.range.trim() || null, flag: flag || null };
      });
      await enterLabResult(order.id, { result_value: summarizeComponents(components), unit: null, ref_range: null, flag: "N", components });
      onSaved();
    } catch (e) {
      fail("save the result", e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Result: ${order.test_name}`} onClose={onClose} width="max-w-3xl">
      <p className="mb-2 text-xs text-neutral-500">
        Enter the analyser values. H / L is set from the reference range{gender ? ` for ${gender.toLowerCase()} patients` : ""}; choose a flag to override it. Empty lines are left off the report.
      </p>
      <div className="mb-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <th className="pb-1 pr-2 font-medium">Parameter</th><th className="pb-1 pr-2 font-medium">Result</th><th className="pb-1 pr-2 font-medium">Unit</th>
            <th className="pb-1 pr-2 font-medium">Reference range</th><th className="pb-1 font-medium">Flag</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const flag = flagOf(r);
              const forSex = gender ? rangeForSex(r.range, gender) : null;
              return [
                r.group && r.group !== rows[i - 1]?.group
                  ? <tr key={`g-${r.key}`}><td colSpan={5} className="pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{r.group}</td></tr>
                  : null,
                <tr key={r.key} className="border-b border-neutral-50">
                  <td className="py-1 pr-2">{r.name}</td>
                  <td className="py-1 pr-2">
                    <Input id={`res-${r.key}`} value={r.value} onChange={(e) => set(i, { value: e.target.value })} autoFocus={i === 0} inputMode="decimal"
                      className={`w-24 tabular-nums ${flag === "H" || flag === "L" ? "font-semibold text-rose-600" : ""}`} />
                  </td>
                  <td className="py-1 pr-2"><Input value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} className="w-24" /></td>
                  <td className="py-1 pr-2">
                    <Input value={r.range} onChange={(e) => set(i, { range: e.target.value })} className="w-44" />
                    {forSex && forSex !== r.range.trim() && <span className="block text-[11px] text-neutral-400">Used: {forSex}</span>}
                  </td>
                  <td className="py-1">
                    <Select value={r.auto ? "auto" : r.flag} className="w-28"
                      onChange={(e) => set(i, e.target.value === "auto" ? { auto: true } : { auto: false, flag: e.target.value as PanelRow["flag"] })}>
                      <option value="auto">{r.auto && flag ? `Auto (${flag})` : "Auto"}</option>
                      <option value="N">Normal</option>
                      <option value="H">High</option>
                      <option value="L">Low</option>
                    </Select>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="mb-3 text-xs text-neutral-500">The result is saved as &ldquo;Awaiting Verification&rdquo;. It is released to the patient only after a pathologist verifies it.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !filled.length}>
          {saving ? "Saving…" : `Save ${filled.length} parameter${filled.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}

function SingleResultModal({ order, onClose, onSaved }: { order: HospitalLabOrder; onClose: () => void; onSaved: () => void }) {
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
