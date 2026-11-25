"use client";

import { useEffect, useId, useState } from "react";
import { AlertTriangle, Bell } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { localDate } from "@/lib/localDate";
import type { StoreId } from "@/config/hospitalStores";
import {
  DEAD_REASONS, deadStockRegister, recordDeadStock, storeDashboard, storeRegister, storeRegisterSuggestions, storeStock,
  type RegisterRow, type RegisterSuggestions, type StoreDashboard, type StoreMove, type StoreStockRow,
} from "@/lib/repo/hospitalStores";
import { decideIndentReturn, issueIndent, issueIndentBook, listIndentBooks, storeIndents, type IndentBook, type IndentWithItems } from "@/lib/repo/storeIndents";
import { StockHistoryModal } from "./StockHistoryModal";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const money = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KIND: Record<StoreMove["kind"], string> = { receipt: "Received", issue: "Issued", return_in: "Returned in", return_out: "Returned out", dead: "Dead stock", adjust: "Adjusted" };

/** The store's dashboard: entries waiting, low stock, dead items and notices. */
export function StoreDashboardTab({ store, onGo }: { store: StoreId; onGo: (tab: "arrivals" | "indents") => void }) {
  const [d, setD] = useState<StoreDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void storeDashboard(store).then(setD).catch((e) => setError(msg(e))); }, [store]);
  if (error) return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (!d) return <p className="text-sm text-neutral-400">Loading…</p>;
  const tiles: [string, number, string, (() => void) | null][] = [
    ["Purchases to verify", d.pendingArrivals, "text-sky-700", () => onGo("arrivals")],
    ["Indents to issue", d.pendingIndents, "text-amber-700", () => onGo("indents")],
    ["Returns from wards", d.pendingReturns, "text-rose-700", () => onGo("indents")],
    ["Returned to purchase officer", d.returnedToOfficer, "text-neutral-700", null],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([l, n, c, go]) => (
          <button key={l} type="button" disabled={!go} onClick={() => go?.()} className={`${card} text-left ${go ? "hover:ring-neutral-300" : ""}`}>
            <p className="text-xs text-neutral-500">{l}</p><p className={`text-2xl font-bold ${c}`}>{n}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ListCard title="Low stock" empty="Nothing is low." rows={d.lowStock.map((r) => [r.product_name, `${r.qty} left`])} tone="text-amber-700" />
        <ListCard title="Dead items (not used for a month)" empty="Everything was used this month." rows={d.deadItems.map((r) => [r.product_name, `${r.qty} · last used ${r.last_out ?? "never"}`])} tone="text-neutral-600" />
        <div className={card}>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Bell size={14} />Notifications</h3>
          {d.notices.length === 0 ? <p className="text-sm text-neutral-400">No new notifications.</p> : (
            <ul className="flex flex-col gap-1.5 text-sm">{d.notices.map((n, i) => <li key={i} className="flex gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" /><span>{n.text}<span className="block text-[11px] text-neutral-400">{n.at.slice(0, 16).replace("T", " ")}</span></span></li>)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ListCard({ title, empty, rows, tone }: { title: string; empty: string; rows: [string, string][]; tone: string }) {
  return (
    <div className={card}>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">{empty}</p> : (
        <div className="max-h-72 overflow-y-auto">{rows.map(([l, r], i) => <div key={i} className="flex justify-between gap-3 border-t border-neutral-100 py-1.5 text-sm first:border-0"><span className="truncate">{l}</span><span className={`shrink-0 text-xs ${tone}`}>{r}</span></div>)}</div>
      )}
    </div>
  );
}

/** Indents to issue, returns to decide, and indent books to issue. */
export function StoreIndentsTab({ store }: { store: StoreId }) {
  const [rows, setRows] = useState<IndentWithItems[]>([]);
  const [books, setBooks] = useState<IndentBook[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    try { const [r, b] = await Promise.all([storeIndents(store), listIndentBooks("requested")]); setRows(r); setBooks(b); setError(null); } catch (e) { setError(msg(e)); }
  }
  useEffect(() => { void reload(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await reload(); } catch (e) { setError(msg(e)); } };
  const pending = rows.filter((r) => r.status === "pending");
  const returns = rows.flatMap((r) => r.items.filter((i) => i.return_status === "pending").map((i) => ({ r, i })));
  const done = rows.filter((r) => r.status !== "pending");
  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {books.length > 0 && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold">Indent books to issue (ordered by the purchase officer)</h3>
          {books.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 border-t border-neutral-100 py-1.5 text-sm first:border-0">
              <span><b>{b.book_no}</b> for {b.holder_name}{b.department ? ` · ${b.department}` : ""} <span className="text-xs text-neutral-500">ordered by {b.requested_by_name}</span></span>
              <Button variant="primary" onClick={() => void act(() => issueIndentBook(b.id))}>Issue book</Button>
            </div>
          ))}
        </div>
      )}
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold">Indents to issue</h3>
        {pending.length === 0 ? <p className="text-sm text-neutral-400">No indents waiting.</p> : pending.map((r) => (
          <div key={r.id} className="mb-3 rounded-xl bg-neutral-50 p-3">
            <p className="text-sm"><b>{r.indent_no}</b> · {r.department ?? "—"} · {r.requested_by_name} <span className="text-xs text-neutral-500">{r.created_at.slice(0, 10)}</span></p>
            {r.note && <p className="text-xs text-neutral-600">{r.note}</p>}
            <table className="mt-1 w-full text-sm">
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.id} className="border-t border-neutral-200">
                    <td className="py-1 pr-2">{i.product_name}</td><td className="py-1 pr-2 text-right text-xs text-neutral-500">demanded {i.qty_requested}</td>
                    <td className="py-1 text-right"><input type="number" min="0" max={i.qty_requested} step="any" aria-label={`Issue ${i.product_name}`} value={qty[i.id] ?? String(i.qty_requested)} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} className="w-20 rounded-lg border border-neutral-200 px-2 py-0.5 text-right text-sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex justify-end"><Button variant="primary" onClick={() => void act(() => issueIndent(r.id, Object.fromEntries(r.items.map((i) => [i.id, Number(qty[i.id] ?? i.qty_requested)]))))}>Issue</Button></div>
          </div>
        ))}
      </div>
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold">Returns from wards</h3>
        {returns.length === 0 ? <p className="text-sm text-neutral-400">No returns waiting.</p> : returns.map(({ r, i }) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 py-1.5 text-sm first:border-0">
            <span>{i.product_name} · <b>{i.return_qty}</b> from {r.department ?? r.requested_by_name} ({r.indent_no})<span className="block text-xs text-neutral-500">{i.return_note}</span></span>
            <span className="flex gap-1"><Button onClick={() => void act(() => decideIndentReturn(i.id, false))}>Refuse</Button><Button variant="primary" onClick={() => void act(() => decideIndentReturn(i.id, true))}>Accept into stock</Button></span>
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-sm font-semibold">Issued indents ({done.length})</summary>
          {done.map((r) => <p key={r.id} className="mt-1 text-xs">{r.indent_no} · {r.department ?? r.requested_by_name} · {r.status === "received" ? "received" : "issued, receipt not confirmed"} · {r.items.map((i) => `${i.product_name} ${i.qty_issued ?? 0}${i.qty_received != null && i.qty_received !== i.qty_issued ? ` (received ${i.qty_received}: ${i.received_note ?? ""})` : ""}`).join(", ")}</p>)}
        </details>
      )}
    </div>
  );
}

/** Every movement of the store, searchable by vendor number / name, item, company and dates. */
export function StoreRegisterTab({ store }: { store: StoreId }) {
  const [f, setF] = useState({ from: `${localDate().slice(0, 7)}-01`, to: localDate(), vendor: "", product: "", company: "" });
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<RegisterSuggestions>({ vendors: [], products: [], companies: [] });
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ productId: string | null; productName: string } | null>(null);
  const id = useId();
  useEffect(() => {
    let active = true;
    setSuggestions({ vendors: [], products: [], companies: [] });
    void storeRegisterSuggestions(store).then((result) => {
      if (active) { setSuggestions(result); setSuggestionError(null); }
    }).catch((e: unknown) => { if (active) setSuggestionError(msg(e)); });
    return () => { active = false; };
  }, [store]);
  useEffect(() => { const t = setTimeout(() => void storeRegister(store, f).then((r) => { setRows(r); setError(null); }).catch((e) => setError(msg(e))), 250); return () => clearTimeout(t); }, [store, f]);
  return (
    <div className={card}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Vendor (name or no.)"><Input list={`${id}-vendors`} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="e.g. V-0003" /></Field>
        <Field label="Item"><Input list={`${id}-products`} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></Field>
        <Field label="Company"><Input list={`${id}-companies`} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
        <datalist id={`${id}-vendors`}>{suggestions.vendors.map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id={`${id}-products`}>{suggestions.products.map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id={`${id}-companies`}>{suggestions.companies.map((value) => <option key={value} value={value} />)}</datalist>
      </div>
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {suggestionError && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Could not load suggestions: {suggestionError}</p>}
      {rows.length === 0 ? <p className="mt-3 text-sm text-neutral-400">No entries.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 pr-3 font-medium">Date</th><th className="pb-1.5 pr-3 font-medium">Entry</th><th className="pb-1.5 pr-3 font-medium">Item</th><th className="pb-1.5 pr-3 font-medium">Vendor</th><th className="pb-1.5 pr-3 font-medium">Kind</th><th className="pb-1.5 pr-3 text-right font-medium">In</th><th className="pb-1.5 pr-3 text-right font-medium">Out</th><th className="pb-1.5 font-medium">By</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.date}</td><td className="py-1.5 pr-3 font-mono text-xs">{r.entry_no ?? "—"}</td>
                  <td className="py-1.5 pr-3"><button type="button" className="text-left text-sky-700 hover:underline" onClick={() => setHistory({ productId: r.product_id, productName: r.product_name })}>{r.product_name}</button>{r.company_name && <span className="block text-[11px] text-neutral-500">{r.company_name}</span>}</td>
                  <td className="py-1.5 pr-3">{r.vendor_name ?? "—"}{r.vendor_no && <span className="block font-mono text-[11px] text-neutral-500">{r.vendor_no}</span>}</td>
                  <td className="py-1.5 pr-3 text-xs">{KIND[r.kind]}{r.notes && <span className="block text-neutral-500">{r.notes}</span>}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-emerald-700">{r.qty > 0 ? r.qty : ""}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-rose-700">{r.qty < 0 ? -r.qty : ""}</td>
                  <td className="py-1.5 text-xs text-neutral-500">{r.by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history && <StockHistoryModal store={store} item={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

/** Items written off (broken, condemned by staff ...). */
export function DeadStockTab({ store }: { store: StoreId }) {
  const [rows, setRows] = useState<StoreMove[]>([]);
  const [stock, setStock] = useState<StoreStockRow[]>([]);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(DEAD_REASONS[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function reload() {
    try { const [r, s] = await Promise.all([deadStockRegister(store), storeStock(store)]); setRows(r); setStock(s.filter((x) => x.qty > 0)); setError(null); } catch (e) { setError(msg(e)); }
  }
  useEffect(() => { void reload(); }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add() {
    const s = stock.find((x) => `${x.product_id ?? x.product_name}` === item);
    if (!s) return;
    try { await recordDeadStock(store, { productId: s.product_id, productName: s.product_name, qty: Number(qty), reason, note }); setQty(""); setNote(""); await reload(); } catch (e) { setError(msg(e)); }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold">Write off an item</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Item"><Select value={item} onChange={(e) => setItem(e.target.value)}><option value="">— Choose —</option>{stock.map((s) => <option key={`${s.product_id ?? s.product_name}`} value={`${s.product_id ?? s.product_name}`}>{s.product_name} ({s.qty})</option>)}</Select></Field>
          <Field label="Quantity"><Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{DEAD_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Condemned by the IPC committee" /></Field>
          <Button variant="primary" disabled={!item || !(Number(qty) > 0)} onClick={() => void add()}>Record</Button>
        </div>
        {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold">Dead stock register</h3>
        {rows.length === 0 ? <p className="text-sm text-neutral-400">Nothing written off.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 pr-3 font-medium">Date</th><th className="pb-1.5 pr-3 font-medium">Item</th><th className="pb-1.5 pr-3 text-right font-medium">Qty</th><th className="pb-1.5 pr-3 text-right font-medium">Value (Rs)</th><th className="pb-1.5 pr-3 font-medium">Reason</th><th className="pb-1.5 font-medium">By</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3">{r.date}</td><td className="py-1.5 pr-3">{r.product_name}</td><td className="py-1.5 pr-3 text-right tabular-nums">{-r.qty}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{money(-r.qty * r.unit_cost)}</td><td className="py-1.5 pr-3 text-xs">{r.notes}</td><td className="py-1.5 text-xs text-neutral-500">{r.by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
