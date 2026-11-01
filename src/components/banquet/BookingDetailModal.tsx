"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Pencil, Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ServiceBillModal } from "@/components/print/ServiceBillModal";
import { addBookingPayment, bookingBillLines, cancelBooking, completeBooking, getBooking, slotLabel, type BookingDetail } from "@/lib/repo/banquet";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const STATUS_CLS: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-800", tentative: "bg-amber-100 text-amber-800", completed: "bg-neutral-200 text-neutral-700", cancelled: "bg-rose-100 text-rose-700",
};

/** One booking: the event, menu, extras and payments; receive a payment,
 * print the bill, change, complete or cancel it. */
export function BookingDetailModal({ bookingId, onClose, onChanged }: { bookingId: string; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<BookingDetail | null>(null);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setD(await getBooking(bookingId));
  }
  useEffect(() => { void reload().catch((e) => { window.alert(e instanceof Error ? e.message : String(e)); onClose(); }); }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <Modal title="Booking" onClose={onClose} width="max-w-3xl"><p className="p-6 text-sm text-neutral-400">Loading…</p></Modal>;
  const b = d.booking;
  const due = Math.max(0, b.total - b.paid);
  const live = b.status !== "cancelled";
  return (
    <Modal title={`Booking ${b.booking_no}`} onClose={onClose} width="max-w-3xl">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold text-neutral-900">{b.customer_name}</p>
            <p className="text-neutral-600">{[b.mobile, b.cnic, b.address].filter(Boolean).join(" · ")}</p>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_CLS[b.status] ?? ""}`}>{b.status}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-neutral-50 p-3 md:grid-cols-3">
          <p><span className="text-neutral-500">Event: </span>{b.event_type}</p>
          <p><span className="text-neutral-500">Date: </span>{b.event_date} ({slotLabel(b.slot)}){b.start_time ? ` ${b.start_time}–${b.end_time ?? ""}` : ""}</p>
          <p><span className="text-neutral-500">Hall: </span>{d.hall?.name ?? "—"}</p>
          <p><span className="text-neutral-500">Guests: </span>{b.guests}</p>
          <p><span className="text-neutral-500">Menu: </span>{d.pkg?.name ?? "Custom"} · Rs {money(b.per_head_rate)} per head</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Dishes</p>
            <p className="text-neutral-800">{d.dishes.map((x) => x.name).join(", ") || "—"}</p>
            {d.extras.length > 0 && <>
              <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Extras</p>
              {d.extras.map((e) => <p key={e.id} className="flex justify-between"><span>{e.name}{e.qty !== 1 ? ` × ${e.qty}` : ""}</span><span className="tabular-nums">{money(e.amount)}</span></p>)}
            </>}
            {b.notes && <p className="mt-3 whitespace-pre-line text-neutral-600">{b.notes}</p>}
          </div>
          <div>
            <dl className="flex flex-col gap-1">
              <div className="flex justify-between"><dt>Menu ({b.guests} × {money(b.per_head_rate)})</dt><dd className="tabular-nums">{money(b.guests * b.per_head_rate)}</dd></div>
              <div className="flex justify-between"><dt>Hall rent</dt><dd className="tabular-nums">{money(b.hall_rent)}</dd></div>
              <div className="flex justify-between"><dt>Extras</dt><dd className="tabular-nums">{money(b.extras_amount)}</dd></div>
              {b.discount > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">-{money(b.discount)}</dd></div>}
              <div className="flex justify-between border-t border-neutral-200 pt-1 font-bold"><dt>Total</dt><dd className="tabular-nums">{money(b.total)}</dd></div>
              <div className="flex justify-between"><dt>Received</dt><dd className="tabular-nums">{money(b.paid)}</dd></div>
              <div className={`flex justify-between font-semibold ${due > 0 ? "text-rose-700" : "text-emerald-700"}`}><dt>Due</dt><dd className="tabular-nums">{money(due)}</dd></div>
            </dl>
            {d.payments.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Payments</p>
                {d.payments.map((p) => <p key={p.id} className="flex justify-between text-xs"><span>{p.date} · {p.method}{p.note ? ` · ${p.note}` : ""}</span><span className="tabular-nums">{money(p.amount)}</span></p>)}
              </div>
            )}
          </div>
        </div>
        {paying && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
            <div className="w-36"><Field label="Amount"><Input id="bd-amount" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field></div>
            <div className="w-36"><Field label="Paid by"><Select id="bd-method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="cheque">Cheque</option><option value="digital">Digital</option></Select></Field></div>
            <Button onClick={() => setPaying(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !(Number(amount) > 0)} onClick={() => void run(async () => { await addBookingPayment(b.id, Number(amount), method); setPaying(false); })}>Receive</Button>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3">
          {live && b.status !== "completed" && <Button variant="ghost" disabled={busy} onClick={() => { const why = window.prompt("Why is this booking cancelled?"); if (why) void run(() => cancelBooking(b.id, why)); }}>Cancel booking</Button>}
          {live && b.status !== "completed" && <Button variant="ghost" disabled={busy} onClick={() => void run(() => completeBooking(b.id))}>Mark held</Button>}
          {live && <Button onClick={() => router.push(`/banquet/bookings/new?id=${b.id}`)}><Pencil size={14} />Change</Button>}
          {live && due > 0 && <Button onClick={() => { setAmount(String(due)); setPaying(true); }}><HandCoins size={14} />Receive payment</Button>}
          {b.invoice_id && <Button variant="primary" onClick={() => setPrinting(true)}><Printer size={14} />Bill</Button>}
        </div>
      </div>
      {printing && b.invoice_id && (
        <ServiceBillModal invoiceId={b.invoice_id} lines={bookingBillLines(d)} title="Booking Bill" note={d.dishes.length ? `Menu: ${d.dishes.map((x) => x.name).join(", ")}` : null} onClose={() => setPrinting(false)} />
      )}
    </Modal>
  );
}
