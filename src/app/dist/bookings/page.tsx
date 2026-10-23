"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { dist, errorText, openMaps } from "@/lib/dist";
import { Badge, BOOKING_TONE, DistGuard, Err, Note, PageTitle, money, monthStart, todayYmd, useLoad, type DistCtx } from "@/components/dist/ui";
import { DocView } from "@/components/dist/DocView";

export default function BookingsPage() {
  return <DistGuard>{(c) => <Bookings c={c} />}</DistGuard>;
}

const STATUSES = ["", "draft", "pending_approval", "approved", "rejected", "converted", "cancelled"];

function Bookings({ c }: { c: DistCtx }) {
  const [status, setStatus] = useState("pending_approval");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayYmd);
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => dist.listBookings({ status: status || undefined, from, to }), [status, from, to]);
  return (
    <div className="space-y-3">
      <PageTitle title="Bookings" sub="Booking value is not a sale until it is invoiced." />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace("_", " ") : "All"}</option>)}
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Err error={list.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">No.</th>
              <th className="px-3 py-2 text-start">Date</th>
              <th className="px-3 py-2 text-start">Customer</th>
              <th className="px-3 py-2 text-start">Salesman</th>
              <th className="px-3 py-2 text-start">Company</th>
              <th className="px-3 py-2 text-end">Value</th>
              <th className="px-3 py-2 text-start">Status</th>
              <th className="px-3 py-2 text-start">Location</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((b) => (
              <tr key={b.id} className="cursor-pointer border-t border-neutral-100 hover:bg-amber-50/40" onClick={() => setOpen(b.id)}>
                <td className="px-3 py-2 font-medium">#{b.booking_no}</td>
                <td className="px-3 py-2 text-xs">{b.date}</td>
                <td className="px-3 py-2">{b.customer_name}</td>
                <td className="px-3 py-2 text-xs">{b.salesman_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{b.company_name ?? "—"}</td>
                <td className="px-3 py-2 text-end">{money(b.total)}</td>
                <td className="px-3 py-2"><Badge tone={BOOKING_TONE[b.status]}>{b.status.replace("_", " ")}</Badge></td>
                <td className="px-3 py-2 text-xs">{b.loc_lat != null ? `±${Math.round(b.loc_accuracy ?? 0)} m` : "—"}</td>
              </tr>
            ))}
            {!list.data?.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{list.loading ? "Loading…" : "No content in table"}</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <BookingModal c={c} id={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
    </div>
  );
}

function BookingModal({ c, id, onClose, onChanged }: { c: DistCtx; id: string; onClose: () => void; onChanged: () => void }) {
  const data = useLoad(() => dist.getBooking(id), [id]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [convert, setConvert] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await data.reload();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };
  const b = data.data?.booking;
  return (
    <Modal title={b ? `Booking #${b.booking_no}` : "Booking"} onClose={onClose} width="max-w-3xl">
      <Err error={data.error} />
      {b && data.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={BOOKING_TONE[b.status]}>{b.status.replace("_", " ")}</Badge>
            <span>{b.date}</span>
            {b.loc_lat != null && (
              <button type="button" className="text-xs text-sky-700 underline" onClick={() => void openMaps(b.loc_lat!, b.loc_lng!)}>
                Booked at {b.loc_lat.toFixed(5)}, {b.loc_lng!.toFixed(5)} (±{Math.round(b.loc_accuracy ?? 0)} m, {b.loc_recorded_at?.slice(0, 19).replace("T", " ")} UTC)
              </button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500">
              <tr><th className="text-start">Product</th><th className="text-end">Qty</th><th className="text-end">Price</th><th className="text-end">Disc.</th><th className="text-end">ST</th><th className="text-end">Total</th></tr>
            </thead>
            <tbody>
              {data.data.items.map((i) => (
                <tr key={i.id} className="border-t border-neutral-100">
                  <td>{i.name} <span className="text-[11px] text-neutral-400">{i.code}</span></td>
                  <td className="text-end">{i.qty} {i.unit}</td>
                  <td className="text-end">{money(i.price)}</td>
                  <td className="text-end">{money(i.discount)}</td>
                  <td className="text-end">{money(i.sales_tax)}</td>
                  <td className="text-end font-medium">{money(i.line_total)}</td>
                </tr>
              ))}
              <tr className="border-t border-neutral-300 font-semibold"><td colSpan={5}>Booking value</td><td className="text-end">{money(b.total)}</td></tr>
            </tbody>
          </table>
          {b.notes && <Note>{b.notes}</Note>}
          <ul className="text-xs text-neutral-500">
            {data.data.events.map((e) => <li key={e.id}>{e.created_at.slice(0, 16).replace("T", " ")} · {e.from_status ?? "—"} → <b>{e.to_status}</b> · {e.user_name}{e.note ? ` · ${e.note}` : ""}</li>)}
          </ul>
          <Field label="Note / reason"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            {c.can("bookings.approve") && ["submitted", "pending_approval"].includes(b.status) && (
              <>
                <Button variant="primary" onClick={() => void run(() => dist.decideBooking(id, "approved", note), "Approved.")}>Approve</Button>
                <Button variant="danger" onClick={() => void run(() => dist.decideBooking(id, "rejected", note), "Rejected.")}>Reject</Button>
              </>
            )}
            {b.status === "approved" && c.can("invoices.create") && <Button variant="primary" onClick={() => setConvert(true)}>Convert to invoice</Button>}
            {["draft", "submitted", "pending_approval", "approved"].includes(b.status) && <Button onClick={() => void run(() => dist.cancelBooking(id, note), "Cancelled.")}>Cancel booking</Button>}
          </div>
          {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
          {convert && <ConvertModal c={c} bookingId={id} customerId={b.customer_id} items={data.data.items} onClose={() => setConvert(false)} onDone={() => { setConvert(false); void data.reload(); onChanged(); }} />}
        </div>
      )}
    </Modal>
  );
}

/** Conversion with withholding-tax preview (calculated by the data layer). */
function ConvertModal({ c, bookingId, customerId, items, onClose, onDone }: { c: DistCtx; bookingId: string; customerId: string; items: { product_id: string; qty: number; price: number; discount: number }[]; onClose: () => void; onDone: () => void }) {
  const lines = items.map((i) => ({ productId: i.product_id, qty: i.qty, price: i.price, discount: i.discount }));
  const preview = useLoad(() => dist.previewWht(customerId, lines), [customerId]);
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [rate, setRate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  if (doc) return <DocView id={doc} onClose={onDone} />;
  const t = preview.data?.treatment;
  return (
    <Modal title="Convert booking to invoice" onClose={onClose} width="max-w-lg">
      <div className="space-y-3 text-sm">
        <Err error={preview.error} />
        {preview.data && t && (
          <div className="space-y-1 rounded-xl bg-neutral-50 p-3">
            <p>Goods total (incl. sales tax): <b>{money(preview.data.goods)}</b></p>
            <p>Withholding {t.section}: status <b>{t.status}</b> → {t.rate}% on {money(preview.data.base)} = <b>{money(preview.data.amount)}</b></p>
            <p className="text-xs text-neutral-500">{t.note}</p>
            {t.blocked && <Err error={t.blocked} />}
            <p className="text-base">Payable: <b>{money(preview.data.payable)}</b></p>
          </div>
        )}
        {c.can("invoices.edit_wht_rate") && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Override WHT rate % (optional)"><Input type="number" step="any" min="0" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field label="Reason (required to override)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        )}
        {c.can("payments.receive") && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Received now"><Input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
          </div>
        )}
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              try {
                const r = await dist.convertBooking(bookingId, { payments: Number(paid) > 0 ? [{ method, amount: Number(paid) }] : [], wht: rate !== "" ? { rate: Number(rate), reason } : undefined });
                setDoc(r.doc.id);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Create invoice
          </Button>
        </div>
      </div>
    </Modal>
  );
}
