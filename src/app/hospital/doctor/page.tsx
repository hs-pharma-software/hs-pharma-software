"use client";

import { useEffect, useRef, useState } from "react";
import { BedDouble, FileText, History, Printer, Send, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { hospitalEpisodesRepo, hospitalPatientsRepo, hospitalServicesRepo, type HospitalPatient, type HospitalService } from "@/lib/repo/hospital";
import { getPatientHistory, type HistoryVisit } from "@/lib/repo/hospitalCare";
import {
  staffForCurrentUser, listHospitalDoctors, listOpdQueue, ownDoctorScope, saveConsultationNotes, listRx, saveRx, sendRxToPharmacy,
  orderInvestigation, listVisitOrders, type OpdQueueRow, type RxDraft,
} from "@/lib/repo/hospitalOpd";
import { getPharmacyLink, listPharmacyTenants, searchProductsForPharmacy } from "@/lib/repo/clinic";
import { getLabReport, type LabReport } from "@/lib/repo/labReports";
import { getRadiologyReport, type RadiologyReport } from "@/lib/repo/radiology";
import { LabReportModal } from "@/components/hospital/LabReportModal";
import { RadiologyReportModal } from "@/components/hospital/RadiologyReportModal";
import type { HospitalEpisode } from "@/lib/types-hospital";
import { AdmitModal, AdmissionBadge } from "@/components/hospital/AdmitModal";
import { VisitChecklist } from "@/components/hospital/record/EpisodeRecord";
import type { Staff } from "@/lib/types";
import { listVitals, recordVitals } from "@/lib/repo/medicalRecord";
import { VitalsFields } from "@/components/hospital/VitalsFields";
import { PrescriptionPrintModal } from "@/components/hospital/PrescriptionPrint";
import { listSelectedBrands, type BrandSelection } from "@/lib/repo/brandSelections";
import { cToF, fToC, vitalsSummary, type VitalValues } from "@/config/vitalNorms";
import { notify } from "@/lib/notify";

type Product = { id: string; name: string; barcode: string | null; company_name: string | null; description: string | null };
type VisitOrder = Awaited<ReturnType<typeof listVisitOrders>>[number];

const EMPTY_LINE: RxDraft = { product_id: null, product_name: "", generic_name: null, dose: "1", route: "Oral", frequency: "", duration: "", qty: 1, instructions: null };
const FREQUENCIES = ["OD (once a day)", "BD (twice a day)", "TDS (three times)", "QID (four times)", "HS (at night)", "SOS (when needed)"];

export default function DoctorDeskPage() {
  const [me, setMe] = useState<Staff | null>(null);
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(localDate());
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<OpdQueueRow[] | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const visitRef = useRef<HTMLDivElement>(null);

  // On a phone the visit sits below the queue: bring it into view when a patient is chosen.
  useEffect(() => {
    if (!visitId || window.matchMedia("(min-width: 1280px)").matches) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    visitRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }, [visitId]);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      const [mine, all] = await Promise.all([staffForCurrentUser(), listHospitalDoctors()]);
      setDoctors(all);
      if (mine && all.some((d) => d.id === mine.id)) {
        setMe(mine);
        setDoctorId(mine.id);
      }
    })();
  }, []);

  async function reloadQueue() {
    if (!isTauri()) return;
    try {
      setQueue(await listOpdQueue({ date, doctorId: doctorId || null, search }));
    } catch (e) {
      setQueue([]);
      notify(`Could not load the patients: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  useEffect(() => { void reloadQueue(); }, [date, doctorId, search]);

  return (
    <div>
      <PageHeader title={me ? `Doctor Desk · ${me.name}` : "Doctor Desk"} actions={<Button onClick={() => void reloadQueue()}>Refresh</Button>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <div className="mb-3 grid grid-cols-1 gap-2">
            {!me && (
              <Field label="Doctor">
                <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                  <option value="">All doctors</option>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.designation}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Find patient"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Slip no, token, name, MR or phone" /></Field>
          </div>
          {queue === null ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the patients">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-neutral-100" />)}
            </div>
          ) : queue.length === 0 ? <p className="fade-in py-4 text-center text-sm text-neutral-400">No patients.</p> : (
            <div className="flex flex-col divide-y divide-neutral-100">
              {queue.map((q, i) => (
                <button key={q.id} type="button" onClick={() => setVisitId(q.id)} aria-current={visitId === q.id ? "true" : undefined}
                  style={i < 12 ? { animationDelay: `${i * 25}ms` } : undefined}
                  className={`${i < 12 ? "row-in " : ""}flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors duration-150 hover:bg-amber-50 ${visitId === q.id ? "bg-amber-50 shadow-[inset_3px_0_0_var(--accent)]" : ""}`}>
                  <span className="w-8 shrink-0 text-lg font-bold tabular-nums">{q.token_no ?? "—"}</span>
                  <span className="flex-1">
                    <span className="font-medium">{q.patient_name}</span>
                    <span className="block font-mono text-[11px] text-neutral-400">{q.episode_no}{!me && q.doctor_name ? ` · ${q.doctor_name}` : ""}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${q.consult_status === "done" ? "bg-emerald-100 text-emerald-700" : q.consult_status === "in_consultation" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-800"}`}>
                    {q.consult_status === "done" ? "Seen" : q.consult_status === "in_consultation" ? "With doctor" : "Waiting"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={visitRef} className="scroll-mt-4 xl:col-span-2">
          {visitId ? <Visit key={visitId} episodeId={visitId} onChanged={() => void reloadQueue()} /> : (
            <div className="rounded-2xl bg-white p-8 text-center text-sm text-neutral-400 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
              Choose a patient from the list.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Visit({ episodeId, onChanged }: { episodeId: string; onChanged: () => void }) {
  const [ep, setEp] = useState<HospitalEpisode | null>(null);
  const [patient, setPatient] = useState<HospitalPatient | null>(null);
  const [notes, setNotes] = useState({ complaint: "", vitals: "", findings: "", diagnosis: "", advice: "", followup_date: "" });
  const [lines, setLines] = useState<RxDraft[]>([]);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [orders, setOrders] = useState<VisitOrder[]>([]);
  const [services, setServices] = useState<HospitalService[]>([]);
  const [labId, setLabId] = useState("");
  const [scanId, setScanId] = useState("");
  const [visitCount, setVisitCount] = useState(0);
  const [admission, setAdmission] = useState<HospitalEpisode | null>(null);
  const [declined, setDeclined] = useState<HospitalEpisode | null>(null);
  const [labReport, setLabReport] = useState<LabReport | null>(null);
  const [scanReport, setScanReport] = useState<RadiologyReport | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdmit, setShowAdmit] = useState(false);
  const [pharmacyId, setPharmacyId] = useState("");
  const [pharmacies, setPharmacies] = useState<{ id: string; name: string }[]>([]);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  // The administrator's Selected Brands: doctors prescribe by generic; the brand goes on the print and to the pharmacy.
  const [brands, setBrands] = useState<BrandSelection[]>([]);
  const [printing, setPrinting] = useState(false);
  // Which action is running ("save the notes", "send the prescription"…): only its button spins.
  const [busyWhat, setBusyWhat] = useState<string | null>(null);
  const busy = busyWhat !== null;
  const [savedNotes, setSavedNotes] = useState("");
  const [rxTried, setRxTried] = useState(false);
  const [active, setActive] = useState(0);
  const [vit, setVit] = useState<VitalValues>({});
  const [vitDirty, setVitDirty] = useState(false);
  const [denied, setDenied] = useState(false);

  async function load() {
    const e = await hospitalEpisodesRepo.get(episodeId);
    // A doctor opens only their own patients' visits.
    const own = await ownDoctorScope();
    if (e && own && e.doctor_id !== own) { setDenied(true); return; }
    setEp(e);
    if (!e) return;
    setPatient(await hospitalPatientsRepo.get(e.patient_id));
    const earlier = await hospitalEpisodesRepo.list({ where: "patient_id = ? AND id != ?", params: [e.patient_id, e.id] });
    setVisitCount(earlier.length);
    const fromHere = earlier.filter((x) => x.from_episode_id === e.id);
    setAdmission(fromHere.find((x) => x.status !== "cancelled") ?? null);
    setDeclined(fromHere.find((x) => x.admission_status === "declined") ?? null);
    const loaded = { complaint: e.complaint ?? "", vitals: e.vitals ?? "", findings: e.findings ?? "", diagnosis: e.diagnosis ?? "", advice: e.advice ?? "", followup_date: e.followup_date ?? "" };
    setNotes(loaded);
    setSavedNotes(JSON.stringify(loaded));
    const rx = await listRx(episodeId);
    setLines(rx.length ? rx.map((r) => ({ product_id: r.product_id, product_name: r.product_name, generic_name: r.generic_name, dose: r.dose, route: r.route, frequency: r.frequency, duration: r.duration, qty: r.qty, instructions: r.instructions })) : []);
    setSentAt(rx.find((r) => r.sent_at)?.sent_at ?? null);
    setOrders(await listVisitOrders(episodeId));
    // The latest vital signs of this visit (taken by the nurse or the doctor).
    const last = (await listVitals(episodeId).catch(() => [])).at(-1);
    const str = (n: number | null | undefined) => (n == null ? "" : String(n));
    setVit(last ? {
      bp_systolic: str(last.bp_systolic), bp_diastolic: str(last.bp_diastolic), pulse: str(last.pulse),
      temperature_f: last.temperature_c == null ? "" : String(cToF(last.temperature_c)), spo2: str(last.spo2), resp_rate: str(last.resp_rate),
      weight_kg: str(last.weight_kg), blood_sugar: str(last.blood_sugar),
    } : {});
    setVitDirty(false);
  }

  /** Saves the notes; vital signs entered here are recorded as a reading and summarised in the notes. */
  async function saveNotes(status: "in_consultation" | "done") {
    if (!ep) return;
    let vitals = notes.vitals;
    if (vitDirty && Object.values(vit).some((x) => (x ?? "").trim() !== "")) {
      const num = (x: string | undefined) => ((x ?? "").trim() === "" ? null : Number(x));
      const t = num(vit.temperature_f);
      await recordVitals(ep.id, {
        bp_systolic: num(vit.bp_systolic), bp_diastolic: num(vit.bp_diastolic), pulse: num(vit.pulse), temperature_c: t == null ? null : fToC(t),
        spo2: num(vit.spo2), resp_rate: num(vit.resp_rate), weight_kg: num(vit.weight_kg), blood_sugar: num(vit.blood_sugar),
      });
      vitals = vitalsSummary(vit);
    }
    await saveConsultationNotes(ep.id, { ...notes, vitals, followup_date: notes.followup_date || null, consult_status: status });
  }

  useEffect(() => {
    void load();
    void hospitalServicesRepo.list({ orderBy: "name ASC" }).then((s) => setServices(s.filter((x) => x.is_active && (x.category === "lab" || x.category === "imaging"))));
    void listPharmacyTenants().then(setPharmacies);
    void getPharmacyLink().then((l) => setPharmacyId(l?.pharmacy_tenant_id ?? ""));
    void listSelectedBrands().then(setBrands).catch(() => setBrands([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  const byGeneric = brands.length > 0;
  const genericMatches = byGeneric && term.trim().length >= 2
    ? brands.filter((b) => b.generic_label.toLowerCase().includes(term.trim().toLowerCase())).slice(0, 20) : [];

  // No brands chosen yet: the linked pharmacy's medicines, by brand or generic name.
  useEffect(() => {
    if (byGeneric || !pharmacyId || term.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      void searchProductsForPharmacy(term, pharmacyId).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [term, pharmacyId, byGeneric]);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusyWhat(what);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      notify(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyWhat(null);
    }
  };

  // Medicine search: one list for both kinds of match, driven by the arrow keys too.
  const options: { key: string; label: string; sub?: string; pick: () => void }[] = genericMatches.length > 0
    ? genericMatches.map((b) => ({
        key: b.id, label: b.generic_label,
        pick: () => setLines((ls) => [...ls, { ...EMPTY_LINE, product_id: b.product_id, product_name: b.product_name, generic_name: b.generic_label }]),
      }))
    : results.map((p) => ({
        key: p.id, label: p.name, sub: [p.description, p.company_name].filter(Boolean).join(" · ") || undefined,
        pick: () => setLines((ls) => [...ls, { ...EMPTY_LINE, product_id: p.id, product_name: p.name, generic_name: p.description }]),
      }));
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    o.pick();
    setTerm("");
    setResults([]);
    setActive(0);
  };
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setTerm(""); setResults([]); return; }
    if (options.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(Math.min(active, options.length - 1)); }
  };

  // A line the pharmacy cannot dispense as written: no frequency, or no quantity.
  const lineProblem = (l: RxDraft) => (!l.frequency ? "frequency" : !(Number(l.qty) >= 1) ? "qty" : null);
  /** Before printing or sending: every line needs a frequency and a quantity. */
  const rxReady = () => {
    const bad = lines.findIndex((l) => lineProblem(l) !== null);
    if (bad < 0) return true;
    setRxTried(true);
    notify("Some medicines need a frequency or a quantity (marked in red).");
    // The table (computer) or the cards (phone): focus whichever is on screen.
    const field = lineProblem(lines[bad]);
    [`rx-${bad}-${field}`, `rxm-${bad}-${field}`].map((id) => document.getElementById(id)).find((el) => el?.offsetParent)?.focus();
    return false;
  };

  // The treating doctor opens the report of this visit's own order, so the
  // patient's identity is already established.
  async function viewReport(o: VisitOrder) {
    try {
      if (o.kind === "lab") {
        if (!o.request_id) throw new Error("This test is not linked to a lab report.");
        setLabReport(await getLabReport(o.request_id, { checked: true, method: `treating doctor, visit ${ep?.episode_no ?? ""}` }));
      } else {
        setScanReport(await getRadiologyReport(o.id));
      }
    } catch (e) {
      notify(`Could not open the report: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const setLine = (i: number, patch: Partial<RxDraft>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  if (denied) return <p className="p-6 text-sm text-rose-600">This patient is another doctor&apos;s. You see only your own patients.</p>;
  if (!ep) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;
  const card = "rise-in rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5";
  const notesDirty = JSON.stringify(notes) !== savedNotes || vitDirty;
  const followupPast = Boolean(notes.followup_date) && notes.followup_date < localDate();
  const focusFollowup = () => document.getElementById("dd-followup")?.focus();
  const listOpen = options.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <p className="text-lg font-semibold">{patient?.name} <span className="text-sm font-normal text-neutral-500">{patient?.mr_no}</span></p>
          <p className="text-xs text-neutral-500">
            Token {ep.token_no ?? "—"} · {ep.episode_no}
            {patient?.gender ? ` · ${patient.gender}` : ""}{patient?.age_years != null ? ` · ${patient.age_years}y` : ""}{patient?.blood_group ? ` · ${patient.blood_group}` : ""}
          </p>
          {patient?.allergies && <p className="mt-1 text-xs font-medium text-rose-600">Allergies: {patient.allergies}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/hospital/patients/record?id=${ep.patient_id}`} className="inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium text-neutral-700 ring-1 ring-black/[0.06] hover:bg-neutral-50">Patient record</a>
          <Button onClick={() => setShowHistory(true)} disabled={visitCount === 0} title={visitCount === 0 ? "First visit: no earlier history" : undefined}>
            <History size={13} className="mr-1" /> History{visitCount > 0 ? ` (${visitCount})` : ""}
          </Button>
          {ep.type !== "ipd" && <AdmissionBadge admission={admission} declined={declined} />}
          {ep.type !== "ipd" && !admission && <Button onClick={() => setShowAdmit(true)}><BedDouble size={13} className="mr-1" /> Admit</Button>}
          {ep.consult_status !== "in_consultation" && ep.consult_status !== "done" && (
            <Button loading={busyWhat === "start"} disabled={busy} onClick={() => void run("start", () => saveConsultationNotes(ep.id, { consult_status: "in_consultation" }))}>Start</Button>
          )}
          {ep.consult_status !== "done" && (
            <Button variant="primary" loading={busyWhat === "finish"} disabled={busy}
              onClick={() => { if (followupPast) { focusFollowup(); return; } void run("finish", () => saveNotes("done")); }}>Finish visit</Button>
          )}
        </div>
      </div>

      <VisitChecklist episodeId={ep.id} />

      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-neutral-700">Consultation</h3>
        <div className="mb-3 rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]">
          <p className="mb-2 text-xs font-semibold text-neutral-600">Vitals</p>
          <VitalsFields value={vit} onChange={(v) => { setVit(v); setVitDirty(true); }} />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Complaint"><Textarea rows={2} value={notes.complaint} onChange={(e) => setNotes({ ...notes, complaint: e.target.value })} /></Field>
          <Field label="Examination"><Textarea rows={2} value={notes.findings} onChange={(e) => setNotes({ ...notes, findings: e.target.value })} /></Field>
          <Field label="Diagnosis"><Textarea rows={2} value={notes.diagnosis} onChange={(e) => setNotes({ ...notes, diagnosis: e.target.value })} /></Field>
          <Field label="Advice"><Textarea rows={2} value={notes.advice} onChange={(e) => setNotes({ ...notes, advice: e.target.value })} /></Field>
          <Field label="Follow-up date" error={followupPast ? "The follow-up date has passed: choose a later day" : undefined}>
            <Input id="dd-followup" type="date" min={localDate()} value={notes.followup_date} aria-invalid={followupPast || undefined}
              onChange={(e) => setNotes({ ...notes, followup_date: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          {notesDirty && (
            <span role="status" className="fade-in mr-auto flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />Changes not saved yet
            </span>
          )}
          <Button loading={busyWhat === "save the notes"} disabled={busy}
            onClick={() => { if (followupPast) { focusFollowup(); return; } void run("save the notes", () => saveNotes(ep.consult_status === "done" ? "done" : "in_consultation")); }}>
            Save notes
          </Button>
        </div>
      </div>

      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-semibold text-neutral-700">Prescription</h3>
          <div className="w-full sm:w-64">
            <p className="text-xs text-neutral-500">Linked pharmacy</p>
            <p className="text-sm font-medium text-neutral-800">
              {pharmacyId ? pharmacies.find((p) => p.id === pharmacyId)?.name ?? "Hospital pharmacy" : <span className="text-amber-700">None: link one in Hospital &gt; Profile</span>}
            </p>
          </div>
        </div>

        <div className="relative mb-3">
          <Input value={term} onChange={(e) => { setTerm(e.target.value); setActive(0); }} onKeyDown={onSearchKey} disabled={!pharmacyId && !byGeneric}
            role="combobox" aria-expanded={listOpen} aria-controls="dd-med-list" aria-autocomplete="list" aria-label="Search medicine"
            aria-activedescendant={listOpen ? `dd-med-${Math.min(active, options.length - 1)}` : undefined}
            placeholder={byGeneric ? "Search medicine by generic name, e.g. Omeprazole…" : pharmacyId ? "Search medicine by brand or generic name…" : "Link the hospital pharmacy to search its medicines"} />
          {!byGeneric && pharmacyId && <p className="mt-1 text-[11px] text-amber-700">The administrator has not chosen brands yet (Pharmacy Department › Selected Brands): brand names are shown.</p>}
          {listOpen && (
            <div id="dd-med-list" role="listbox" className="pop-in absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
              {options.map((o, i) => (
                <button key={o.key} id={`dd-med-${i}`} type="button" role="option" aria-selected={i === active} tabIndex={-1}
                  onMouseEnter={() => setActive(i)} onClick={() => choose(i)}
                  className={`block min-h-10 w-full px-3 py-2 text-left text-sm ${i === active ? "bg-amber-50" : ""}`}>
                  <span className="font-medium">{o.label}</span>
                  {o.sub && <span className="ml-2 text-xs text-neutral-500">{o.sub}</span>}
                </button>
              ))}
            </div>
          )}
          {byGeneric && term.trim().length >= 2 && genericMatches.length === 0 && <p className="mt-1 text-[11px] text-neutral-500">Not among the hospital&apos;s selected medicines. Ask the administrator to add it in Pharmacy Department › Selected Brands.</p>}
        </div>

        {lines.length === 0 ? <p className="text-sm text-neutral-400">No medicines yet.</p> : (<>
          {/* Phone: one card per medicine. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {lines.map((l, i) => {
              const bad = rxTried ? lineProblem(l) : null;
              return (
                <li key={i} className="row-in rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{byGeneric && l.generic_name ? l.generic_name : l.product_name}
                      {!(byGeneric && l.generic_name) && l.generic_name && <span className="block text-xs font-normal text-neutral-400">{l.generic_name}</span>}</p>
                    <button type="button" aria-label={`Remove ${l.product_name}`} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center text-neutral-400 hover:text-rose-500"><Trash2 size={16} /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Dose"><Input value={l.dose ?? ""} onChange={(e) => setLine(i, { dose: e.target.value })} /></Field>
                    <Field label="Days"><Input inputMode="numeric" value={l.duration ?? ""} onChange={(e) => setLine(i, { duration: e.target.value })} placeholder="5" /></Field>
                    <Field label="Qty" error={bad === "qty" ? "At least 1" : undefined}>
                      <Input id={`rxm-${i}-qty`} type="number" inputMode="numeric" min="1" value={l.qty} aria-invalid={bad === "qty" || undefined} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
                    </Field>
                    <div className="col-span-3">
                      <Field label="Frequency" error={bad === "frequency" ? "Choose how often" : undefined}>
                        <Select id={`rxm-${i}-frequency`} value={l.frequency ?? ""} aria-invalid={bad === "frequency" || undefined} onChange={(e) => setLine(i, { frequency: e.target.value })}>
                          <option value="">—</option>
                          {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                        </Select>
                      </Field>
                    </div>
                    <div className="col-span-3">
                      <Field label="Instructions"><Input value={l.instructions ?? ""} onChange={(e) => setLine(i, { instructions: e.target.value })} placeholder="After meals" /></Field>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-neutral-100 text-left text-neutral-500">
                <th className="pb-1.5 pr-2 font-medium">Medicine</th><th className="pb-1.5 pr-2 font-medium">Dose</th><th className="pb-1.5 pr-2 font-medium">Frequency</th>
                <th className="pb-1.5 pr-2 font-medium">Days</th><th className="pb-1.5 pr-2 font-medium">Qty</th><th className="pb-1.5 pr-2 font-medium">Instructions</th><th />
              </tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const bad = rxTried ? lineProblem(l) : null;
                  return (
                  <tr key={i} className="row-in border-b border-neutral-50 align-top">
                    <td className="py-1 pr-2">{byGeneric && l.generic_name
                      ? <span className="font-medium">{l.generic_name}</span>
                      : <><span className="font-medium">{l.product_name}</span>{l.generic_name && <span className="block text-neutral-400">{l.generic_name}</span>}</>}</td>
                    <td className="py-1 pr-2"><Input aria-label="Dose" value={l.dose ?? ""} onChange={(e) => setLine(i, { dose: e.target.value })} className="w-16" /></td>
                    <td className="py-1 pr-2">
                      <Select id={`rx-${i}-frequency`} aria-label="Frequency" value={l.frequency ?? ""} aria-invalid={bad === "frequency" || undefined}
                        title={bad === "frequency" ? "Choose how often" : undefined} onChange={(e) => setLine(i, { frequency: e.target.value })} className="w-40">
                        <option value="">—</option>
                        {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                      </Select>
                    </td>
                    <td className="py-1 pr-2"><Input aria-label="Days" value={l.duration ?? ""} onChange={(e) => setLine(i, { duration: e.target.value })} className="w-16" placeholder="5" /></td>
                    <td className="py-1 pr-2"><Input id={`rx-${i}-qty`} aria-label="Quantity" type="number" min="1" value={l.qty} aria-invalid={bad === "qty" || undefined}
                      title={bad === "qty" ? "At least 1" : undefined} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className="w-16" /></td>
                    <td className="py-1 pr-2"><Input aria-label="Instructions" value={l.instructions ?? ""} onChange={(e) => setLine(i, { instructions: e.target.value })} placeholder="After meals" /></td>
                    <td className="py-1"><button type="button" aria-label={`Remove ${l.product_name}`} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rxTried && lines.some((l) => lineProblem(l)) && (
            <p role="alert" className="field-msg mt-2 text-xs text-rose-600">Choose a frequency and a quantity for the medicines marked in red.</p>
          )}
        </>)}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {sentAt && <span className="mr-auto text-xs text-emerald-700">Sent to the pharmacy.</span>}
          <Button loading={busyWhat === "save the prescription"} onClick={() => void run("save the prescription", () => saveRx(ep.id, lines))} disabled={busy}>Save prescription</Button>
          <Button loading={busyWhat === "print the prescription"} disabled={busy || lines.length === 0}
            onClick={() => { if (rxReady()) void run("print the prescription", async () => { await saveRx(ep.id, lines); setPrinting(true); }); }}>
            <Printer size={13} className="mr-1" /> Print
          </Button>
          <Button variant="primary" loading={busyWhat === "send the prescription"} disabled={busy || lines.length === 0 || !pharmacyId}
            title={!pharmacyId ? "Link the hospital pharmacy in Hospital > Profile first" : undefined}
            onClick={() => { if (rxReady()) void run("send the prescription", async () => { await saveRx(ep.id, lines); await sendRxToPharmacy(ep.id); }); }}>
            <Send size={13} className="mr-1" /> Send to pharmacy
          </Button>
        </div>
      </div>

      <OrderSection title="Lab tests" kind="lab" card={card} busy={busy} ordering={busyWhat === "order the test"} orders={orders.filter((o) => o.kind === "lab")}
        services={services.filter((s) => s.category === "lab")} value={labId} onChange={setLabId}
        emptyHint="Add lab tests and their fees in Labs › Performing Tests."
        onOrder={() => void run("order the test", async () => { await orderInvestigation(ep.id, labId); setLabId(""); })} onView={(o) => void viewReport(o)} />
      <OrderSection title="Radiology" kind="imaging" card={card} busy={busy} ordering={busyWhat === "order the scan"} orders={orders.filter((o) => o.kind !== "lab")}
        services={services.filter((s) => s.category === "imaging")} value={scanId} onChange={setScanId}
        emptyHint="Add radiology studies (X-ray, ultrasound, CT…) with their fees in Service Master, category Imaging / Radiology."
        onOrder={() => void run("order the scan", async () => { await orderInvestigation(ep.id, scanId); setScanId(""); })} onView={(o) => void viewReport(o)} />

      {printing && patient && <PrescriptionPrintModal episodeId={ep.id} onClose={() => setPrinting(false)} />}
      {showHistory && patient && <HistoryModal patientId={patient.id} excludeId={ep.id} name={patient.name} onClose={() => setShowHistory(false)} />}
      {labReport && <LabReportModal report={labReport} onClose={() => setLabReport(null)} />}
      {scanReport && <RadiologyReportModal report={scanReport} onClose={() => setScanReport(null)} />}
      {showAdmit && <AdmitModal episode={ep} onClose={() => setShowAdmit(false)} onDone={() => { setShowAdmit(false); void load(); onChanged(); }} />}
    </div>
  );
}

function OrderSection({ title, kind, card, busy, ordering, orders, services, value, onChange, onOrder, onView, emptyHint }: {
  title: string; kind: "lab" | "imaging"; card: string; busy: boolean; ordering: boolean; orders: VisitOrder[]; services: HospitalService[];
  value: string; onChange: (id: string) => void; onOrder: () => void; onView: (o: VisitOrder) => void; emptyHint: string;
}) {
  const [tried, setTried] = useState(false);
  const selectId = `dd-order-${kind}`;
  const missing = tried && !value;
  return (
    <div className={card}>
      <h3 className="mb-3 text-sm font-semibold text-neutral-700">{title}</h3>
      <div className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <Select id={selectId} aria-label={title} value={value} aria-invalid={missing || undefined}
            onChange={(e) => { onChange(e.target.value); setTried(false); }} disabled={services.length === 0}>
            <option value="">{kind === "lab" ? "— Choose a lab test —" : "— Choose a radiology study —"}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.sample_type ? ` (${s.sample_type})` : ""} · Rs {Number(s.rate).toFixed(0)}</option>
            ))}
          </Select>
          {missing && <p role="alert" className="field-msg mt-1 text-xs text-rose-600">{kind === "lab" ? "Choose the test first." : "Choose the study first."}</p>}
        </div>
        <Button variant="primary" loading={ordering} disabled={busy || services.length === 0}
          onClick={() => { if (!value) { setTried(true); document.getElementById(selectId)?.focus(); return; } onOrder(); }}>
          {kind === "lab" ? "Order test" : "Order scan"}
        </Button>
      </div>
      {services.length === 0 && <p className="mb-2 text-xs text-neutral-400">{emptyHint}</p>}
      {orders.length === 0 ? <p className="text-sm text-neutral-400">Nothing ordered.</p> : (
        <div className="flex flex-col divide-y divide-neutral-100 text-sm">
          {orders.map((o) => {
            const unpaid = o.fee > 0 && !o.paid;
            return (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{o.name} <span className="text-xs font-normal text-neutral-400">{o.order_no}</span></p>
                  {o.result && <p className="text-xs text-neutral-600">Result: {o.result}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {o.status === "reported" && (
                    <Button variant="ghost" onClick={() => onView(o)}><FileText size={13} className="mr-1" />View report</Button>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${unpaid ? "bg-rose-100 text-rose-700" : o.status === "reported" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                    {unpaid ? `Fee Rs ${o.fee.toFixed(0)} unpaid` : o.status === "reported" ? "Reported" : "Paid · in progress"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
const TYPE_LABEL: Record<string, string> = { opd: "OPD", ipd: "Admission", emergency: "Emergency" };

function HistoryModal({ patientId, excludeId, name, onClose }: { patientId: string; excludeId: string; name: string; onClose: () => void }) {
  const [visits, setVisits] = useState<HistoryVisit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getPatientHistory(patientId, excludeId).then(setVisits).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [patientId, excludeId]);

  const line = (label: string, value: string | null | undefined) => value?.trim()
    ? <p className="text-xs"><span className="font-medium text-neutral-500">{label}: </span><span className="whitespace-pre-line text-neutral-800">{value}</span></p>
    : null;

  return (
    <Modal title={`History · ${name}`} onClose={onClose} width="max-w-3xl">
      {error && <p className="text-sm text-rose-600">Could not load the history: {error}</p>}
      {!visits && !error && <p className="text-sm text-neutral-400">Loading…</p>}
      {visits && visits.length === 0 && <p className="text-sm text-neutral-400">No earlier visits.</p>}
      <div className="flex flex-col gap-4">
        {visits?.map((v) => (
          <div key={v.episode.id} className="rounded-xl border border-neutral-200 p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                {fmtDate(v.episode.date)} · {TYPE_LABEL[v.episode.type] ?? v.episode.type}
                <span className="ml-2 font-mono text-[11px] font-normal text-neutral-400">{v.episode.episode_no}</span>
              </p>
              <p className="text-xs text-neutral-500">{[v.doctorName, v.episode.department].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex flex-col gap-1">
              {line("Complaint", v.episode.complaint)}
              {line("Vitals", v.episode.vitals)}
              {line("Examination", v.episode.findings)}
              {line("Diagnosis", v.episode.diagnosis)}
              {line("Advice", v.episode.advice)}
              {v.episode.type === "ipd" && line("Admission", [v.episode.notes, v.episode.room_ward && `Ward ${v.episode.room_ward}`, v.episode.bed_no && `Bed ${v.episode.bed_no}`,
                v.episode.discharge_date && `Discharged ${fmtDate(v.episode.discharge_date)}`].filter(Boolean).join(" · "))}
            </div>
            {v.prescriptions.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-neutral-600">Prescription</p>
                <ul className="flex flex-col gap-0.5 text-xs">
                  {v.prescriptions.map((r) => (
                    <li key={r.id}>
                      <span className="font-medium">{r.product_name}</span>{" "}
                      <span className="text-neutral-500">{[r.dose, r.frequency, r.duration && `${r.duration} days`, r.instructions].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(v.labs.length > 0 || v.pendingLabs.length > 0) && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-neutral-600">Lab results</p>
                <table className="w-full text-xs">
                  <tbody>
                    {v.labs.map((l, i) => (
                      <tr key={i} className="border-b border-neutral-50">
                        <td className="py-0.5 pr-2">{l.test_name}</td>
                        <td className={`py-0.5 pr-2 font-medium tabular-nums ${l.flag === "H" || l.flag === "L" ? "text-rose-600" : ""}`}>
                          {l.result_value} {l.unit}{l.flag && l.flag !== "N" ? ` (${l.flag})` : ""}
                        </td>
                        <td className="py-0.5 text-neutral-400">{l.ref_range}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {v.pendingLabs.length > 0 && <p className="mt-1 text-xs text-neutral-400">Not reported yet: {v.pendingLabs.join(", ")}</p>}
              </div>
            )}
            {(v.imaging.length > 0 || v.pendingImaging.length > 0) && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-neutral-600">Radiology</p>
                {v.imaging.map((r, i) => (
                  <p key={i} className="text-xs">
                    <span className="font-medium">{r.modality}{r.body_part ? ` · ${r.body_part}` : ""}:</span>{" "}
                    <span className="whitespace-pre-line">{r.impression || r.findings}</span>
                  </p>
                ))}
                {v.pendingImaging.length > 0 && <p className="mt-1 text-xs text-neutral-400">Not reported yet: {v.pendingImaging.join(", ")}</p>}
              </div>
            )}
            {v.surgeries.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold text-neutral-600">Surgery</p>
                {v.surgeries.map((s, i) => (
                  <p key={i} className="text-xs">
                    <span className="font-medium">{s.surgery_name}</span>{" "}
                    <span className="text-neutral-500">
                      {s.status === "done" ? `done ${fmtDate(s.performed_at)}` : s.status === "cancelled" ? "cancelled" : `planned${s.planned_date ? ` for ${fmtDate(s.planned_date)}` : ""}`}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
