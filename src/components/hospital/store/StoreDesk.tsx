"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { storeLabel, type StoreId } from "@/config/hospitalStores";
import { myStores, returnStorePurchase, storeArrivals, storeStock, verifyStoreItems, type StoreArrival, type StoreStockRow } from "@/lib/repo/hospitalStores";
import { DeadStockTab, StoreDashboardTab, StoreIndentsTab, StoreRegisterTab } from "./StoreTabs";
import { FormError } from "@/components/ui/FormError";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const money = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Tab = "dashboard" | "arrivals" | "indents" | "stock" | "register" | "dead";

/** One store: what the Purchase Cell posted to it (verify or return), and its stock. */
export function StoreDesk({ store }: { store: StoreId }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [arrivals, setArrivals] = useState<StoreArrival[]>([]);
  const [stock, setStock] = useState<StoreStockRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      const mine = await myStores();
      setAllowed(mine.includes(store));
      if (!mine.includes(store)) return;
      const [a, s] = await Promise.all([storeArrivals(store), storeStock(store, search)]);
      setArrivals(a);
      setStock(s);
      setError(null);
    } catch (e) { setError(/no such (table|column)/i.test(msg(e)) ? "Stores need the database update (v103)." : msg(e)); }
  }
  useEffect(() => { void reload(); }, [store, search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (allowed === false) return <p className="p-6 text-sm text-rose-600">You do not work in the {storeLabel(store)}. Ask the administrator to give you this store.</p>;
  const pending = arrivals.reduce((n, a) => n + a.items.length, 0);
  return (
    <div>
      <PageHeader title={storeLabel(store)} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {([["dashboard", "Dashboard"], ["arrivals", `Arrivals${pending ? ` (${pending})` : ""}`], ["indents", "Indents"], ["stock", "Stock"], ["register", "Stock Register"], ["dead", "Dead Stock"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${tab === id ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}>{label}</button>
        ))}
      </div>
      <FormError message={error} className="mb-3" />
      {tab === "dashboard" ? <StoreDashboardTab store={store} onGo={setTab} />
      : tab === "indents" ? <StoreIndentsTab store={store} />
      : tab === "register" ? <StoreRegisterTab store={store} />
      : tab === "dead" ? <DeadStockTab store={store} />
      : tab === "arrivals" ? (
        arrivals.length === 0 ? <div className={card}><p className="text-sm text-neutral-400">Nothing waiting: purchases posted to this store appear here.</p></div>
          : <div className="flex flex-col gap-4">{arrivals.map((a) => <ArrivalCard key={a.purchase.id} store={store} a={a} onDone={() => void reload()} />)}</div>
      ) : (
        <div className={card}>
          <div className="mb-3 max-w-md"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find item or company" aria-label="Find item" /></div>
          {stock.length === 0 ? <p className="text-sm text-neutral-400">No stock yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1.5 pr-3 font-medium">Item</th><th className="pb-1.5 pr-3 font-medium">Company</th><th className="pb-1.5 pr-3 text-right font-medium">In stock</th><th className="pb-1.5 pr-3 text-right font-medium">Value (Rs)</th><th className="pb-1.5 pr-3 font-medium">Last received</th><th className="pb-1.5 font-medium">Last issued</th></tr></thead>
              <tbody>
                {stock.map((r) => (
                  <tr key={`${r.product_id ?? r.product_name}`} className="border-t border-neutral-100">
                    <td className="py-1.5 pr-3">{r.product_name}</td><td className="py-1.5 pr-3 text-neutral-600">{r.company_name ?? "—"}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums font-semibold ${r.qty <= 0 ? "text-rose-700" : ""}`}>{r.qty}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.value)}</td>
                    <td className="py-1.5 pr-3 text-xs">{r.last_in ?? "—"}</td><td className="py-1.5 text-xs">{r.last_out ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ArrivalCard({ store, a, onDone }: { store: StoreId; a: StoreArrival; onDone: () => void }) {
  const [received, setReceived] = useState<Record<string, string>>(() => Object.fromEntries(a.items.map((i) => [i.id, String(i.qty)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = a.purchase;
  async function verify() {
    setBusy(true);
    setError(null);
    try { await verifyStoreItems(p.id, store, Object.fromEntries(a.items.map((i) => [i.id, Number(received[i.id])]))); onDone(); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  async function giveBack() {
    const reason = window.prompt(`Return ${p.purchase_no} to the purchase officer. Reason:`);
    if (!reason?.trim()) return;
    setBusy(true);
    try { await returnStorePurchase(p.id, store, reason); onDone(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }
  return (
    <div className={card}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{p.purchase_no} <span className="font-normal text-neutral-500">· {p.vendor_name ?? "Vendor"} {p.vendor_no ? `(${p.vendor_no})` : ""}{p.vendor_invoice_no ? ` · Invoice ${p.vendor_invoice_no}` : ""} · {p.date}</span></p>
        <p className="text-xs text-neutral-500">Posted by {p.posted_by_name ?? "—"}</p>
      </div>
      {p.note && <p className="mb-2 whitespace-pre-line rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{p.note}</p>}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-neutral-500"><th className="pb-1 pr-3 font-medium">Item</th><th className="pb-1 pr-3 text-right font-medium">Ordered</th><th className="pb-1 pr-3 text-right font-medium">Received</th><th className="pb-1 text-right font-medium">Rate</th></tr></thead>
        <tbody>
          {a.items.map((i) => (
            <tr key={i.id} className="border-t border-neutral-100">
              <td className="py-1.5 pr-3">{i.product_name}{i.company_name && <span className="block text-[11px] text-neutral-500">{i.company_name}</span>}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{i.qty}</td>
              <td className="py-1.5 pr-3 text-right">
                <input type="number" min="0" max={i.qty} step="any" aria-label={`Received ${i.product_name}`} value={received[i.id] ?? ""}
                  onChange={(e) => setReceived({ ...received, [i.id]: e.target.value })}
                  className={`w-24 rounded-lg border px-2 py-0.5 text-right text-sm ${Number(received[i.id]) !== Number(i.qty) ? "border-amber-400 bg-amber-50" : "border-neutral-200"}`} />
              </td>
              <td className="py-1.5 text-right tabular-nums">{money(i.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <FormError message={error} className="mt-2" />
      <div className="mt-3 flex justify-end gap-2">
        <Button disabled={busy} onClick={() => void giveBack()}>Return to purchase officer</Button>
        <Button loading={busy} variant="primary" disabled={busy} onClick={() => void verify()}>{busy ? "Saving…" : "Verify and receive"}</Button>
      </div>
    </div>
  );
}
