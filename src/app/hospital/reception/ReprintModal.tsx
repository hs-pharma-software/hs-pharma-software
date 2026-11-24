"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Field";
import { recentReceiptsFor, type RecentReceiptRow } from "@/lib/repo/receptionFees";

const rs = (n: number) => Number(n).toLocaleString("en-PK", { maximumFractionDigits: 0 });

export function ReprintModal({ onClose, onSelect }: { onClose: () => void; onSelect: (episodeId: string) => void }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<RecentReceiptRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void recentReceiptsFor(search).then((result) => {
        if (active) { setRows(result); setError(null); }
      }).catch((e: unknown) => {
        if (active) { setRows([]); setError(`Could not load recent receipts: ${e instanceof Error ? e.message : String(e)}`); }
      }).finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search]);

  return (
    <Modal title="Reprint recent receipt" onClose={onClose} width="max-w-4xl">
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, mobile, MR or receipt number…" aria-label="Search receipts" autoFocus />
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-xl ring-1 ring-black/[0.06]">
        {loading ? <p className="p-4 text-sm text-neutral-400">Loading receipts…</p> : !error && rows.length === 0 ? <p className="p-4 text-sm text-neutral-400">No recent receipts found.</p> : rows.map((r) => (
          <button key={r.episodeId} type="button" onClick={() => onSelect(r.episodeId)}
            className="block w-full border-b border-neutral-100 px-3 py-2 text-left last:border-0 hover:bg-neutral-50">
            <span className="font-medium">{r.patientName}</span>
            <span className="block text-xs text-neutral-500">{r.mrNo ?? "No MR"} · {r.phone ?? "No mobile"} · {r.episodeNo}</span>
            <span className="mt-1 block text-xs">Paid <b className="text-emerald-700">Rs {rs(r.paid)}</b>{r.due > 0 ? <> · Balance <b className="text-rose-700">Rs {rs(r.due)}</b></> : null} · {r.receivedAt?.replace("T", " ").slice(0, 16) ?? r.date} <Printer size={12} className="ml-1 inline" /></span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
