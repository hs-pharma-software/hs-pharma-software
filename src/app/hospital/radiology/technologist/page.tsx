"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ExternalLink, FileText, Monitor, Play, Save, Stethoscope, User, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import {
  listMachinesWithQueue, machineQueue, getExamContext, startExam, returnToQueue, saveExamDraft, completeExam, getPacs, imagesUrl,
  type MachineWithQueue, type ExamContext, type RadiologyPacs,
} from "@/lib/repo/radiologyPortal";
import type { WorklistOrder } from "@/lib/dicomApi";
import {
  PROTOCOLS, SAFETY_CHECKS, PREP_CHECKS, PATIENT_POSITIONS, IMAGE_QUALITY, validateExam, type ExamData,
} from "@/config/radiologyPortal";
import { Panel, Tabs, PriorityPill, StatusPill, ageGender, errMsg, openImages, imagesMissingReason, useAutoRefresh } from "@/components/hospital/radiology/common";

type ExamTab = "clinical" | "safety" | "protocol" | "acquisition";

/** The technologist's examination screen: pick a machine, call the next
 * patient from its queue, record the safety checks, protocol and
 * acquisition, and complete the examination for reporting. */
export default function TechnologistPage() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.currentUser?.id);
  const [machines, setMachines] = useState<MachineWithQueue[]>([]);
  const [machineId, setMachineId] = useState("");
  const [machineSearch, setMachineSearch] = useState("");
  const [queue, setQueue] = useState<WorklistOrder[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [orderId, setOrderId] = useState("");
  const [ctx, setCtx] = useState<ExamContext | null>(null);
  const [exam, setExam] = useState<ExamData | null>(null);
  const [tab, setTab] = useState<ExamTab>("clinical");
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [done, setDone] = useState<ExamContext | null>(null);
  const [pacs, setPacs] = useState<RadiologyPacs | null>(null);

  const machine = machines.find((m) => m.id === machineId) ?? null;

  const loadMachines = useCallback(async () => {
    if (!isTauri()) return;
    const ms = (await listMachinesWithQueue()).filter((m) => m.status === "active");
    setMachines(ms);
    setMachineId((id) => (ms.some((m) => m.id === id) ? id : ms.find((m) => m.assigned_user_id === userId)?.id ?? ""));
  }, [userId]);

  const loadQueue = useCallback(async () => {
    const m = machines.find((x) => x.id === machineId);
    setQueue(m ? await machineQueue(m) : []);
  }, [machines, machineId]);

  const { bar } = useAutoRefresh(async () => { await loadMachines(); }, 30);
  useEffect(() => { void loadQueue().catch(() => setQueue([])); }, [loadQueue]);
  useEffect(() => { if (isTauri()) void getPacs().then(setPacs).catch(() => setPacs(null)); }, []);

  async function openOrder(id: string) {
    setOrderId(id);
    try {
      const c = await getExamContext(id);
      setCtx(c);
      setExam(c.exam);
      setTab("clinical");
    } catch (e) {
      window.alert(errMsg(e));
    }
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { window.alert(errMsg(e)); } finally { setBusy(false); }
  }

  const start = () => act(async () => {
    await startExam(orderId, machineId);
    await openOrder(orderId);
    await loadQueue();
  });
  const backToQueue = () => act(async () => {
    if (exam) await saveExamDraft(orderId, exam);
    await returnToQueue(orderId);
    setCtx(null); setExam(null); setOrderId("");
    await loadQueue();
  });
  const draft = () => act(async () => { if (exam) { await saveExamDraft(orderId, exam); window.alert("Draft saved."); } });
  const complete = (confirm: boolean) => act(async () => {
    if (!exam || !ctx) return;
    const r = await completeExam(orderId, exam, confirm);
    if (r.warnings.length) { setWarnings(r.warnings); return; }
    setWarnings(null);
    setDone(await getExamContext(orderId));
    setCtx(null); setExam(null); setOrderId("");
    await loadMachines();
  });

  const inProgress = ctx?.order.status === "in_progress";
  const check = exam && ctx ? validateExam(exam, { gender: ctx.patient?.gender, ageYears: ctx.patient?.age_years }) : null;
  const shownMachines = machines.filter((m) => `${m.name} ${m.location ?? ""} ${m.modality_code}`.toLowerCase().includes(machineSearch.trim().toLowerCase()));
  const shownQueue = queue.filter((o) => `${o.patient_name} ${o.mr_no} ${o.study} ${o.order_no}`.toLowerCase().includes(patientSearch.trim().toLowerCase()));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Technologist · Examination</h1>
          <p className="text-sm text-neutral-500">Call patients from your machine&apos;s queue and record each examination.</p>
        </div>
        {bar}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(240px,1fr)_minmax(280px,1.3fr)_minmax(320px,1.6fr)]">
        {/* Machines and their queues */}
        <div className="flex flex-col gap-4">
          <Panel title="Available machines" icon={<Monitor size={18} />}>
            <Input id="tech-machine-search" value={machineSearch} onChange={(e) => setMachineSearch(e.target.value)} placeholder="Search machines by name or location" />
            <div className="mt-3 flex flex-col gap-2">
              {machines.length === 0 && <p className="text-sm text-neutral-500">No active machines. An administrator adds them on Radiology › Machines.</p>}
              {shownMachines.map((m) => (
                <button key={m.id} type="button" onClick={() => { setMachineId(m.id); setCtx(null); setOrderId(""); }}
                  className={`rounded-xl px-3 py-2.5 text-left ring-1 transition ${m.id === machineId ? "bg-sky-50 ring-sky-400" : "ring-neutral-200 hover:bg-neutral-50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{m.name}</span>
                    <span className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-neutral-300">{m.modality_code}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500">{m.location ?? "—"}{m.assigned_user_id === userId ? " · assigned to you" : m.assigned_user_name ? ` · ${m.assigned_user_name}` : ""}</div>
                  <div className="mt-1 text-sm">Queue: <span className="font-semibold tabular-nums">{m.queue}</span></div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Patient worklist" icon={<Users size={18} />} actions={machine && <span className="rounded-md px-2 py-0.5 text-xs ring-1 ring-neutral-300">{machine.name}</span>}>
            <Input id="tech-patient-search" value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} placeholder="Search patients by name, MR number or test" />
            <div className="mt-3 flex max-h-[520px] flex-col gap-2 overflow-y-auto">
              {!machine && <p className="py-6 text-center text-sm text-neutral-500">Select a machine to see its queue.</p>}
              {machine && shownQueue.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">Nobody is waiting. Paid orders of {machine.modality_code} appear here.</p>}
              {shownQueue.map((o) => (
                <button key={o.id} type="button" onClick={() => void openOrder(o.id)}
                  className={`rounded-xl px-3 py-2.5 text-left ring-1 transition ${o.id === orderId ? "bg-sky-50 ring-sky-400" : "ring-neutral-200 hover:bg-neutral-50"}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold">{o.patient_name}</span><PriorityPill priority={o.priority} /></div>
                  <div className="text-sm text-neutral-600">MR {o.mr_no}</div>
                  <div className="text-sm">{o.study}{o.body_part ? ` · ${o.body_part}` : ""}</div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-neutral-500">Queue #{queue.indexOf(o) + 1}</span><StatusPill status={o.status} />
                  </div>
                </button>
              ))}
            </div>
          </Panel>
        </div>

        {/* Patient */}
        <div className="flex flex-col gap-4">
          {!ctx ? (
            <Panel className="flex min-h-[320px] flex-col items-center justify-center text-center text-neutral-500">
              <User size={44} className="mb-3 text-neutral-300" />Select a patient from the worklist
            </Panel>
          ) : (
            <>
              <Panel title="Patient information" icon={<User size={18} />}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><dt className="text-neutral-500">Name</dt><dd className="font-semibold">{ctx.order.patient_name}</dd></div>
                  <div><dt className="text-neutral-500">MR number</dt><dd className="font-semibold">{ctx.order.mr_no}</dd></div>
                  <div><dt className="text-neutral-500">Age / gender</dt><dd className="font-semibold">{ageGender(ctx.order)}</dd></div>
                  <div><dt className="text-neutral-500">Contact</dt><dd className="font-semibold">{ctx.order.phone ?? "—"}</dd></div>
                </dl>
                <hr className="my-3 border-neutral-100" />
                <dl className="flex flex-col gap-2 text-sm">
                  <div><dt className="text-neutral-500">Examination</dt><dd className="font-semibold">{ctx.order.modality}{ctx.order.body_part ? ` · ${ctx.order.body_part}` : ""}</dd><dd className="text-neutral-500">{ctx.order.order_no} · {ctx.order.priority.toUpperCase()}</dd></div>
                  <div><dt className="text-neutral-500">Referring physician</dt><dd className="font-semibold">{ctx.order.ordered_by ?? "Not recorded"}</dd></div>
                  {ctx.patient?.allergies && <div className="rounded-lg bg-rose-50 px-2 py-1 text-rose-800"><dt className="font-medium">Allergies on record</dt><dd>{ctx.patient.allergies}</dd></div>}
                </dl>
              </Panel>
              <Panel title="Previous examinations" icon={<FileText size={18} />}>
                {ctx.previous.length === 0 && <p className="text-sm text-neutral-500">No earlier imaging in this hospital.</p>}
                <div className="flex flex-col gap-2">
                  {ctx.previous.map((p) => (
                    <div key={p.id} className="rounded-xl px-3 py-2 text-sm ring-1 ring-neutral-200">
                      <div className="flex justify-between gap-2"><span className="font-medium">{p.study}</span><span className="text-neutral-500">{p.ordered_at.slice(0, 10)}</span></div>
                      {p.impression && <div className="text-neutral-600">{p.impression}</div>}
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel>
                <div className="flex flex-col gap-2">
                  {!inProgress ? (
                    <Button variant="primary" className="justify-center" disabled={busy || !machine} onClick={() => void start()}><Play size={14} />Start examination</Button>
                  ) : (
                    <>
                      <Button variant="secondary" className="justify-center" disabled={busy} onClick={() => void draft()}><Save size={14} />Save draft</Button>
                      <Button variant="primary" className="justify-center" disabled={busy || Boolean(check?.errors.length)} onClick={() => void complete(false)}><CheckCircle2 size={14} />Complete examination</Button>
                      {check && check.errors.length > 0 && <p className="text-xs text-rose-700">{check.errors.join(" ")}</p>}
                      {check && !check.errors.length && check.warnings.length > 0 && <p className="text-xs text-amber-700">Review the warnings before completing.</p>}
                    </>
                  )}
                  <Button variant="ghost" className="justify-center" disabled={busy || !inProgress} onClick={() => void backToQueue()}><ArrowLeft size={14} />Return to queue</Button>
                  {!machine && <p className="text-xs text-neutral-500">Select the machine you are working on first.</p>}
                </div>
              </Panel>
            </>
          )}
        </div>

        {/* Examination */}
        <div>
          {!ctx || !exam ? (
            <Panel className="flex min-h-[320px] flex-col items-center justify-center text-center text-neutral-500">
              <Camera size={44} className="mb-3 text-neutral-300" />Select a patient to begin the examination
            </Panel>
          ) : !inProgress ? (
            <Panel className="flex min-h-[320px] flex-col items-center justify-center text-center text-neutral-500">
              <Camera size={44} className="mb-3 text-neutral-300" />Start the examination to open the examination form
            </Panel>
          ) : (
            <Panel title="Examination" icon={<Stethoscope size={18} />}>
              {check && (check.errors.length > 0 || check.warnings.length > 0) && (
                <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                  <div className="flex items-center gap-1.5 font-medium"><AlertTriangle size={14} />{check.errors.length} required, {check.warnings.length} warning{check.warnings.length === 1 ? "" : "s"}</div>
                  <ul className="mt-1 list-disc pl-5">{[...check.errors, ...check.warnings].map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}
              <Tabs<ExamTab> value={tab} onChange={setTab} tabs={[
                { key: "clinical", label: "Clinical" }, { key: "safety", label: "Safety" }, { key: "protocol", label: "Protocol" }, { key: "acquisition", label: "Acquisition" },
              ]} />
              <ExamForm tab={tab} exam={exam} setExam={setExam} modality={machine?.modality_code ?? ctx.order.modality_code ?? ""} female={ctx.order.gender === "Female"} />
            </Panel>
          )}
        </div>
      </div>

      {warnings && (
        <Modal title="Warning" onClose={() => setWarnings(null)} width="max-w-lg">
          <div className="flex gap-3 text-sm">
            <AlertTriangle className="shrink-0 text-amber-600" size={20} />
            <div>
              <ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              <p className="mt-2">Do you want to complete the examination anyway?</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setWarnings(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void complete(true)}>Proceed</Button>
          </div>
        </Modal>
      )}

      {done && (
        <Modal title="Examination completed" onClose={() => setDone(null)} width="max-w-lg">
          <p className="mb-3 text-sm text-neutral-600">The examination is saved and the study is in the radiologist&apos;s reporting queue.</p>
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-neutral-50 p-3 text-sm">
            <dt className="text-neutral-500">Name</dt><dd className="text-right font-medium">{done.order.patient_name}</dd>
            <dt className="text-neutral-500">MR number</dt><dd className="text-right font-medium">{done.order.mr_no}</dd>
            <dt className="text-neutral-500">Examination</dt><dd className="text-right font-medium">{done.order.modality}</dd>
          </dl>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setDone(null)}>Continue working</Button>
            <Button variant="secondary" onClick={() => openImages(imagesUrl(done.order, pacs, done.order.mr_no), imagesMissingReason(done.order, Boolean(pacs)))}><ExternalLink size={14} />View images</Button>
            <Button variant="primary" onClick={() => router.push("/hospital/radiology/reporting")}><ExternalLink size={14} />Go to reporting</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ExamForm({ tab, exam, setExam, modality, female }: { tab: ExamTab; exam: ExamData; setExam: (e: ExamData) => void; modality: string; female: boolean }) {
  const up = <K extends keyof ExamData>(section: K, patch: Partial<ExamData[K]>) => setExam({ ...exam, [section]: { ...exam[section], ...patch } });
  const box = (id: string, label: string, checked: boolean, onChange: (v: boolean) => void, required = false) => (
    <label key={id} htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}{required && <span className="text-rose-600">*</span>}
    </label>
  );

  if (tab === "clinical") {
    return (
      <div className="flex flex-col gap-3">
        <Field label="Clinical history"><Textarea id="ex-history" rows={3} value={exam.clinical.history} onChange={(e) => up("clinical", { history: e.target.value })} /></Field>
        <Field label="Indication / question to answer"><Input id="ex-indication" value={exam.clinical.indication} onChange={(e) => up("clinical", { indication: e.target.value })} /></Field>
        {female && <Field label="LMP (last menstrual period)"><Input id="ex-lmp" value={exam.clinical.lmp} onChange={(e) => up("clinical", { lmp: e.target.value })} placeholder="Date, or 'post-menopausal' / 'not applicable'" /></Field>}
        <Field label="Relevant previous imaging (other hospitals)"><Input id="ex-previous" value={exam.clinical.previousImaging} onChange={(e) => up("clinical", { previousImaging: e.target.value })} /></Field>
      </div>
    );
  }
  if (tab === "safety") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="mb-2 font-semibold">Allergy and contraindication checks</h3>
          <p className="mb-2 text-xs text-neutral-500">Tick what the patient has.</p>
          <div className="flex flex-col gap-2">
            {SAFETY_CHECKS.map((c) => box(`ex-s-${c.key}`, c.label, Boolean(exam.safety.checks[c.key]), (v) => up("safety", { checks: { ...exam.safety.checks, [c.key]: v } })))}
          </div>
          <div className="mt-2"><Field label="Other allergies / notes"><Input id="ex-other" value={exam.safety.otherNotes} onChange={(e) => up("safety", { otherNotes: e.target.value })} placeholder="Specify other allergies or concerns" /></Field></div>
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Patient preparation verification</h3>
          <div className="flex flex-col gap-2">
            {PREP_CHECKS.map((c) => box(`ex-p-${c.key}`, c.label, Boolean(exam.safety.prep[c.key]), (v) => up("safety", { prep: { ...exam.safety.prep, [c.key]: v } }), c.required))}
          </div>
          <p className="mt-2 text-xs text-rose-700">* Required before the examination can be completed.</p>
        </div>
      </div>
    );
  }
  if (tab === "protocol") {
    const list = PROTOCOLS[modality] ?? Object.values(PROTOCOLS).flat();
    return (
      <div className="flex flex-col gap-3">
        <Field label="Examination protocol">
          <Select id="ex-protocol" value={exam.protocol.name} onChange={(e) => up("protocol", { name: e.target.value })}>
            <option value="">None (no protocol)</option>
            {list.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <h3 className="font-semibold">Technical parameters</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="kVp"><Input id="ex-kvp" inputMode="decimal" value={exam.protocol.kvp} onChange={(e) => up("protocol", { kvp: e.target.value })} placeholder="e.g. 70" /></Field>
          <Field label="mAs"><Input id="ex-mas" inputMode="decimal" value={exam.protocol.mas} onChange={(e) => up("protocol", { mas: e.target.value })} placeholder="e.g. 10" /></Field>
          <Field label="Slice thickness (mm)"><Input id="ex-slice" inputMode="decimal" value={exam.protocol.sliceThickness} onChange={(e) => up("protocol", { sliceThickness: e.target.value })} placeholder="CT / MRI" /></Field>
          <Field label="Field of view (cm)"><Input id="ex-fov" inputMode="decimal" value={exam.protocol.fov} onChange={(e) => up("protocol", { fov: e.target.value })} /></Field>
          <div className="col-span-2"><Field label="Radiation dose (DAP / CTDIvol / DLP)"><Input id="ex-dose" value={exam.protocol.dose} onChange={(e) => up("protocol", { dose: e.target.value })} placeholder="e.g. DLP 420 mGy·cm" /></Field></div>
        </div>
        {box("ex-contrast", "Contrast administration", exam.protocol.contrast, (v) => up("protocol", { contrast: v }))}
        {exam.protocol.contrast && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contrast agent"><Input id="ex-agent" value={exam.protocol.contrastAgent} onChange={(e) => up("protocol", { contrastAgent: e.target.value })} placeholder="e.g. Iohexol 350" /></Field>
            <Field label="Volume (ml)"><Input id="ex-volume" inputMode="decimal" value={exam.protocol.contrastVolume} onChange={(e) => up("protocol", { contrastVolume: e.target.value })} /></Field>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Patient position">
        <Select id="ex-position" value={exam.acquisition.position} onChange={(e) => up("acquisition", { position: e.target.value })}>
          <option value="">—</option>{PATIENT_POSITIONS.map((p) => <option key={p}>{p}</option>)}
        </Select>
      </Field>
      <Field label="Image quality">
        <Select id="ex-quality" value={exam.acquisition.quality} onChange={(e) => up("acquisition", { quality: e.target.value })}>
          <option value="">—</option>{IMAGE_QUALITY.map((p) => <option key={p}>{p}</option>)}
        </Select>
      </Field>
      <Field label="Number of series"><Input id="ex-series" type="number" min={0} value={exam.acquisition.series} onChange={(e) => up("acquisition", { series: e.target.value })} /></Field>
      <Field label="Images per series"><Input id="ex-images" type="number" min={0} value={exam.acquisition.imagesPerSeries} onChange={(e) => up("acquisition", { imagesPerSeries: e.target.value })} /></Field>
      <div className="col-span-2"><Field label="Breath-hold instructions"><Input id="ex-breath" value={exam.acquisition.breathHold} onChange={(e) => up("acquisition", { breathHold: e.target.value })} placeholder="e.g. Hold breath for 15 seconds" /></Field></div>
      <div className="col-span-2"><Field label="Anatomical markers"><Input id="ex-markers" value={exam.acquisition.markers} onChange={(e) => up("acquisition", { markers: e.target.value })} placeholder="e.g. Left / Right markers placed" /></Field></div>
      <div className="col-span-2"><Field label="Technologist notes"><Textarea id="ex-notes" rows={3} value={exam.acquisition.techNotes} onChange={(e) => up("acquisition", { techNotes: e.target.value })} placeholder="Technique, patient cooperation, image quality notes" /></Field></div>
      <div className="col-span-2"><Field label="Quality comments"><Textarea id="ex-qc" rows={2} value={exam.acquisition.qualityComments} onChange={(e) => up("acquisition", { qualityComments: e.target.value })} placeholder="Image quality issues, if any" /></Field></div>
    </div>
  );
}
