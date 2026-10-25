"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  listOpenRequests, recordPatientGroup, availableUnits, recordCrossmatch, requestCrossmatches, issueUnit, listWithWards, returnUnit,
  listUnits, createUnit, recordUnitTesting, releaseUnit, discardUnit, listDonors, saveDonor, listDonations, recordDonation,
  listReactions, analyseReaction, reportReactionToAuthority, bloodIndicators, groupOf, bbRequestsRepo,
  type CrossmatchRow, type BloodIndicators,
} from "@/lib/repo/bloodBank";
import { ABO, RH, COMPONENTS, TTI_TESTS, SERIOUS, DONOR_MIN_HB, DONOR_MIN_WEIGHT_KG } from "@/config/bloodBank";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import type { BbDonation, BbDonor, BbReaction, BbRequest, BbUnit } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const UNIT_STATUS: Record<BbUnit["status"], [string, string]> = {
  quarantine: ["Quarantine", "bg-amber-100 text-amber-800"], available: ["Available", "bg-emerald-100 text-emerald-700"], reserved: ["Reserved", "bg-sky-100 text-sky-700"],
  issued: ["Issued", "bg-violet-100 text-violet-700"], transfused: ["Transfused", "bg-neutral-200 text-neutral-700"], discarded: ["Discarded", "bg-rose-100 text-rose-700"],
};
const URGENCY_CLS: Record<BbRequest["urgency"], string> = { Emergency: "bg-rose-100 text-rose-700", Urgent: "bg-amber-100 text-amber-800", Routine: "bg-neutral-100 text-neutral-600" };
const err = (e: unknown) => window.alert(e instanceof Error ? e.message : String(e));
const pill = (label: string, cls: string) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
const inDays = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

type Tab = "requests" | "stock" | "donors" | "reactions" | "indicators";
const TABS: [Tab, string][] = [["requests", "Requests and issue"], ["stock", "Stock"], ["donors", "Donors"], ["reactions", "Reactions"], ["indicators", "Indicators"]];

/** Blood bank (MSDS COP-2 Ind. 21-25, CQI-2 Ind. 104). */
export default function BloodBankPage() {
  const [tab, setTab] = useState<Tab>("requests");
  return (
    <div>
      <PageHeader title="Blood Bank" actions={
        <div className="flex flex-wrap overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {TABS.map(([t, l]) => <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-rose-700 text-white" : "bg-white text-neutral-600"}`}>{l}</button>)}
        </div>
      } />
      {tab === "requests" && <Requests />}
      {tab === "stock" && <Stock />}
      {tab === "donors" && <Donors />}
      {tab === "reactions" && <Reactions />}
      {tab === "indicators" && <Indicators />}
    </div>
  );
}

// ── Requests and issue ────────────────────────────────────────────────────

function Requests() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listOpenRequests>>>([]);
  const [wards, setWards] = useState<Awaited<ReturnType<typeof listWithWards>>>([]);
  const [open, setOpen] = useState<string | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try {
      setRows(await listOpenRequests());
      setWards(await listWithWards());
    } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  async function giveBack(id: string) {
    const why = window.prompt("Why is the unit coming back?");
    if (!why?.trim()) return;
    const fit = window.confirm("Was the unit kept in the cold chain and is it fit to go back to stock?\nOK = back to stock, Cancel = discard it.");
    try { await returnUnit(id, why, fit); await reload(); } catch (e) { err(e); }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Open requests</h2>
        {rows.length === 0 ? <p className="text-sm text-neutral-400">No open requests. Doctors request blood from the admission page.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500"><th className={th}>Requested</th><th className={th}>Patient</th><th className={th}>Component</th><th className={th}>Units</th><th className={th}>Group</th><th className={th}>Urgency</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-50">
                    <td className={`${td} text-xs text-neutral-500`}>{fmtWhen(r.requested_at)} · {r.requested_by_name}</td>
                    <td className={td}>{r.patient_name} <span className="text-xs text-neutral-400">{r.mr_no} · {r.episode_no}</span></td>
                    <td className={td}>{r.component}</td>
                    <td className={`${td} tabular-nums`}>{r.issued} / {r.units_requested}</td>
                    <td className={`${td} font-medium`}>{groupOf(r.patient_abo, r.patient_rh)}</td>
                    <td className={td}>{pill(r.urgency, URGENCY_CLS[r.urgency])}</td>
                    <td className="py-1.5"><Button variant="ghost" onClick={() => setOpen(r.id)}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className={card}>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">With the wards (issued, transfusion not started)</h2>
        {wards.length === 0 ? <p className="text-sm text-neutral-400">None.</p> : wards.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-50 py-1.5 text-sm">
            <span><b className="font-mono text-xs">{w.unit_no}</b> {w.component} {groupOf(w.abo, w.rh)} · {w.patient_name} ({w.mr_no}) · issued {fmtWhen(w.issued_at)} to {w.received_by}{w.emergency_release ? <span className="ml-1 text-xs font-medium text-rose-700">emergency release · {w.authorized_by}</span> : null}</span>
            <Button variant="ghost" onClick={() => void giveBack(w.id)}>Record return</Button>
          </div>
        ))}
      </div>
      {open && <RequestModal requestId={open} onClose={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function RequestModal({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [r, setR] = useState<BbRequest | null>(null);
  const [tests, setTests] = useState<CrossmatchRow[]>([]);
  const [stock, setStock] = useState<BbUnit[]>([]);
  const [abo, setAbo] = useState("");
  const [rh, setRh] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const load = async () => {
    const req = await bbRequestsRepo.get(requestId);
    setR(req);
    if (!req) return;
    setAbo(req.patient_abo ?? "");
    setRh(req.patient_rh ?? "");
    setTests(await requestCrossmatches(requestId));
    setStock(await availableUnits(req.component));
  };
  useEffect(() => { void load().catch(err); }, [requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { err(e); } };
  const grouped = !!r.patient_abo && !!r.patient_rh;
  const reserved = tests.filter((t) => t.result === "compatible" && t.unit_status === "reserved");
  return (
    <Modal title={`Request · ${r.component} × ${r.units_requested}`} onClose={onClose} width="max-w-3xl">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
          {pill(r.urgency, URGENCY_CLS[r.urgency])}
          <span>{r.requested_by_name} · {fmtWhen(r.requested_at)}</span>
          <span>Indication: {r.indication}</span>
          {r.status !== "open" && pill(r.status, "bg-neutral-100 text-neutral-600")}
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-neutral-600">1. Patient&apos;s sample: ABO and Rh</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-28"><Select id="rq-abo" value={abo} onChange={(e) => setAbo(e.target.value)}><option value="">ABO</option>{ABO.map((g) => <option key={g}>{g}</option>)}</Select></div>
            <div className="w-32"><Select id="rq-rh" value={rh} onChange={(e) => setRh(e.target.value)}><option value="">Rh</option>{RH.map((g) => <option key={g}>{g}</option>)}</Select></div>
            <Button onClick={() => void act(() => recordPatientGroup(r.id, abo, rh))} disabled={!abo || !rh || r.status !== "open"}>{grouped ? "Correct the group" : "Save group"}</Button>
            {grouped && <span className="font-medium">{groupOf(r.patient_abo, r.patient_rh)}</span>}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-neutral-600">2. Compatibility testing ({r.component} in stock, earliest expiry first)</p>
          {stock.length === 0 ? <p className="text-xs text-amber-700">No {r.component.toLowerCase()} available in stock.</p> : stock.slice(0, 12).map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-50 py-1 text-xs">
              <span><b className="font-mono">{u.unit_no}</b> {groupOf(u.abo, u.rh)} · expires {u.expires_on}{u.supplier_name ? ` · ${u.supplier_name}` : ""}</span>
              <span className="flex gap-1">
                <Button variant="ghost" disabled={!grouped || r.status !== "open"} onClick={() => void act(() => recordCrossmatch(r.id, u.id, "compatible"))}>Compatible</Button>
                <Button variant="ghost" disabled={!grouped || r.status !== "open"} onClick={() => void act(() => recordCrossmatch(r.id, u.id, "incompatible"))}>Incompatible</Button>
                {r.urgency === "Emergency" && <Button variant="danger" disabled={r.status !== "open"} onClick={() => void act(() => issueUnit(r.id, u.id, { receivedBy, emergencyAuthorizedBy: authorizedBy }))}>Emergency issue</Button>}
              </span>
            </div>
          ))}
          {tests.length > 0 && (
            <div className="mt-2 rounded-xl bg-neutral-50 p-2 text-xs">
              {tests.map((t) => <p key={t.id}><span className="font-mono">{t.unit_no}</span> {groupOf(t.abo, t.rh)} · {t.result === "compatible" ? "Compatible" : <span className="text-rose-700">Incompatible</span>} · {t.method} · {t.tested_by_name} · {fmtWhen(t.tested_at)} · now {UNIT_STATUS[t.unit_status][0].toLowerCase()}</p>)}
            </div>
          )}
          <p className="mt-1 text-[11px] text-neutral-400">The software refuses &ldquo;compatible&rdquo; when the ABO / Rh groups do not allow it. Expired units are not listed.</p>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold text-neutral-600">3. Issue</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Collected from the blood bank by" required><Input id="rq-recv" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of the ward staff" /></Field>
            {r.urgency === "Emergency" && <Field label="Emergency release authorized by (doctor)"><Input id="rq-auth" value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} placeholder="Only for an uncrossmatched O Rh-negative unit" /></Field>}
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {reserved.length === 0 ? <p className="text-xs text-neutral-400">No compatible unit reserved yet.</p> : reserved.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                <span><b className="font-mono">{t.unit_no}</b> {groupOf(t.abo, t.rh)} · expires {t.expires_on}</span>
                <Button variant="primary" disabled={r.status !== "open"} onClick={() => void act(() => issueUnit(r.id, t.unit_id, { receivedBy }))}>Issue</Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Stock ─────────────────────────────────────────────────────────────────

function Stock() {
  const [status, setStatus] = useState<BbUnit["status"] | "">("available");
  const [units, setUnits] = useState<BbUnit[]>([]);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<BbUnit | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setUnits(await listUnits(status ? { status } : {})); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = localDate();
  const soon = inDays(3);
  const counts = COMPONENTS.map((c) => [c, units.filter((u) => u.component === c && u.expires_on >= today).length] as const).filter(([, n]) => n > 0);
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 text-sm">
          {(["", "quarantine", "available", "reserved", "issued", "transfused", "discarded"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 ${status === s ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}>{s ? UNIT_STATUS[s][0] : "All"}</button>
          ))}
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />Receive unit</Button>
      </div>
      {status === "available" && counts.length > 0 && <p className="mb-2 text-xs text-neutral-600">{counts.map(([c, n]) => `${c}: ${n}`).join(" · ")}</p>}
      {units.length === 0 ? <p className="text-sm text-neutral-400">No units.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500"><th className={th}>Unit</th><th className={th}>Component</th><th className={th}>Group</th><th className={th}>Source</th><th className={th}>Expires</th><th className={th}>Status</th><th /></tr></thead>
            <tbody>
              {units.map((u) => {
                const exp = u.expires_on < today && !["transfused", "discarded"].includes(u.status);
                return (
                  <tr key={u.id} className="border-b border-neutral-50">
                    <td className={`${td} font-mono text-xs`}>{u.unit_no}</td>
                    <td className={td}>{u.component}{u.volume_ml ? <span className="text-xs text-neutral-400"> · {u.volume_ml} mL</span> : null}</td>
                    <td className={`${td} font-medium`}>{groupOf(u.abo, u.rh)}</td>
                    <td className={`${td} text-xs text-neutral-500`}>{u.source === "received" ? `${u.supplier_name} (${u.supplier_unit_no})` : "Own donation"}</td>
                    <td className={`${td} tabular-nums text-xs ${exp ? "font-medium text-rose-700" : u.expires_on <= soon ? "text-amber-700" : ""}`}>{u.expires_on}{exp ? " · expired" : ""}</td>
                    <td className={td}>{pill(UNIT_STATUS[u.status][0], UNIT_STATUS[u.status][1])}</td>
                    <td className="py-1.5"><Button variant="ghost" onClick={() => setOpen(u)}>Open</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-neutral-400">A unit stays in quarantine until it is grouped and all five infection screens are recorded non-reactive. A reactive unit can only be discarded.</p>
      {adding && <ReceiveUnit onClose={() => setAdding(false)} onSaved={(u) => { setAdding(false); setOpen(u); void reload(); }} />}
      {open && <UnitModal unit={open} onClose={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function ReceiveUnit({ onClose, onSaved }: { onClose: () => void; onSaved: (u: BbUnit) => void }) {
  const [v, setV] = useState({ supplierName: "", supplierLicence: "", supplierUnitNo: "", component: "Packed red cells", volumeMl: "", collectedOn: localDate(), expiresOn: "", storage: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  async function save() {
    try {
      onSaved(await createUnit({ source: "received", ...v, volumeMl: v.volumeMl ? Number(v.volumeMl) : null }));
    } catch (e) { err(e); }
  }
  return (
    <Modal title="Receive a unit from a licensed blood centre" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Blood centre" required><Input id="rcv-sup" value={v.supplierName} onChange={set("supplierName")} /></Field>
        <Field label="PBTA licence / MOU reference" required><Input id="rcv-lic" value={v.supplierLicence} onChange={set("supplierLicence")} /></Field>
        <Field label="Their unit number" required><Input id="rcv-no" value={v.supplierUnitNo} onChange={set("supplierUnitNo")} /></Field>
        <Field label="Component" required><Select id="rcv-comp" value={v.component} onChange={set("component")}>{COMPONENTS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Volume (mL)"><Input id="rcv-vol" type="number" value={v.volumeMl} onChange={set("volumeMl")} /></Field>
        <Field label="Storage (fridge / freezer / agitator)"><Input id="rcv-store" value={v.storage} onChange={set("storage")} /></Field>
        <Field label="Collected on" required><Input id="rcv-coll" type="date" value={v.collectedOn} onChange={set("collectedOn")} /></Field>
        <Field label="Expires on" required><Input id="rcv-exp" type="date" value={v.expiresOn} onChange={set("expiresOn")} /></Field>
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">The unit enters quarantine. Record its group and the screening results certified by the centre, then release it.</p>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Receive</Button></div>
    </Modal>
  );
}

function UnitModal({ unit, onClose }: { unit: BbUnit; onClose: () => void }) {
  const [u, setU] = useState(unit);
  const [t, setT] = useState<Record<string, string>>(() => {
    const x: Record<string, string> = { abo: unit.abo ?? "", rh: unit.rh ?? "" };
    for (const [k] of TTI_TESTS) x[k] = unit[k] ?? "";
    return x;
  });
  const act = async (fn: () => Promise<BbUnit>) => { try { setU(await fn()); } catch (e) { err(e); } };
  const editing = u.status === "quarantine";
  function saveTesting() {
    const screens: Record<string, "nonreactive" | "reactive"> = {};
    for (const [k] of TTI_TESTS) if (t[k] === "nonreactive" || t[k] === "reactive") screens[k] = t[k];
    void act(() => recordUnitTesting(u.id, { abo: t.abo, rh: t.rh, ...screens }));
  }
  return (
    <Modal title={`Unit ${u.unit_no}`} onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
          {pill(UNIT_STATUS[u.status][0], UNIT_STATUS[u.status][1])}
          <span>{u.component}{u.volume_ml ? ` · ${u.volume_ml} mL` : ""} · collected {u.collected_on} · expires {u.expires_on}</span>
          <span>{u.source === "received" ? `${u.supplier_name} · licence ${u.supplier_licence} · their no ${u.supplier_unit_no}` : "Collected from a donor here"}</span>
          {u.released_by_name && <span>Released by {u.released_by_name} · {fmtWhen(u.released_at)}</span>}
          {u.discard_reason && <span className="text-rose-700">Discarded: {u.discard_reason} ({u.discarded_by_name}, {fmtWhen(u.discarded_at)})</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="ABO"><Select id="un-abo" value={t.abo} disabled={!editing} onChange={(e) => setT({ ...t, abo: e.target.value })}><option value="">—</option>{ABO.map((g) => <option key={g}>{g}</option>)}</Select></Field>
          <Field label="Rh"><Select id="un-rh" value={t.rh} disabled={!editing} onChange={(e) => setT({ ...t, rh: e.target.value })}><option value="">—</option>{RH.map((g) => <option key={g}>{g}</option>)}</Select></Field>
          {TTI_TESTS.map(([k, l]) => (
            <Field key={k} label={l}>
              <Select id={`un-${k}`} value={t[k]} disabled={!editing} onChange={(e) => setT({ ...t, [k]: e.target.value })}>
                <option value="">Not recorded</option><option value="nonreactive">Non-reactive</option><option value="reactive">Reactive</option>
              </Select>
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-3">
          {editing && <Button onClick={saveTesting}>Save results</Button>}
          {editing && <Button variant="primary" onClick={() => void act(() => releaseUnit(u.id))}>Release to stock</Button>}
          {!["transfused", "discarded", "issued"].includes(u.status) && (
            <Button variant="danger" onClick={() => { const why = window.prompt("Reason for discarding (reactive, expired, damaged, haemolysed…):"); if (why?.trim()) void act(() => discardUnit(u.id, why)); }}>Discard</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Donors ────────────────────────────────────────────────────────────────

function Donors() {
  const [donors, setDonors] = useState<BbDonor[]>([]);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<BbDonor | "new" | null>(null);
  const [open, setOpen] = useState<BbDonor | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setDonors(await listDonors()); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  const needle = q.trim().toLowerCase();
  const shown = needle ? donors.filter((d) => [d.name, d.donor_no, d.cnic ?? "", d.phone ?? ""].some((x) => x.toLowerCase().includes(needle))) : donors;
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="w-72 max-w-full"><Input id="dn-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, donor no, CNIC, phone" /></div>
        <Button variant="primary" onClick={() => setEdit("new")}><Plus size={14} className="mr-1" />Register donor</Button>
      </div>
      {shown.length === 0 ? <p className="text-sm text-neutral-400">No donors.</p> : shown.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-50 py-1.5 text-sm">
          <span><b className="font-mono text-xs">{d.donor_no}</b> {d.name} <span className="text-xs text-neutral-500">· {groupOf(d.abo, d.rh)}{d.cnic ? ` · ${d.cnic}` : ""}{d.phone ? ` · ${d.phone}` : ""}</span></span>
          <span className="flex gap-1"><Button variant="ghost" onClick={() => setEdit(d)}>Edit</Button><Button variant="ghost" onClick={() => setOpen(d)}>Donations</Button></span>
        </div>
      ))}
      {edit && <DonorModal donor={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
      {open && <DonationsModal donor={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DonorModal({ donor, onClose, onSaved }: { donor: BbDonor | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: donor?.name ?? "", cnic: donor?.cnic ?? "", phone: donor?.phone ?? "", gender: donor?.gender ?? "", dob: donor?.dob ?? "", abo: donor?.abo ?? "", rh: donor?.rh ?? "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  async function save() {
    try { await saveDonor(donor?.id ?? null, v); onSaved(); } catch (e) { err(e); }
  }
  return (
    <Modal title={donor ? `Edit donor ${donor.donor_no}` : "Register donor"} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" required><Input id="dn-name" value={v.name} onChange={set("name")} /></Field>
        <Field label="CNIC"><Input id="dn-cnic" value={v.cnic} onChange={set("cnic")} placeholder="35202-1234567-1" /></Field>
        <Field label="Phone"><Input id="dn-phone" value={v.phone} onChange={set("phone")} /></Field>
        <Field label="Gender"><Select id="dn-gender" value={v.gender} onChange={set("gender")}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></Select></Field>
        <Field label="Date of birth"><Input id="dn-dob" type="date" value={v.dob} onChange={set("dob")} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="ABO"><Select id="dn-abo" value={v.abo} onChange={set("abo")}><option value="">—</option>{ABO.map((g) => <option key={g}>{g}</option>)}</Select></Field>
          <Field label="Rh"><Select id="dn-rh" value={v.rh} onChange={set("rh")}><option value="">—</option>{RH.map((g) => <option key={g}>{g}</option>)}</Select></Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></div>
    </Modal>
  );
}

function DonationsModal({ donor, onClose }: { donor: BbDonor; onClose: () => void }) {
  const [list, setList] = useState<BbDonation[]>([]);
  const [v, setV] = useState({ donationType: "Replacement", hb: "", weightKg: "", bp: "", pulse: "", temperatureC: "", questionnaireOk: "", consentSigned: "", deferralReason: "", collect: "Yes", component: "Whole blood", volumeMl: "450", expiresOn: inDays(35) });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const load = () => listDonations(donor.id).then(setList).catch(err);
  useEffect(() => { void load(); }, [donor.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = v.questionnaireOk === "Yes" && Number(v.hb) >= DONOR_MIN_HB && Number(v.weightKg) >= DONOR_MIN_WEIGHT_KG;
  const ready = v.hb !== "" && v.weightKg !== "" && v.questionnaireOk !== "" && v.consentSigned !== "";
  async function save() {
    try {
      const { unit } = await recordDonation(donor.id, {
        donationType: v.donationType as BbDonation["donation_type"], hb: Number(v.hb), weightKg: Number(v.weightKg), bp: v.bp,
        pulse: v.pulse ? Number(v.pulse) : null, temperatureC: v.temperatureC ? Number(v.temperatureC) : null,
        questionnaireOk: v.questionnaireOk === "Yes", consentSigned: v.consentSigned === "Yes", deferralReason: fit ? null : v.deferralReason,
        collect: fit && v.collect === "Yes" ? { component: v.component, volumeMl: Number(v.volumeMl), expiresOn: v.expiresOn } : null,
      });
      if (unit) window.alert(`Unit ${unit.unit_no} created in quarantine. Record its screening on the Stock tab.`);
      setV({ ...v, hb: "", weightKg: "", bp: "", pulse: "", temperatureC: "", questionnaireOk: "", consentSigned: "", deferralReason: "" });
      await load();
    } catch (e) { err(e); }
  }
  return (
    <Modal title={`${donor.name} · ${donor.donor_no}`} onClose={onClose} width="max-w-3xl">
      <div className="flex flex-col gap-4 text-sm">
        <div>
          <p className="mb-2 text-xs font-semibold text-neutral-600">Screen the donor</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Donation"><Select id="dd-type" value={v.donationType} onChange={set("donationType")}><option>Replacement</option><option>Voluntary</option><option>Autologous</option></Select></Field>
            <Field label="Hb (g/dL)" required><Input id="dd-hb" type="number" step="0.1" value={v.hb} onChange={set("hb")} /></Field>
            <Field label="Weight (kg)" required><Input id="dd-wt" type="number" value={v.weightKg} onChange={set("weightKg")} /></Field>
            <Field label="BP"><Input id="dd-bp" value={v.bp} onChange={set("bp")} placeholder="120/80" /></Field>
            <Field label="Pulse"><Input id="dd-pulse" type="number" value={v.pulse} onChange={set("pulse")} /></Field>
            <Field label="Temp (°C)"><Input id="dd-temp" type="number" step="0.1" value={v.temperatureC} onChange={set("temperatureC")} /></Field>
            <Field label="Questionnaire: fit to donate" required><Select id="dd-q" value={v.questionnaireOk} onChange={set("questionnaireOk")}><option value="">—</option><option>Yes</option><option>No</option></Select></Field>
            <Field label="Donor consent signed" required><Select id="dd-consent" value={v.consentSigned} onChange={set("consentSigned")}><option value="">—</option><option>Yes</option><option>No</option></Select></Field>
          </div>
          {ready && (fit ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Collect blood now"><Select id="dd-collect" value={v.collect} onChange={set("collect")}><option>Yes</option><option>No</option></Select></Field>
              {v.collect === "Yes" && <>
                <Field label="Component"><Select id="dd-comp" value={v.component} onChange={set("component")}>{COMPONENTS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label="Volume (mL)"><Input id="dd-vol" type="number" value={v.volumeMl} onChange={set("volumeMl")} /></Field>
                <Field label="Expires on"><Input id="dd-exp" type="date" value={v.expiresOn} onChange={set("expiresOn")} /></Field>
              </>}
            </div>
          ) : (
            <div className="mt-3"><Field label={`Deferral reason (criteria: Hb ≥ ${DONOR_MIN_HB} g/dL, weight ≥ ${DONOR_MIN_WEIGHT_KG} kg, questionnaire)`} required><Input id="dd-defer" value={v.deferralReason} onChange={set("deferralReason")} /></Field></div>
          ))}
          <div className="mt-3 flex justify-end"><Button variant="primary" onClick={() => void save()} disabled={!ready}>{ready && !fit ? "Record deferral" : "Record donation"}</Button></div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-neutral-600">History</p>
          {list.length === 0 ? <p className="text-xs text-neutral-400">No donations.</p> : list.map((d) => (
            <p key={d.id} className="text-xs">{fmtWhen(d.donated_at)} · {d.donation_type} · Hb {d.hb} · {d.weight_kg} kg · {d.eligible ? (d.unit_id ? "Collected" : "Eligible, not collected") : <span className="text-rose-700">Deferred: {d.deferral_reason}</span>} · {d.screened_by_name}</p>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ── Reactions ─────────────────────────────────────────────────────────────

function Reactions() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listReactions>>>([]);
  const [open, setOpen] = useState<BbReaction | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listReactions()); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  return (
    <div className={card}>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No transfusion reactions recorded. Ward staff report them from the admission page.</p> : rows.map((r) => {
        const due = SERIOUS.has(r.severity) && !r.reported_to_authority;
        return (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-50 py-1.5 text-sm">
            <span>
              <span className="text-xs text-neutral-500">{fmtWhen(r.onset_at)}</span> {r.patient_name} <span className="text-xs text-neutral-400">{r.mr_no} · unit {r.unit_no}</span> · {r.reaction_type} · {r.severity}
              {due && <span className="ml-1">{pill("Report to the Authority", "bg-rose-100 text-rose-700")}</span>}
              {r.reported_to_authority ? <span className="ml-1 text-xs text-emerald-700">Reported {r.authority_reported_at} · {r.authority_ref}</span> : null}
              {!r.analysis && <span className="ml-1 text-xs text-amber-700">· analysis pending</span>}
            </span>
            <Button variant="ghost" onClick={() => setOpen(r)}>Open</Button>
          </div>
        );
      })}
      {open && <ReactionModal reaction={open} onClose={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function ReactionModal({ reaction, onClose }: { reaction: BbReaction; onClose: () => void }) {
  const [r, setR] = useState(reaction);
  const [v, setV] = useState({ investigation: r.investigation ?? "", analysis: r.analysis ?? "", outcome: r.outcome ?? "", reportedOn: localDate(), ref: "" });
  const act = async (fn: () => Promise<BbReaction>) => { try { setR(await fn()); } catch (e) { err(e); } };
  return (
    <Modal title={`Reaction · ${r.reaction_type}`} onClose={onClose} width="max-w-2xl">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-neutral-600">{fmtWhen(r.onset_at)} · {r.severity} · reported by {r.recorded_by_name}</p>
        <p><b className="text-xs text-neutral-500">Signs / symptoms</b><br />{r.symptoms}</p>
        <p><b className="text-xs text-neutral-500">Actions at the bedside</b><br />{r.actions}</p>
        <Field label="Investigation (repeat grouping, DAT, culture…)" required><textarea id="rx-inv" className="min-h-16 w-full rounded-lg border border-neutral-200 p-2 text-sm" value={v.investigation} onChange={(e) => setV({ ...v, investigation: e.target.value })} /></Field>
        <Field label="Analysis, preventive and corrective action" required><textarea id="rx-an" className="min-h-16 w-full rounded-lg border border-neutral-200 p-2 text-sm" value={v.analysis} onChange={(e) => setV({ ...v, analysis: e.target.value })} /></Field>
        <Field label="Outcome for the patient" required><Input id="rx-out" value={v.outcome} onChange={(e) => setV({ ...v, outcome: e.target.value })} /></Field>
        <div className="flex justify-end"><Button onClick={() => void act(() => analyseReaction(r.id, v))}>Save analysis</Button></div>
        {SERIOUS.has(r.severity) && (
          <div className="rounded-xl bg-neutral-50 p-3">
            <p className="mb-2 text-xs font-semibold text-neutral-600">Serious reaction: report to the Punjab Blood Transfusion Authority</p>
            {r.reported_to_authority ? <p className="text-xs text-emerald-700">Reported on {r.authority_reported_at} · {r.authority_ref}</p> : (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Date reported"><Input id="rx-on" type="date" value={v.reportedOn} onChange={(e) => setV({ ...v, reportedOn: e.target.value })} /></Field>
                <div className="min-w-52 flex-1"><Field label="Reference (letter / e-mail / portal no)"><Input id="rx-ref" value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} /></Field></div>
                <Button variant="primary" onClick={() => void act(() => reportReactionToAuthority(r.id, v.reportedOn, v.ref))}>Record report</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Indicators ────────────────────────────────────────────────────────────

function Indicators() {
  const [from, setFrom] = useState(() => localDate().slice(0, 8) + "01");
  const [to, setTo] = useState(localDate());
  const [ind, setInd] = useState<BloodIndicators | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void bloodIndicators({ from, to }).then(setInd).catch(err);
  }, [from, to]);
  const pct = (x: number | null) => (x === null ? "—" : `${x}%`);
  const tiles: [string, string, string][] = ind ? [
    ["Units transfused", String(ind.transfused), ""],
    ["Transfusion reactions", `${ind.reactions}`, `${pct(ind.reactionRate)} of transfusions`],
    ["Units discarded", String(ind.discarded), `${pct(ind.wastageRate)} wastage`],
    ["Request to issue (median)", ind.issueTatMedian === null ? "—" : `${ind.issueTatMedian} min`, ""],
  ] : [];
  return (
    <div className={card}>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From"><Input id="ind-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input id="ind-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <p className="pb-2 text-[11px] text-neutral-400">MSDS CQI-2 Ind. 104: blood and blood product usage, wastage and reactions.</p>
      </div>
      {ind && (
        <div className="flex flex-col gap-4">
          {ind.seriousNotReported > 0 && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{ind.seriousNotReported} serious reaction(s) not yet reported to the Authority.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map(([l, n, sub]) => (
              <div key={l} className="rounded-xl bg-neutral-50 p-3">
                <p className="text-xs text-neutral-500">{l}</p>
                <p className="text-xl font-semibold tabular-nums">{n}</p>
                {sub && <p className="text-[11px] text-neutral-500">{sub}</p>}
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-neutral-600">Component usage</p>
            {ind.byComponent.length === 0 ? <p className="text-xs text-neutral-400">No transfusions in this period.</p> : ind.byComponent.map((c) => (
              <div key={c.component} className="flex items-center gap-2 text-xs">
                <span className="w-40">{c.component}</span>
                <div className="h-2 flex-1 rounded-full bg-neutral-100"><div className="h-2 rounded-full bg-rose-600" style={{ width: `${c.share ?? 0}%` }} /></div>
                <span className="w-20 text-right tabular-nums">{c.transfused} · {pct(c.share)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
