"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { storeLabel, type StoreId } from "@/config/hospitalStores";
import { printDirect } from "@/lib/print";
import { storeItemHistory, type StockHistoryRow } from "@/lib/repo/hospitalStores";

const kinds: Record<StockHistoryRow["kind"], string> = {
  receipt: "Arrival", issue: "Issue", return_in: "Return in", return_out: "Return out", dead: "Dead stock", adjust: "Adjustment",
};

export function StockHistoryModal({ store, item, onClose }: {
  store: StoreId;
  item: { productId: string | null; productName: string };
  onClose: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<StockHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void storeItemHistory(store, item, { from, to }).then((result) => {
      if (active) setRows(result);
    }).catch((e: unknown) => {
      if (active) { setRows([]); setError(e instanceof Error ? e.message : String(e)); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store, item, from, to]);

  async function print() {
    try { await printDirect("a4", area.current); }
    catch (e) { setError(`Could not print: ${e instanceof Error ? e.message : String(e)}`); }
  }

  return (
    <Modal title={`Stock history · ${item.productName}`} onClose={onClose} width="max-w-5xl">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button onClick={() => void print()} disabled={loading || Boolean(error)}><Printer size={14} className="mr-1" />Print A4</Button>
      </div>
      {error && <p role="alert" className="mb-2 text-sm text-rose-700">{error}</p>}
      {loading ? <p className="text-sm text-neutral-500">Loading history…</p> : !error && (
        <div ref={area} className="print-area">
          <h3 className="font-semibold">{storeLabel(store)} · {item.productName}</h3>
          <p className="text-xs text-neutral-500">{from || "Beginning"} to {to || "present"}</p>
          <p className="mt-1 text-xs text-neutral-500">Recorded movements are shown in date order. Existing issues are unallocated because their source arrivals were not recorded.</p>
          {rows.length === 0 ? <p className="mt-3 text-sm text-neutral-500">No movements in this period.</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="text-xs text-neutral-500"><th className="pr-3">Date</th><th className="pr-3">Movement</th><th className="pr-3">Details</th><th className="pr-3 text-right">In</th><th className="text-right">Out</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{r.date}</td>
                    <td className="py-2 pr-3">{kinds[r.kind]}{r.entry_no && <span className="block text-xs text-neutral-500">{r.entry_no}</span>}</td>
                    <td className="py-2 pr-3 text-xs">
                      {r.kind === "receipt" && <><span>Vendor: {r.vendor_name ?? "Not recorded"}{r.vendor_no ? ` (${r.vendor_no})` : ""}</span><span className="block">Received by: {r.by_name ?? "Not recorded"}</span></>}
                      {r.kind === "issue" && <><span>Indent: {r.indent_no ?? r.entry_no ?? "Not recorded"}</span><span className="block">Department: {r.department ?? "Not recorded"}</span><span className="block">Requested by: {r.requested_by_name ?? "Not recorded"}</span><span className="block">Receipt: {r.received_at ? `Confirmed ${r.received_at.slice(0, 10)} by ${r.received_by_name ?? "Not recorded"}` : "Not confirmed"}</span></>}
                      {r.kind !== "receipt" && r.kind !== "issue" && <span>{r.notes ?? "—"}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.qty > 0 ? r.qty : ""}</td>
                    <td className="py-2 text-right tabular-nums">{r.qty < 0 ? -r.qty : ""}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
