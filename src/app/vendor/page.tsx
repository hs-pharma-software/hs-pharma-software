"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { declineRequest, errText, pkr, portalRequests, sendQuote, type PortalRequest } from "@/lib/vendorPortalClient";
import { KIND_CLS } from "@/components/vendor/portal";

const MY_STATUS: Record<PortalRequest["myStatus"], { label: string; cls: string }> = {
  requested: { label: "Rates wanted", cls: "bg-amber-100 text-amber-800" },
  quoted: { label: "Rates sent", cls: "bg-sky-100 text-sky-800" },
  declined: { label: "Declined", cls: "bg-neutral-100 text-neutral-500" },
  awarded: { label: "Order received", cls: "bg-emerald-100 text-emerald-800" },
  not_awarded: { label: "Not selected", cls: "bg-neutral-100 text-neutral-500" },
};

/** Vendor portal > Quote Requests: the hospital's requests for rates sent to this vendor. */
export default function VendorRequestsPage() {
  const [rows, setRows] = useState<PortalRequest[] | null>(null);
  const [show, setShow] = useState<"open" | "all">("open");
  const [opened, setOpened] = useState<PortalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await portalRequests()); setError(null); } catch (e) { setRows([]); setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const list = (rows ?? []).filter((r) => show === "all" || r.canQuote);
  return (
    <div>
      <PageHeader title="Quote Requests" />
      <p className="mb-3 text-sm text-neutral-600">The hospital&apos;s purchase officer asks you for rates here. Quote a rate for each item before the last date; other vendors never see your rates.</p>
      <div role="tablist" aria-label="Show" className="mb-3 inline-flex rounded-xl bg-neutral-200/70 p-1 text-sm">
        {(["open", "all"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={show === k} onClick={() => setShow(k)}
            className={`min-h-9 rounded-lg px-4 font-medium transition-colors ${show === k ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>
            {k === "open" ? "Waiting for my rates" : "All requests"}
          </button>
        ))}
      </div>
      <FormError message={error} className="mb-3" />
      {rows === null ? (
        <div className="grid gap-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-white" />)}</div>
      ) : list.length === 0 ? (
        <p className="fade-in rounded-2xl bg-white p-8 text-center text-sm text-neutral-500 ring-1 ring-black/[0.04]">{show === "open" ? "No request is waiting for your rates." : "No requests yet."}</p>
      ) : (
        <ul className="grid gap-3">
          {list.map((r, i) => (
            <li key={r.id} className="row-in" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button type="button" onClick={() => setOpened(r)}
                className="w-full rounded-2xl bg-white p-4 text-left shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.08)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{r.rfqNo}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_CLS[r.kind]}`}>{r.kindLabel}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MY_STATUS[r.myStatus].cls}`}>{r.status === "cancelled" ? "Cancelled by the hospital" : MY_STATUS[r.myStatus].label}</span>
                  <span className="ml-auto text-xs text-neutral-500">{r.date}{r.dueDate ? ` · rates by ${r.dueDate}` : ""}</span>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-neutral-900">{r.hospitalName}{r.title ? <span className="font-medium text-neutral-700"> · {r.title}</span> : null}</p>
                <p className="mt-1 text-sm text-neutral-600">{r.items.slice(0, 4).map((it) => `${it.productName} × ${it.qty}${it.uom ? ` ${it.uom}` : ""}`).join(" · ")}{r.items.length > 4 ? ` · +${r.items.length - 4} more` : ""}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {opened && <QuoteModal request={opened} onClose={() => setOpened(null)} onDone={(m) => { setOpened(null); notify(m, "success"); void load(); }} />}
    </div>
  );
}

interface Line { itemId: string; rate: string; offeredSpec: string; available: boolean }

function QuoteModal({ request: r, onClose, onDone }: { request: PortalRequest; onClose: () => void; onDone: (message: string) => void }) {
  const [lines, setLines] = useState<Line[]>(() => r.items.map((i) => ({ itemId: i.id, rate: i.rate == null ? "" : String(i.rate), offeredSpec: i.offeredSpec ?? "", available: i.available })));
  const [days, setDays] = useState(r.deliveryDays == null ? "" : String(r.deliveryDays));
  const [validTill, setValidTill] = useState(r.validTill ?? "");
  const [remarks, setRemarks] = useState(r.remarks ?? "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<"send" | "decline" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const bad = (l: Line) => l.available && !(Number(l.rate) > 0);
  const total = r.items.reduce((s, it, i) => s + (lines[i].available ? (Number(lines[i].rate) || 0) * it.qty : 0), 0);
  const readOnly = !r.canQuote;

  async function send() {
    setTried(true);
    const first = lines.findIndex(bad);
    if (first >= 0) { document.getElementById(`q-rate-${first}`)?.focus(); return; }
    if (!lines.some((l) => l.available)) { setError("Quote at least one item, or decline the request."); return; }
    setBusy("send");
    setError(null);
    try {
      await sendQuote({
        rfqId: r.id, lines: lines.map((l) => ({ itemId: l.itemId, rate: l.available ? Number(l.rate) : null, offeredSpec: l.offeredSpec.trim() || null, available: l.available })),
        deliveryDays: days.trim() === "" ? null : Number(days), validTill: validTill || null, remarks: remarks.trim() || null,
      });
      onDone(`Your rates for ${r.rfqNo} were sent to the hospital.`);
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  }

  async function decline() {
    setBusy("decline");
    setError(null);
    try { await declineRequest(r.id, reason); onDone(`You declined ${r.rfqNo}.`); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  }

  return (
    <Modal title={`${r.rfqNo} · ${r.kindLabel}`} onClose={onClose} width="max-w-4xl">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600">
        <span className="font-semibold text-neutral-900">{r.hospitalName}</span>
        <span>Sent {r.date}</span>
        {r.dueDate && <span className="font-medium text-amber-800">Last date for rates: {r.dueDate}</span>}
        {r.kind === "petty" ? <span>Only you were asked (petty purchase).</span> : <span>Several vendors were asked (quotation).</span>}
      </div>
      {r.title && <p className="mb-1 font-medium">{r.title}</p>}
      {r.note && <p className="mb-3 whitespace-pre-line rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700 ring-1 ring-black/[0.04]">{r.note}</p>}
      {readOnly && (
        <p role="status" className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200">
          {r.status === "cancelled" ? "The hospital cancelled this request." : r.myStatus === "declined" ? "You declined this request." : r.status !== "open" ? "This request is closed." : "The last date for rates has passed."}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {r.items.map((it, i) => {
          const l = lines[i];
          return (
            <li key={it.id} className="rounded-xl bg-neutral-50 p-3 ring-1 ring-black/[0.04]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{it.productName}</p>
                <p className="text-sm tabular-nums text-neutral-700">Qty <b>{it.qty}</b>{it.uom ? ` ${it.uom}` : ""}</p>
              </div>
              {it.specification && <p className="mt-0.5 whitespace-pre-line text-sm text-neutral-600"><span className="font-medium text-neutral-500">Specification: </span>{it.specification}</p>}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-start">
                <Field label={`Your rate per ${it.uom || "unit"} (Rs)`} error={tried && bad(l) ? "Enter your rate" : undefined}>
                  <Input id={`q-rate-${i}`} type="number" inputMode="decimal" min="0" step="any" value={l.rate} disabled={readOnly || !l.available} aria-invalid={(tried && bad(l)) || undefined}
                    onChange={(e) => set(i, { rate: e.target.value })} />
                </Field>
                <Field label="Your brand / specification (optional)">
                  <Input value={l.offeredSpec} disabled={readOnly || !l.available} onChange={(e) => set(i, { offeredSpec: e.target.value })} placeholder="e.g. Brand, model, pack size" />
                </Field>
                <label className="flex min-h-10 items-center gap-2 pt-5 text-sm text-neutral-700">
                  <input type="checkbox" checked={!l.available} disabled={readOnly} onChange={(e) => set(i, { available: !e.target.checked })} className="h-4 w-4" />
                  Not available
                </label>
              </div>
              {l.available && Number(l.rate) > 0 && <p className="mt-1 text-right text-xs tabular-nums text-neutral-500">Amount {pkr(Number(l.rate) * it.qty)}</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Delivery in (days)"><Input type="number" inputMode="numeric" min="0" max="365" value={days} disabled={readOnly} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Rates valid till"><Input type="date" value={validTill} disabled={readOnly} onChange={(e) => setValidTill(e.target.value)} /></Field>
        <div className="flex items-end justify-end text-right"><p className="text-sm text-neutral-600">Total<span className="block text-lg font-bold tabular-nums text-neutral-900">{pkr(total)}</span></p></div>
      </div>
      <div className="mt-3"><Field label="Remarks for the hospital"><Textarea rows={2} value={remarks} disabled={readOnly} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Rates include delivery; GST extra" /></Field></div>
      {declining && !readOnly && (
        <div className="fade-in mt-3 rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
          <Field label="Why can you not supply? (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => setDeclining(false)}>Back</Button>
            <Button variant="primary" loading={busy === "decline"} disabled={busy !== null} onClick={() => void decline()}>Decline the request</Button>
          </div>
        </div>
      )}
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Close</Button>
        {!readOnly && !declining && <Button onClick={() => setDeclining(true)} disabled={busy !== null}>Decline</Button>}
        {!readOnly && <Button variant="primary" loading={busy === "send"} disabled={busy !== null} onClick={() => void send()}>{r.myStatus === "quoted" ? "Send new rates" : "Send rates"}</Button>}
      </div>
    </Modal>
  );
}
