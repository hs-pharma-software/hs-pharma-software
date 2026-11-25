"use client";

import { useEffect, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { billLines, listEpisodeBills, pctForAmount, setBillDiscounts, type EpisodeBill } from "@/lib/repo/episodeBills";
import type { HospitalCharge } from "@/lib/types-hospital";
import { ReceiptModal } from "@/app/hospital/reception/ReceiptModal";

const rs = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 0 });
const TYPE: Record<string, string> = { opd: "OPD", ipd: "Admission", emergency: "Emergency" };
const firstOfMonth = () => `${localDate().slice(0, 7)}-01`;

/** Episode bills with their discount, paid and balance; Edit changes a bill's discount. */
export function EpisodeBillsPanel({ defaultStatus = "all", compact = false }: { defaultStatus?: "all" | "unpaid" | "paid"; compact?: boolean }) {
  const [from, setFrom] = useState(compact ? localDate() : firstOfMonth());
  const [to, setTo] = useState(localDate());
  const [type, setType] = useState("");
  const [status, setStatus] = useState<"all" | "unpaid" | "paid">(defaultStatus);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<EpisodeBill[]>([]);
  const [editing, setEditing] = useState<EpisodeBill | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try { setRows(await listEpisodeBills({ from, to, type, status, search })); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { const t = setTimeout(() => void reload(), 200); return () => clearTimeout(t); }, [from, to, type, status, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = rows.reduce((a, r) => ({ total: a.total + r.total, discount: a.discount + r.discount, paid: a.paid + r.paid, balance: a.balance + r.balance }), { total: 0, discount: 0, paid: 0, balance: 0 });
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option><option value="opd">OPD</option><option value="emergency">Emergency</option><option value="ipd">Admission</option></Select>
        </Field>
        <Field label="Bills">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">All</option><option value="unpaid">With balance</option><option value="paid">Paid</option></Select>
        </Field>
        <Field label="Find"><Input value={search} placeholder="Patient, MR, episode no" onChange={(e) => setSearch(e.target.value)} /></Field>
      </div>
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-x-6 text-sm">
        <span>Bills: <b>{rows.length}</b></span><span>Total: <b>Rs {rs(sum.total)}</b></span><span>Discount: <b>Rs {rs(sum.discount)}</b></span>
        <span className="text-emerald-700">Paid: <b>Rs {rs(sum.paid)}</b></span><span className="text-rose-700">Balance: <b>Rs {rs(sum.balance)}</b></span>
      </div>
      {rows.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No bills.</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500">
              <th className="pb-1.5 pr-3 font-medium">Episode</th><th className="pb-1.5 pr-3 font-medium">Patient</th>
              {!compact && <th className="pb-1.5 pr-3 font-medium">Doctor / dept</th>}
              <th className="pb-1.5 pr-3 text-right font-medium">Total</th><th className="pb-1.5 pr-3 text-right font-medium">Discount</th>
              <th className="pb-1.5 pr-3 text-right font-medium">Paid</th><th className="pb-1.5 pr-3 text-right font-medium">Balance</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3"><span className="font-mono text-xs">{r.episode_no}</span><span className="block text-[11px] text-neutral-500">{TYPE[r.type] ?? r.type} · {r.date}</span></td>
                  <td className="py-1.5 pr-3">{r.patient_name}<span className="block font-mono text-[11px] text-neutral-500">{r.mr_no}</span></td>
                  {!compact && <td className="py-1.5 pr-3 text-xs text-neutral-600">{[r.doctor_name, r.department].filter(Boolean).join(" · ") || "—"}</td>}
                  <td className="py-1.5 pr-3 text-right tabular-nums">{rs(r.total)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-600">{r.discount ? rs(r.discount) : "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{rs(r.paid)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${r.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {rs(r.balance)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {compact
                      ? <a href={`/hospital/episodes/view?id=${r.id}`} title="Open the bill" className="mr-2 inline-flex text-neutral-500 hover:text-neutral-900"><Eye size={15} /></a>
                      : <button type="button" title="View bill and print receipt" onClick={() => setViewing(r.id)} className="mr-2 inline-flex text-neutral-500 hover:text-neutral-900"><Eye size={15} /></button>}
                    <button type="button" title="Edit discount" onClick={() => setEditing(r)} className="inline-flex text-neutral-500 hover:text-neutral-900"><Pencil size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <BillEditModal bill={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {viewing && <ReceiptModal episodeId={viewing} readOnly onClose={() => setViewing(null)} onChanged={() => {}} />}
    </div>
  );
}

function BillEditModal({ bill, onClose, onSaved }: { bill: EpisodeBill; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<(HospitalCharge & { locked: boolean })[]>([]);
  const [pcts, setPcts] = useState<Record<string, string>>({});
  const [whole, setWhole] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void billLines(bill.id).then((ls) => { setLines(ls); setPcts(Object.fromEntries(ls.map((l) => [l.id, String(l.discount_pct ?? 0)]))); });
  }, [bill.id]);

  const open = lines.filter((l) => !l.locked);
  const net = (l: HospitalCharge) => Math.round(Number(l.qty) * Number(l.rate) * (1 - (Number(pcts[l.id]) || 0) / 100) * 100) / 100;
  const total = lines.reduce((a, l) => a + (l.locked ? Number(l.amount) : net(l)), 0);

  function applyWhole() {
    const pct = pctForAmount(open, Number(whole));
    setPcts((p) => ({ ...p, ...Object.fromEntries(open.map((l) => [l.id, String(pct)])) }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setBillDiscounts(bill.id, Object.fromEntries(open.map((l) => [l.id, Number(pcts[l.id]) || 0])), reason);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit bill · ${bill.episode_no}`} onClose={onClose} width="max-w-2xl">
      <p className="mb-2 text-sm text-neutral-600">{bill.patient_name} <span className="font-mono text-xs text-neutral-500">{bill.mr_no}</span> · paid Rs {rs(bill.paid)}</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1 pr-2 font-medium">Charge</th><th className="pb-1 pr-2 text-right font-medium">Qty × rate</th><th className="pb-1 pr-2 text-right font-medium">Discount %</th><th className="pb-1 text-right font-medium">Amount</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-neutral-100">
              <td className="py-1 pr-2">{l.description}{l.locked && <span className="block text-[11px] text-amber-700">On a surgery invoice: change it there</span>}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{l.qty} × {rs(l.rate)}</td>
              <td className="py-1 pr-2 text-right">
                <input type="number" min="0" max="100" step="any" disabled={l.locked} aria-label={`Discount % on ${l.description}`} value={pcts[l.id] ?? "0"}
                  onChange={(e) => setPcts({ ...pcts, [l.id]: e.target.value })} className="w-20 rounded-lg border border-neutral-200 px-2 py-0.5 text-right text-sm disabled:bg-neutral-50" />
              </td>
              <td className="py-1 text-right tabular-nums">{rs(l.locked ? Number(l.amount) : net(l))}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-neutral-300 font-semibold"><td className="py-1" colSpan={3}>Bill total</td><td className="py-1 text-right tabular-nums">{rs(total)}</td></tr>
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3">
        <Field label="Discount on the whole bill (Rs)"><Input inputMode="decimal" value={whole} onChange={(e) => setWhole(e.target.value)} /></Field>
        <Button onClick={applyWhole} disabled={!open.length || !(Number(whole) > 0)}>Spread over the lines</Button>
      </div>
      <Field label="Reason (required)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Staff family, poor patient, approved by MS" /></Field>
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button loading={busy} variant="primary" disabled={busy || !reason.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
