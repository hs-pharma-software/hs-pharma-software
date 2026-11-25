"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { auditsRepo, auditCountLines, auditReport, closeAudit, saveAuditCounts, type AuditCountLine, type AuditReport } from "@/lib/repo/audits";
import type { AuditRow } from "@/lib/types2";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-3 font-medium";
const td = "py-1.5 pr-3";
const num = `${td} text-right tabular-nums`;
const q3 = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-PK", { maximumFractionDigits: 3 });
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;

export default function AuditCountPage() {
  return <Suspense fallback={null}><AuditCount /></Suspense>;
}

/** Utilities > Audit Detail > an initiated audit: enter the stock actually
 * available against the system stock, then close it for the audit report. */
function AuditCount() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const [audit, setAudit] = useState<AuditRow | null>(null);
  const [lines, setLines] = useState<AuditCountLine[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "uncounted" | "diff">("all");
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<AuditReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    if (!isTauri() || !id) return;
    try {
      const a = await auditsRepo.get(id);
      setAudit(a);
      if (a?.status === "closed") setReport(await auditReport(id));
      else setLines(await auditCountLines(id));
      setEdits({});
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = (l: AuditCountLine) => edits[l.id] ?? (l.counted_qty == null ? "" : String(l.counted_qty));
  const counted = (l: AuditCountLine) => { const v = value(l); return v.trim() === "" ? null : Number(v); };
  const qs = search.trim().toLowerCase();
  const shown = useMemo(() => lines.filter((l) => {
    if (qs && !`${l.product_name} ${l.company_name ?? ""}`.toLowerCase().includes(qs)) return false;
    const c = counted(l);
    if (filter === "uncounted") return c == null;
    if (filter === "diff") return c != null && c !== l.system_qty;
    return true;
  }), [lines, edits, filter, qs]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = lines.filter((l) => counted(l) != null).length;
  const pending = Object.keys(edits).length;

  async function save(): Promise<boolean> {
    if (!pending) return true;
    setBusy(true);
    setMsg(null);
    try {
      await saveAuditCounts(id, Object.fromEntries(Object.entries(edits).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)])));
      await load();
      setMsg("Saved.");
      return true;
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); }
  }

  async function close() {
    if (!(await save())) return;
    const fresh = await auditCountLines(id);
    const missing = fresh.filter((l) => l.counted_qty == null).length;
    if (!window.confirm(missing
      ? `${missing} product${missing === 1 ? " is" : "s are"} not counted. Close the audit and take ${missing === 1 ? "it" : "them"} as not available (0)?`
      : "Close the audit? Counts can no longer change after closing.")) return;
    setBusy(true);
    try { await closeAudit(id, true); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  if (!id) return <p className="text-sm text-neutral-500">No audit chosen.</p>;
  if (!audit) return <p className="text-sm text-neutral-400">{msg ?? "Loading audit…"}</p>;

  if (audit.status === "closed" && report) return <AuditReportView audit={audit} r={report} onBack={() => router.push("/utilities/audit")} />;

  return (
    <div>
      <PageHeader title={`Audit: ${audit.audit_name ?? ""}`} actions={
        <div className="flex gap-2">
          <Button onClick={() => router.push("/utilities/audit")}>Back</Button>
          <Button loading={busy} disabled={busy || !pending} onClick={() => void save()}>{busy ? "Saving…" : `Save${pending ? ` (${pending})` : ""}`}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void close()}>Close audit</Button>
        </div>
      } />
      <div className={card}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Find product"><Input id="ac-q" value={search} placeholder="Product or company" onChange={(e) => setSearch(e.target.value)} autoFocus /></Field>
          <Field label="Show">
            <Select id="ac-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">All products</option><option value="uncounted">Not counted yet</option><option value="diff">With a difference</option>
            </Select>
          </Field>
          <p className="pb-2 text-sm text-neutral-600">Counted <b>{done}</b> of <b>{lines.length}</b> · started {audit.date}</p>
          {msg && <p className="pb-2 text-sm text-neutral-700">{msg}</p>}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full bg-emerald-500" style={{ width: `${lines.length ? (done / lines.length) * 100 : 0}%` }} /></div>
      </div>
      <div className={`${card} mt-4`}>
        {shown.length === 0 ? <p className="text-sm text-neutral-400">No products here.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500">
                <th className={th}>Product</th><th className={`${th} text-right`}>System stock</th><th className={`${th} text-right`}>Available stock</th><th className={`${th} text-right`}>Difference</th>
              </tr></thead>
              <tbody>
                {shown.map((l) => {
                  const c = counted(l);
                  const diff = c == null ? null : Math.round((c - l.system_qty) * 1000) / 1000;
                  return (
                    <tr key={l.id} className="border-t border-neutral-100">
                      <td className={td}>{l.product_name}{l.company_name && <span className="block text-[11px] text-neutral-500">{l.company_name}</span>}</td>
                      <td className={num}>{q3(l.system_qty)}</td>
                      <td className={`${td} text-right`}>
                        <input type="number" min="0" step="any" inputMode="decimal" aria-label={`Available stock of ${l.product_name}`} value={value(l)}
                          onChange={(e) => setEdits((x) => ({ ...x, [l.id]: e.target.value }))}
                          className={`w-24 rounded-lg border px-2 py-1 text-right text-sm ${edits[l.id] !== undefined ? "border-amber-400 bg-amber-50" : "border-neutral-200"}`} />
                      </td>
                      <td className={`${num} ${diff == null ? "text-neutral-300" : diff < 0 ? "text-rose-700" : diff > 0 ? "text-emerald-700" : "text-neutral-500"}`}>
                        {diff == null ? "—" : diff > 0 ? `+${q3(diff)}` : q3(diff)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AuditReportView({ audit, r, onBack }: { audit: AuditRow; r: AuditReport; onBack: () => void }) {
  const [all, setAll] = useState(false);
  const rows = all ? r.lines : r.lines.filter((l) => l.diff !== 0);
  return (
    <div>
      <PageHeader title={`Audit report: ${audit.audit_name ?? ""}`} actions={
        <div className="flex gap-2 print:hidden">
          <Button onClick={onBack}>Back</Button>
          <Button variant="secondary" onClick={() => window.print()}><Printer size={14} />Print</Button>
        </div>
      } />
      <div className="print-area">
        <div className={card}>
          <p className="text-xs text-neutral-500">Started {audit.date} · closed {audit.closed_at?.slice(0, 10) ?? ""}{audit.closed_by_name ? ` by ${audit.closed_by_name}` : ""}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><p className="text-xs text-neutral-500">Products audited</p><p className="text-2xl font-bold">{r.products}</p><p className="text-xs text-neutral-500">{r.matched} matched</p></div>
            <div><p className="text-xs text-neutral-500">Short (not available)</p><p className="text-2xl font-bold text-rose-700">{rs(r.short.amount)}</p><p className="text-xs text-neutral-500">{r.short.n} products · {q3(r.short.qty)} packs</p></div>
            <div><p className="text-xs text-neutral-500">Excess (found extra)</p><p className="text-2xl font-bold text-emerald-700">{rs(r.excess.amount)}</p><p className="text-xs text-neutral-500">{r.excess.n} products · {q3(r.excess.qty)} packs</p></div>
            <div><p className="text-xs text-neutral-500">Net difference</p><p className={`text-2xl font-bold ${r.net < 0 ? "text-rose-700" : "text-neutral-900"}`}>{rs(r.net)}</p><p className="text-xs text-neutral-500">at purchase cost</p></div>
          </div>
        </div>
        <div className={`${card} mt-4`}>
          <div className="mb-2 flex items-center justify-between print:hidden">
            <p className="text-sm font-semibold">{all ? "All products" : "Products with a difference"}</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show all products</label>
          </div>
          {rows.length === 0 ? <p className="text-sm text-emerald-700">Every product matched the system stock.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500">
                  <th className={th}>Product</th><th className={`${th} text-right`}>System</th><th className={`${th} text-right`}>Available</th><th className={`${th} text-right`}>Difference</th>
                  <th className={`${th} text-right`}>Unit cost</th><th className={`${th} text-right`}>Amount (Rs)</th>
                </tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className="border-t border-neutral-100">
                      <td className={td}>{l.product_name}{l.company_name && <span className="block text-[11px] text-neutral-500">{l.company_name}</span>}</td>
                      <td className={num}>{q3(l.system_qty)}</td><td className={num}>{q3(l.counted_qty ?? 0)}</td>
                      <td className={`${num} ${l.diff < 0 ? "text-rose-700" : l.diff > 0 ? "text-emerald-700" : ""}`}>{l.diff > 0 ? `+${q3(l.diff)}` : q3(l.diff)}</td>
                      <td className={num}>{l.unit_cost.toLocaleString("en-PK", { maximumFractionDigits: 2 })}</td>
                      <td className={`${num} ${l.amount < 0 ? "text-rose-700" : l.amount > 0 ? "text-emerald-700" : ""}`}>{l.amount.toLocaleString("en-PK", { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-neutral-500">Amounts at each product&apos;s purchase cost on the day the audit started. The audit reports differences; it does not change stock.</p>
        </div>
      </div>
    </div>
  );
}
