"use client";

import { useCallback, useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { decideReview, listReviews, type ReviewRow } from "@/lib/repo/catalogPrices";

const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const rate = (n: number) => n.toLocaleString("en-PK", { maximumFractionDigits: 2 });
const when = (s: string) => new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

const change = (r: ReviewRow) =>
  r.kind === "packing" ? `Pack size ${r.oldPacking} → ${r.newPacking}` : `Retail price Rs ${rate(r.oldPrice)} → Rs ${rate(r.newPrice)}`;

/** Super Admin > Price & Packing Reviews: lower retail prices and new pack sizes
 * that businesses reported for shared catalogue products. */
export default function PriceReviewsPage() {
  const [view, setView] = useState<"pending" | "decided">("pending");
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ row: ReviewRow; approve: boolean } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      setRows(await listReviews(view));
    } catch (e) {
      setRows([]);
      setError(/no such table/i.test(msg(e)) ? "Price & Packing Reviews needs the database update (v114)." : msg(e));
    }
  }, [view]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Price & Packing Reviews" />
      <div className="flex gap-2">
        {(["pending", "decided"] as const).map((v) => (
          <Button key={v} type="button" variant={view === v ? "primary" : "secondary"} onClick={() => setView(v)}>{v === "pending" ? "Waiting" : "Decided"}</Button>
        ))}
      </div>
      <FormError message={error} />
      {rows === null ? <p className="py-8 text-center text-sm text-neutral-400">Loading…</p>
        : rows.length === 0 ? <p className={`${card} text-center text-sm text-neutral-500`}>{view === "pending" ? "Nothing is waiting for your decision." : "Nothing decided yet."}</p>
          : rows.map((r) => (
            <div key={r.id} className={`${card} flex flex-wrap items-start gap-x-6 gap-y-3 text-sm`}>
              <div className="min-w-[14rem] flex-1">
                <p className="break-words font-semibold text-neutral-900">{r.productName}</p>
                <p className="mt-0.5 font-medium text-rose-700">{change(r)}</p>
                <p className="text-xs text-neutral-500">
                  {r.catalog === "general_store" ? "General store catalogue" : "Pharmacy catalogue"} · pack size now {r.currentPacking}
                  {r.usualPrice != null ? ` · usual price Rs ${rate(r.usualPrice)}` : ""} · {r.stockHolders} business{r.stockHolders === 1 ? "" : "es"} hold stock
                </p>
                {r.note && <p className="mt-1 break-words text-xs text-neutral-600">Note: {r.note}</p>}
              </div>
              <div className="min-w-[12rem]">
                <p className="font-medium text-neutral-900">{r.businessName}</p>
                {r.ownerName && <p className="text-xs text-neutral-500">{r.ownerName}</p>}
                {r.mobile
                  ? <a href={`tel:${r.mobile}`} className="mt-0.5 inline-flex items-center gap-1 text-sky-700 hover:underline"><Phone size={13} />{r.mobile}</a>
                  : <p className="text-xs text-amber-700">No mobile number saved</p>}
                <p className="text-xs text-neutral-400">{when(r.createdAt)}</p>
              </div>
              {view === "pending" ? (
                <div className="flex gap-2">
                  <Button type="button" variant="primary" onClick={() => setDeciding({ row: r, approve: true })}>Approve…</Button>
                  <Button type="button" onClick={() => setDeciding({ row: r, approve: false })}>Reject…</Button>
                </div>
              ) : (
                <p className={`text-xs font-semibold ${r.status === "approved" ? "text-emerald-700" : "text-neutral-500"}`}>
                  {r.status === "approved" ? "Approved" : "Rejected"}{r.decidedAt ? ` · ${when(r.decidedAt)}` : ""}
                </p>
              )}
            </div>
          ))}
      {deciding && <DecideModal {...deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); void load(); }} />}
    </div>
  );
}

function DecideModal({ row, approve, onClose, onDone }: { row: ReviewRow; approve: boolean; onClose: () => void; onDone: () => void }) {
  const packing = row.kind === "packing";
  const [salePrice, setSalePrice] = useState(packing ? "" : String(row.newPrice));
  const [mrp, setMrp] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await decideReview({ id: row.id, approve, note, ...(approve ? { salePrice, mrp } : {}) });
      notify(approve ? "Approved. Businesses of this catalogue will see it on their dashboard." : "Rejected.", "success");
      onDone();
    } catch (err) {
      setError(msg(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={approve ? "Approve change" : "Reject change"} onClose={onClose} width="max-w-lg">
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <p className="font-semibold text-neutral-900">{row.productName}</p>
        <p className="text-neutral-700">{change(row)} · reported by {row.businessName}</p>
        {approve && packing && (
          <p className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
            Approve only if <b>the company changed the pack size</b>. Every business&apos;s stock, bills and purchases of this product are converted to packs of {row.newPacking}:
            the number of tablets and all money totals stay the same, and prices per pack change in proportion. This cannot be undone.
            If the pack size was simply entered wrong, reject this and correct the product itself instead (pack counts then stay as they are).
          </p>
        )}
        {approve && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={packing ? `New retail price per pack of ${row.newPacking}` : "Retail price"}>
              <Input type="number" min="0" step="any" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder={packing ? "optional" : undefined} required={!packing} />
            </Field>
            <Field label="MRP"><Input type="number" min="0" step="any" value={mrp} onChange={(e) => setMrp(e.target.value)} placeholder="optional" /></Field>
          </div>
        )}
        {approve && <p className="text-xs text-neutral-500">Each business is asked to apply the retail price; nobody&apos;s price changes by itself{packing ? " beyond the conversion to the new pack" : ""}.</p>}
        <Field label="Note (kept with the decision)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy}>{approve ? (packing ? "Convert and approve" : "Approve") : "Reject"}</Button>
        </div>
      </form>
    </Modal>
  );
}
