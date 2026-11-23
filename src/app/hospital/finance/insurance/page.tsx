"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { isTauri } from "@/lib/platform";
import { CLAIM_STATUSES, claimLabel, listInsuranceCompanies, type ClaimStatus, type InsuranceCompany } from "@/lib/repo/insurance";
import { companyOverview, insuredEpisodes, setHospitalClaim, type InsuredEpisode } from "@/lib/repo/hospitalInsurance";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const money = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 0 });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const tone = (s: ClaimStatus) => CLAIM_STATUSES.find((x) => x.id === s)?.tone ?? "";

/** Finance > Insurance Payments: insured patients' bills, what the companies
 * owe, and each claim's status; Insurance Companies shows one company's cases. */
export default function InsurancePaymentsPage() {
  const [rows, setRows] = useState<InsuredEpisode[]>([]);
  const [status, setStatus] = useState<ClaimStatus | "">("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<ClaimStatus>("sent");
  const [ref, setRef] = useState("");
  const [companies, setCompanies] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try { setRows(await insuredEpisodes()); setError(null); } catch (e) { setError(/no such (table|column)/i.test(msg(e)) ? "Insurance payments need the database update (v100)." : msg(e)); }
  }
  useEffect(() => { void reload(); }, []);

  const byCompany = useMemo(() => {
    const m = new Map<string, InsuredEpisode[]>();
    for (const r of rows) m.set(r.companyName, [...(m.get(r.companyName) ?? []), r]);
    return [...m.entries()].map(([name, list]) => ({ name, ...companyOverview(list) })).sort((a, b) => b.pending - a.pending);
  }, [rows]);
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!status || r.status === status) && (!q || `${r.patientName} ${r.mrNo ?? ""} ${r.policyNo ?? ""} ${r.companyName} ${r.episodeNo}`.toLowerCase().includes(q)));

  async function apply(ids: string[], s: ClaimStatus, claimRef?: string) {
    setNote(null);
    try { const n = await setHospitalClaim(ids, s, claimRef); setPicked(new Set()); setNote(`${n} bill${n === 1 ? "" : "s"} set to ${claimLabel(s)}.`); await reload(); }
    catch (e) { setNote(msg(e)); }
  }

  return (
    <div>
      <PageHeader title="Insurance Payments" actions={<Button onClick={() => setCompanies(true)}><Building2 size={14} className="mr-1" />Insurance Companies</Button>} />
      {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {byCompany.length === 0 ? <div className={card}><p className="text-sm text-neutral-400">No insured patients yet. Mark a patient as insured on registration.</p></div> : byCompany.map((c) => (
          <div key={c.name} className={card}>
            <p className="font-semibold">{c.name}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
              <span>Pending <b className="text-amber-700">Rs {money(c.pending)}</b></span><span>Paid <b className="text-emerald-700">Rs {money(c.paid)}</b></span>
              <span className="text-neutral-500">{c.cases} cases · {c.claimedCases} claimed</span>
            </div>
          </div>
        ))}
      </div>
      <div className={card}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Find"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Patient, MR, policy or company" /></Field>
          <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus | "")}><option value="">All</option>{CLAIM_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        </div>
        {shown.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No insured bills.</p> : <ClaimsTable rows={shown} picked={picked} setPicked={setPicked} onStatus={(id, s) => void apply([id], s)} />}
        {picked.size > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3">
            <p className="pb-2 text-sm">{picked.size} chosen</p>
            <Field label="Set status"><Select value={bulk} onChange={(e) => setBulk(e.target.value as ClaimStatus)}>{CLAIM_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
            <Field label="Claim ref. (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
            <Button variant="primary" onClick={() => void apply([...picked], bulk, ref.trim() ? ref : undefined)}>Apply</Button>
          </div>
        )}
        {note && <p className="mt-2 text-sm text-neutral-700">{note}</p>}
      </div>
      {companies && <CompaniesModal rows={rows} onClose={() => setCompanies(false)} />}
    </div>
  );
}

function ClaimsTable({ rows, picked, setPicked, onStatus, compact = false }: {
  rows: InsuredEpisode[]; picked?: Set<string>; setPicked?: (s: Set<string>) => void; onStatus?: (id: string, s: ClaimStatus) => void; compact?: boolean;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-neutral-500">
          {setPicked && <th className="pb-1.5 pr-2"><input type="checkbox" aria-label="Choose all" checked={picked!.size === rows.length} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.episodeId)) : new Set())} /></th>}
          <th className="pb-1.5 pr-3 font-medium">Patient</th>{!compact && <th className="pb-1.5 pr-3 font-medium">Company</th>}<th className="pb-1.5 pr-3 font-medium">Episode</th>
          <th className="pb-1.5 pr-3 text-right font-medium">Bill</th><th className="pb-1.5 pr-3 text-right font-medium">Insurance</th><th className="pb-1.5 pr-3 text-right font-medium">Patient</th><th className="pb-1.5 font-medium">Status</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.episodeId} className="border-t border-neutral-100">
              {setPicked && <td className="py-1.5 pr-2"><input type="checkbox" aria-label={`Choose ${r.episodeNo}`} checked={picked!.has(r.episodeId)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.episodeId); else n.delete(r.episodeId); setPicked(n); }} /></td>}
              <td className="py-1.5 pr-3">{r.patientName}<span className="block font-mono text-[11px] text-neutral-500">{r.mrNo}{r.policyNo ? ` · Policy ${r.policyNo}` : ""}</span></td>
              {!compact && <td className="py-1.5 pr-3">{r.companyName}</td>}
              <td className="py-1.5 pr-3"><span className="font-mono text-xs">{r.episodeNo}</span><span className="block text-[11px] text-neutral-500">{r.date}</span></td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.total)}</td>
              <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{money(r.cover)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-600">{money(r.patientShare)}</td>
              <td className="py-1.5">{onStatus
                ? <select aria-label={`Claim status of ${r.episodeNo}`} value={r.status} onChange={(e) => onStatus(r.episodeId, e.target.value as ClaimStatus)} className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${tone(r.status)}`}>
                    {CLAIM_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                : <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone(r.status)}`}>{claimLabel(r.status)}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Left: the companies. Right: the chosen company's overview and its clients. */
function CompaniesModal({ rows, onClose }: { rows: InsuredEpisode[]; onClose: () => void }) {
  const [list, setList] = useState<InsuranceCompany[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { void listInsuranceCompanies().then((c) => { setList(c); setId((x) => x ?? c[0]?.id ?? null); }).catch(() => setList([])); }, []);
  const mine = rows.filter((r) => r.companyId === id);
  const ov = companyOverview(mine);
  const term = q.trim().toLowerCase();
  const clients = mine.filter((r) => !term || `${r.patientName} ${r.mrNo ?? ""} ${r.policyNo ?? ""}`.toLowerCase().includes(term));
  return (
    <Modal title="Insurance Companies" onClose={onClose} width="max-w-6xl">
      <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="max-h-[32rem] overflow-y-auto rounded-xl ring-1 ring-black/[0.06]">
          {list.length === 0 ? <p className="p-3 text-sm text-neutral-400">No companies yet.</p> : list.map((c) => (
            <button key={c.id} type="button" onClick={() => setId(c.id)} className={`block w-full border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-0 ${id === c.id ? "bg-sky-50 font-semibold" : "hover:bg-neutral-50"}`}>{c.name}</button>
          ))}
        </div>
        <div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[["Cases entertained", String(ov.cases)], ["Total claim", `Rs ${money(ov.totalClaim)}`], ["Claimed cases", `${ov.claimedCases} · Rs ${money(ov.claimedTotal)}`], ["Pending payments", `Rs ${money(ov.pending)}`]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]"><p className="text-xs text-neutral-500">{l}</p><p className="text-lg font-bold">{v}</p></div>
            ))}
          </div>
          <div className="mt-3 max-w-sm"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" aria-label="Search clients" /></div>
          {clients.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No clients of this company.</p> : <ClaimsTable rows={clients} compact />}
        </div>
      </div>
    </Modal>
  );
}
