"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, GitMerge, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { serverJson } from "@/lib/serverMode";
import type { DupPair, DupProduct, MergeLogRow, MergeResult } from "@/server/productDuplicates";

const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const call = async <T,>(action: string, body: Record<string, unknown> = {}) => (await serverJson<{ result: T }>("/api/catalog/duplicates/", { ...body, action })).result;

type Group = "pharma" | "general_store";
type Usage = Record<string, { batches: number; stock: number; invoices: number; purchases: number; businesses: number }>;
const GROUPS: { key: Group; label: string }[] = [{ key: "pharma", label: "Pharmacy catalogue" }, { key: "general_store", label: "General store catalogue" }];

/** Super Admin > Duplicate Products: products whose names match by more than half, to merge or mark "not duplicates". */
export default function DuplicateProductsPage() {
  const [group, setGroup] = useState<Group>("pharma");
  const [view, setView] = useState<"pairs" | "log">("pairs");
  const [minScore, setMinScore] = useState(0.5);
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ pairs: DupPair[]; total: number; compared: number } | null>(null);
  const [log, setLog] = useState<MergeLogRow[] | null>(null);
  const [usage, setUsage] = useState<Usage>({});
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState<{ pair: DupPair; keep: "a" | "b" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (view === "log") { setLog(await call<MergeLogRow[]>("log")); return; }
      setData(null);
      const r = await call<{ pairs: DupPair[]; total: number; compared: number }>("pairs", { group, minScore, q: q.trim(), limit: 150 });
      setData(r);
      const ids = Array.from(new Set(r.pairs.slice(0, 40).flatMap((p) => [p.a.id, p.b.id])));
      for (let i = 0; i < ids.length; i += 10) void call<Usage>("usage", { ids: ids.slice(i, i + 10) }).then((u) => setUsage((x) => ({ ...x, ...u }))).catch(() => undefined);
    } catch (e) {
      setData({ pairs: [], total: 0, compared: 0 });
      setError(/no such table/i.test(msg(e)) ? "Duplicate Products needs the database update (v112)." : msg(e));
    }
  }, [group, minScore, q, view]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  /** A merged product leaves every pair it was in. */
  const drop = (ids: string[]) => setData((d) => d && { ...d, pairs: d.pairs.filter((p) => !ids.includes(p.a.id) && !ids.includes(p.b.id)), total: Math.max(0, d.total - 1) });

  async function dismiss(p: DupPair) {
    setBusy(p.key);
    try { await call("dismiss", { aId: p.a.id, bId: p.b.id }); setData((d) => d && { ...d, pairs: d.pairs.filter((x) => x.key !== p.key), total: Math.max(0, d.total - 1) }); }
    catch (e) { notify(msg(e)); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Duplicate Products" />
      <p className="-mt-2 text-sm text-neutral-600">
        Products whose names match by more than half: two in a shared catalogue, or a business&apos;s own product and a shared one. Merge them (all stock, prices,
        invoices and purchases of every business move to the kept product, which everyone then sees) or mark them as not duplicates.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Catalogue" className="flex gap-1 rounded-xl bg-neutral-200/70 p-1 text-sm">
          {GROUPS.map((g) => (
            <button key={g.key} type="button" role="tab" aria-selected={view === "pairs" && group === g.key} onClick={() => { setView("pairs"); setGroup(g.key); }}
              className={`rounded-lg px-3 py-1.5 font-medium ${view === "pairs" && group === g.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>{g.label}</button>
          ))}
          <button type="button" role="tab" aria-selected={view === "log"} onClick={() => setView("log")}
            className={`rounded-lg px-3 py-1.5 font-medium ${view === "log" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>Merged</button>
        </div>
        {view === "pairs" && <>
          <div className="w-full max-w-xs"><Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name" aria-label="Search products" /></div>
          <label className="flex items-center gap-2 text-sm text-neutral-600">Names match at least
            <Select value={String(minScore)} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Lowest match">
              {[0.5, 0.6, 0.7, 0.8, 0.9].map((s) => <option key={s} value={s}>{Math.round(s * 100)}%</option>)}
            </Select>
          </label>
        </>}
      </div>

      <FormError message={error} />

      {view === "log" ? <MergeLog rows={log} /> : data === null ? <div className={`${card} h-40 animate-pulse`} aria-busy="true" /> : (
        <>
          <p className="text-sm text-neutral-500"><b className="text-neutral-800">{data.total}</b> possible duplicate pair{data.total === 1 ? "" : "s"} among {data.compared.toLocaleString()} products{data.total > data.pairs.length ? ` (best ${data.pairs.length} shown)` : ""}.</p>
          {data.pairs.length === 0 ? <p className={`${card} fade-in text-sm text-neutral-500`}>No possible duplicates at this match level.</p> : (
            <ul className="flex flex-col gap-3">
              {data.pairs.map((p, i) => (
                <li key={p.key} className={`${card} row-in`} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.score >= 0.9 ? "bg-emerald-100 text-emerald-800" : p.score >= 0.7 ? "bg-sky-100 text-sky-800" : "bg-neutral-100 text-neutral-700"}`}>{Math.round(p.score * 100)}% name match</span>
                    {p.numbersDiffer && <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200"><AlertTriangle size={12} aria-hidden="true" />Different numbers: {p.numbersDiffer} (strength or pack?)</span>}
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <ProductBox p={p.a} usage={usage[p.a.id]} />
                    <ProductBox p={p.b} usage={usage[p.b.id]} />
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" loading={busy === p.key} disabled={busy !== null} onClick={() => void dismiss(p)}><X size={14} className="mr-1" />Not duplicates</Button>
                    {p.keep.includes("a") && <Button disabled={busy !== null} onClick={() => setMerging({ pair: p, keep: "a" })}><GitMerge size={14} className="mr-1" />Keep left, merge right</Button>}
                    {p.keep.includes("b") && <Button disabled={busy !== null} onClick={() => setMerging({ pair: p, keep: "b" })}><GitMerge size={14} className="mr-1" />Keep right, merge left</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {merging && (
        <MergeModal pair={merging.pair} keep={merging.keep} usage={usage} onClose={() => setMerging(null)}
          onDone={(r, mergedId) => { setMerging(null); drop([mergedId]); notify(`Merged. ${Object.values(r.moved).reduce((s, n) => s + n, 0)} records moved to the kept product.`, "success"); }} />
      )}
    </div>
  );
}

function ProductBox({ p, usage }: { p: DupProduct; usage?: Usage[string] }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200/70">
      <p className="text-sm font-semibold text-neutral-900">{p.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${p.owner === "shared" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>{p.owner === "shared" ? "Shared catalogue" : `Own product of ${p.tenantName}`}</span>
        {!p.unitsSet && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">units not set</span>}
      </p>
      <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-neutral-500">Generic / desc.</dt><dd className="text-neutral-800">{p.description ?? "—"}</dd>
        <dt className="text-neutral-500">Company</dt><dd className="text-neutral-800">{p.company ?? "—"}</dd>
        <dt className="text-neutral-500">Barcode</dt><dd className="font-mono text-neutral-800">{p.barcode ?? "—"}</dd>
        <dt className="text-neutral-500">Packing</dt><dd className="text-neutral-800">{p.packing}</dd>
        <dt className="text-neutral-500">Used</dt>
        <dd className="text-neutral-800">{usage ? `${usage.businesses} business${usage.businesses === 1 ? "" : "es"} · stock ${usage.stock} · ${usage.invoices} sale lines · ${usage.purchases} purchase lines` : "…"}</dd>
      </dl>
    </div>
  );
}

function MergeModal({ pair, keep, usage, onClose, onDone }: { pair: DupPair; keep: "a" | "b"; usage: Usage; onClose: () => void; onDone: (r: MergeResult, mergedId: string) => void }) {
  const kept = keep === "a" ? pair.a : pair.b;
  const gone = keep === "a" ? pair.b : pair.a;
  const [fill, setFill] = useState(true);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = usage[gone.id];
  const lines = useMemo(() => u ? [`${u.stock} in stock (${u.batches} batch rows)`, `${u.invoices} sale lines`, `${u.purchases} purchase lines`, `in ${u.businesses} business${u.businesses === 1 ? "" : "es"}`] : [], [u]);
  async function go() {
    setBusy(true);
    setError(null);
    try { onDone(await call<MergeResult>("merge", { survivorId: kept.id, mergeIds: [gone.id], fillBlanks: fill }), gone.id); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Merge products" onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center gap-2 rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
          <div className="min-w-0 flex-1"><p className="text-xs text-neutral-500">Merged and removed</p><p className="font-semibold text-neutral-900 line-through decoration-rose-400">{gone.name}</p>
            <p className="text-xs text-neutral-500">{gone.owner === "shared" ? "Shared catalogue" : `Own product of ${gone.tenantName}`}</p></div>
          <ArrowRight size={18} className="shrink-0 text-neutral-400" aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="text-xs text-neutral-500">Kept, shown to everyone</p><p className="font-semibold text-emerald-800">{kept.name}</p><p className="text-xs text-neutral-500">Shared catalogue</p></div>
        </div>
        <p className="text-neutral-700">Every record of <b>{gone.name}</b> in every business moves to <b>{kept.name}</b>{lines.length ? `: ${lines.join(", ")}` : ""}. This cannot be undone.</p>
        {pair.numbersDiffer && <p className="flex gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />The numbers in the names differ ({pair.numbersDiffer}). Make sure this is the same product and strength.</p>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
          <span>Fill the kept product&apos;s empty fields (barcode, company, generic name, HS code, units) from the merged one</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
          <span>Yes, these are the same product</span></label>
      </div>
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={busy || !sure} onClick={() => void go()}><Check size={14} className="mr-1" />Merge</Button>
      </div>
    </Modal>
  );
}

function MergeLog({ rows }: { rows: MergeLogRow[] | null }) {
  if (rows === null) return <div className={`${card} h-40 animate-pulse`} aria-busy="true" />;
  if (!rows.length) return <p className={`${card} text-sm text-neutral-500`}>No products merged yet.</p>;
  return (
    <section className={card}>
      <ul className="divide-y divide-neutral-100">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="w-36 shrink-0 text-xs text-neutral-500">{r.at.slice(0, 16).replace("T", " ")}</span>
            <span className="min-w-0 flex-1"><span className="text-neutral-500 line-through">{r.mergedName}</span>{r.mergedTenant ? <span className="text-xs text-neutral-400"> ({r.mergedTenant})</span> : null}
              <ArrowRight size={13} className="mx-1.5 inline text-neutral-400" aria-hidden="true" /><b>{r.survivorName}</b></span>
            <span className="text-xs text-neutral-500">{Object.values(r.moved).reduce((s, n) => s + n, 0)} records moved</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
