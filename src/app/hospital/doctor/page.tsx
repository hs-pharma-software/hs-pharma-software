"use client";

import { useEffect, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { hospitalEpisodesRepo, hospitalPatientsRepo, hospitalServicesRepo, type HospitalPatient, type HospitalService } from "@/lib/repo/hospital";
import {
  staffForCurrentUser, listHospitalDoctors, listOpdQueue, saveConsultationNotes, listRx, saveRx, sendRxToPharmacy,
  orderInvestigation, listVisitOrders, type OpdQueueRow, type RxDraft,
} from "@/lib/repo/hospitalOpd";
import { getPharmacyLink, savePharmacyLink, listPharmacyTenants, searchProductsForPharmacy } from "@/lib/repo/clinic";
import type { HospitalEpisode } from "@/lib/types-hospital";
import type { Staff } from "@/lib/types";

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
  const [queue, setQueue] = useState<OpdQueueRow[]>([]);
  const [visitId, setVisitId] = useState<string | null>(null);

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
    setQueue(await listOpdQueue({ date, doctorId: doctorId || null, search }));
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
          {queue.length === 0 ? <p className="py-4 text-center text-sm text-neutral-400">No patients.</p> : (
            <div className="flex flex-col divide-y divide-neutral-100">
              {queue.map((q) => (
                <button key={q.id} type="button" onClick={() => setVisitId(q.id)}
                  className={`flex items-center gap-3 px-2 py-2 text-left text-sm hover:bg-amber-50 ${visitId === q.id ? "bg-amber-50" : ""}`}>
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

        <div className="xl:col-span-2">
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
  const [serviceId, setServiceId] = useState("");
  const [pharmacyId, setPharmacyId] = useState("");
  const [pharmacies, setPharmacies] = useState<{ id: string; name: string }[]>([]);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const e = await hospitalEpisodesRepo.get(episodeId);
    setEp(e);
    if (!e) return;
    setPatient(await hospitalPatientsRepo.get(e.patient_id));
    setNotes({ complaint: e.complaint ?? "", vitals: e.vitals ?? "", findings: e.findings ?? "", diagnosis: e.diagnosis ?? "", advice: e.advice ?? "", followup_date: e.followup_date ?? "" });
    const rx = await listRx(episodeId);
    setLines(rx.length ? rx.map((r) => ({ product_id: r.product_id, product_name: r.product_name, generic_name: r.generic_name, dose: r.dose, route: r.route, frequency: r.frequency, duration: r.duration, qty: r.qty, instructions: r.instructions })) : []);
    setSentAt(rx.find((r) => r.sent_at)?.sent_at ?? null);
    setOrders(await listVisitOrders(episodeId));
  }

  useEffect(() => {
    void load();
    void hospitalServicesRepo.list({ orderBy: "name ASC" }).then((s) => setServices(s.filter((x) => x.is_active && (x.category === "lab" || x.category === "imaging"))));
    void listPharmacyTenants().then(setPharmacies);
    void getPharmacyLink().then((l) => setPharmacyId(l?.pharmacy_tenant_id ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  // Medicine search in the linked pharmacy, by brand or generic name.
  useEffect(() => {
    if (!pharmacyId || term.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      void searchProductsForPharmacy(term, pharmacyId).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [term, pharmacyId]);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      window.alert(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const setLine = (i: number, patch: Partial<RxDraft>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  if (!ep) return <p className="p-6 text-sm text-neutral-400">Loading…</p>;
  const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

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
        <div className="flex gap-2">
          {ep.consult_status !== "in_consultation" && ep.consult_status !== "done" && (
            <Button onClick={() => void run("start", () => saveConsultationNotes(ep.id, { consult_status: "in_consultation" }))}>Start</Button>
          )}
          {ep.consult_status !== "done" && (
            <Button variant="primary" onClick={() => void run("finish", () => saveConsultationNotes(ep.id, { ...notes, followup_date: notes.followup_date || null, consult_status: "done" }))}>Finish visit</Button>
          )}
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-neutral-700">Consultation</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Complaint"><Textarea rows={2} value={notes.complaint} onChange={(e) => setNotes({ ...notes, complaint: e.target.value })} /></Field>
          <Field label="Vitals"><Textarea rows={2} value={notes.vitals} onChange={(e) => setNotes({ ...notes, vitals: e.target.value })} placeholder="BP, pulse, temp, SpO2, weight" /></Field>
          <Field label="Examination"><Textarea rows={2} value={notes.findings} onChange={(e) => setNotes({ ...notes, findings: e.target.value })} /></Field>
          <Field label="Diagnosis"><Textarea rows={2} value={notes.diagnosis} onChange={(e) => setNotes({ ...notes, diagnosis: e.target.value })} /></Field>
          <Field label="Advice"><Textarea rows={2} value={notes.advice} onChange={(e) => setNotes({ ...notes, advice: e.target.value })} /></Field>
          <Field label="Follow-up date"><Input type="date" value={notes.followup_date} onChange={(e) => setNotes({ ...notes, followup_date: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => void run("save the notes", () => saveConsultationNotes(ep.id, { ...notes, followup_date: notes.followup_date || null, consult_status: ep.consult_status === "done" ? "done" : "in_consultation" }))} disabled={busy}>
            Save notes
          </Button>
        </div>
      </div>

      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-semibold text-neutral-700">Prescription</h3>
          <div className="w-64">
            <Field label="Linked pharmacy">
              <Select value={pharmacyId} onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                savePharmacyLink(id).then(() => setPharmacyId(id)).catch((err) => window.alert(`Could not link the pharmacy: ${err instanceof Error ? err.message : String(err)}`));
              }}>
                <option value="">— Choose the hospital pharmacy —</option>
                {pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        <div className="relative mb-3">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} disabled={!pharmacyId}
            placeholder={pharmacyId ? "Search medicine by brand or generic name…" : "Link the hospital pharmacy to search its medicines"} />
          {results.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
              {results.map((p) => (
                <button key={p.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-amber-50"
                  onClick={() => { setLines((ls) => [...ls, { ...EMPTY_LINE, product_id: p.id, product_name: p.name, generic_name: p.description }]); setTerm(""); setResults([]); }}>
                  <span className="font-medium">{p.name}</span>
                  {p.description && <span className="ml-2 text-xs text-neutral-500">{p.description}</span>}
                  {p.company_name && <span className="ml-2 text-xs text-neutral-400">{p.company_name}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length === 0 ? <p className="text-sm text-neutral-400">No medicines yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-neutral-100 text-left text-neutral-500">
                <th className="pb-1.5 pr-2 font-medium">Medicine</th><th className="pb-1.5 pr-2 font-medium">Dose</th><th className="pb-1.5 pr-2 font-medium">Frequency</th>
                <th className="pb-1.5 pr-2 font-medium">Days</th><th className="pb-1.5 pr-2 font-medium">Qty</th><th className="pb-1.5 pr-2 font-medium">Instructions</th><th />
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-neutral-50 align-top">
                    <td className="py-1 pr-2"><span className="font-medium">{l.product_name}</span>{l.generic_name && <span className="block text-neutral-400">{l.generic_name}</span>}</td>
                    <td className="py-1 pr-2"><Input value={l.dose ?? ""} onChange={(e) => setLine(i, { dose: e.target.value })} className="w-16" /></td>
                    <td className="py-1 pr-2">
                      <Select value={l.frequency ?? ""} onChange={(e) => setLine(i, { frequency: e.target.value })} className="w-40">
                        <option value="">—</option>
                        {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                      </Select>
                    </td>
                    <td className="py-1 pr-2"><Input value={l.duration ?? ""} onChange={(e) => setLine(i, { duration: e.target.value })} className="w-16" placeholder="5" /></td>
                    <td className="py-1 pr-2"><Input type="number" min="1" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className="w-16" /></td>
                    <td className="py-1 pr-2"><Input value={l.instructions ?? ""} onChange={(e) => setLine(i, { instructions: e.target.value })} placeholder="After meals" /></td>
                    <td className="py-1"><button type="button" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-neutral-300 hover:text-rose-500"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {sentAt && <span className="mr-auto text-xs text-emerald-700">Sent to the pharmacy.</span>}
          <Button onClick={() => void run("save the prescription", () => saveRx(ep.id, lines))} disabled={busy}>Save prescription</Button>
          <Button variant="primary" disabled={busy || lines.length === 0 || !pharmacyId}
            onClick={() => void run("send the prescription", async () => { await saveRx(ep.id, lines); await sendRxToPharmacy(ep.id); })}>
            <Send size={13} className="mr-1" /> Send to pharmacy
          </Button>
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-neutral-700">Lab &amp; radiology</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="min-w-64 flex-1">
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">— Choose a test or scan —</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.category === "lab" ? "Lab" : "Radiology"} · {s.name} · Rs {Number(s.rate).toFixed(0)}</option>)}
            </Select>
          </div>
          <Button variant="primary" disabled={!serviceId || busy} onClick={() => void run("order", async () => { await orderInvestigation(ep.id, serviceId); setServiceId(""); })}>Order</Button>
        </div>
        {services.length === 0 && <p className="mb-2 text-xs text-neutral-400">Add lab and radiology services (with their fees) in Service Master.</p>}
        {orders.length === 0 ? <p className="text-sm text-neutral-400">Nothing ordered.</p> : (
          <div className="flex flex-col divide-y divide-neutral-100 text-sm">
            {orders.map((o) => {
              const unpaid = o.fee > 0 && !o.paid;
              return (
                <div key={o.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">{o.name} <span className="text-xs font-normal text-neutral-400">{o.kind === "lab" ? "Lab" : "Radiology"} · {o.order_no}</span></p>
                    {o.result && <p className="text-xs text-neutral-600">Result: {o.result}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${unpaid ? "bg-rose-100 text-rose-700" : o.status === "reported" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
                    {unpaid ? `Fee Rs ${o.fee.toFixed(0)} unpaid` : o.status === "reported" ? "Reported" : "Paid · in progress"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
