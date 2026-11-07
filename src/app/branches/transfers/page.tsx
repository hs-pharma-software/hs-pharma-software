"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { SERVER_DB } from "@/lib/serverMode";
import { branchApi, money, useBranchStore, type Branch } from "@/lib/branchClient";

interface Transfer {
  id: string; no: number; fromBranchId: string; toBranchId: string; fromName: string; toName: string; status: string; note: string | null; receiptNote: string | null;
  lines: number; value: number; createdBy: string | null; receivedBy: string | null; dispatchedAt: string; receivedAt: string | null; canReceive: boolean; canCancel: boolean;
}
interface Item { id: string; name: string; batchNo: string | null; expiry: string | null; qty: number; receivedQty: number | null; purchasePrice: number; note: string | null }
interface BatchRow { batchId: string; name: string; batchNo: string | null; expiry: string | null; qty: number; purchasePrice: number }

const STATUS: Record<string, [string, string]> = {
  in_transit: ["In transit", "bg-sky-100 text-sky-800"],
  received: ["Received", "bg-emerald-100 text-emerald-800"],
  received_short: ["Received short", "bg-amber-100 text-amber-900"],
  cancelled: ["Cancelled", "bg-neutral-200 text-neutral-700"],
};
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "—");

function TransfersInner() {
  const { ctx, load } = useBranchStore();
  const [rows, setRows] = useState<Transfer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      await load();
      setRows(await branchApi<Transfer[]>("transfers"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load]);
  useEffect(() => { if (SERVER_DB) void refresh(); }, [refresh]);
  if (!SERVER_DB) return <p className="text-sm text-neutral-600">Stock transfers are in the web version (app.mavin.pk).</p>;
  const canSend = Boolean(ctx && ctx.managed.length && ctx.branches.filter((b) => b.status === "active").length > 1);

  return (
    <div className="space-y-4">
      <PageHeader title="Stock Transfers" actions={<>
        <Link href="/branches/reports" className="rounded-full px-3 py-1.5 text-sm font-medium text-[var(--accent)] hover:underline">Branch reports</Link>
        <Button variant="primary" disabled={!canSend} onClick={() => setCreating(true)}>Send Stock</Button>
      </>} />
      <p className="text-sm text-neutral-600">Stock leaves the sending branch when it is sent and joins the receiving branch&apos;s stock when received (same batch, expiry and cost). A transfer is not a sale or a purchase. Cancelling before receipt returns the stock.</p>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr><th className="px-3 py-2">No.</th><th className="px-3 py-2">From → To</th><th className="px-3 py-2">Lines</th><th className="px-3 py-2 text-right">Value (cost)</th><th className="px-3 py-2">Sent</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100">
                <td className="px-3 py-2 tabular-nums">TR-{t.no}</td>
                <td className="px-3 py-2">{t.fromName} → {t.toName}</td>
                <td className="px-3 py-2 tabular-nums">{t.lines}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(t.value)}</td>
                <td className="px-3 py-2 text-neutral-600">{when(t.dispatchedAt)}<span className="block text-xs text-neutral-400">{t.createdBy ?? ""}</span></td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[t.status]?.[1] ?? ""}`}>{STATUS[t.status]?.[0] ?? t.status}</span></td>
                <td className="px-3 py-2 text-right"><button type="button" className="text-[var(--accent)] hover:underline" onClick={() => setOpen(t.id)}>{t.canReceive ? "Receive" : "View"}</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-500">No transfers yet. Use Send Stock to move stock between branches.</td></tr>}
          </tbody>
        </table>
      </div>
      {creating && ctx && <NewTransfer branches={ctx.branches} managed={ctx.managed} active={ctx.active} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refresh(); }} />}
      {open && <TransferView id={open} onClose={() => setOpen(null)} onChanged={async () => { setOpen(null); await refresh(); }} />}
    </div>
  );
}

export default function TransfersPage() {
  return <Suspense><TransfersInner /></Suspense>;
}

function NewTransfer({ branches, managed, active, onClose, onSaved }: { branches: Branch[]; managed: string[]; active: string | null; onClose: () => void; onSaved: () => void }) {
  const open = branches.filter((b) => b.status === "active");
  const sources = open.filter((b) => managed.includes(b.id));
  const [from, setFrom] = useState(sources.find((b) => b.id === active)?.id ?? sources[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<BatchRow[]>([]);
  const [lines, setLines] = useState<(BatchRow & { send: string })[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One key per form: a double click or a retried request sends the stock once.
  const key = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (!from) return;
    const h = setTimeout(() => {
      branchApi<BatchRow[]>("batches", { branchId: from, q }).then(setFound).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => clearTimeout(h);
  }, [from, q]);

  function add(b: BatchRow) {
    if (lines.some((l) => l.batchId === b.batchId)) return;
    setLines([...lines, { ...b, send: "1" }]);
  }
  async function send() {
    setError(null);
    if (!to) return setError("Choose the receiving branch.");
    const bad = lines.find((l) => !(Number(l.send) > 0) || Number(l.send) > l.qty);
    if (bad) return setError(`${bad.name}: send between 1 and ${bad.qty}.`);
    setSaving(true);
    try {
      await branchApi("createTransfer", { transfer: { fromBranchId: from, toBranchId: to, note, idempotencyKey: key, items: lines.map((l) => ({ batchId: l.batchId, qty: Number(l.send) })) } });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Send stock to another branch" onClose={() => { if (!lines.length || confirm("Close without sending?")) onClose(); }} width="max-w-3xl">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-neutral-600">From</span>
            <select value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm">
              {sources.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-medium text-neutral-600">To</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm">
              <option value="">Choose…</option>
              {open.filter((b) => b.id !== from).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select></label>
        </div>
        <Field label="Find a product or batch in the sending branch"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, barcode or batch no." /></Field>
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 text-sm">
          {found.map((b) => (
            <li key={b.batchId} className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-1.5 last:border-0">
              <span>{b.name} <span className="text-xs text-neutral-500">Batch {b.batchNo ?? "—"} · Exp {b.expiry ?? "—"} · {b.qty} in stock</span></span>
              <button type="button" className="text-xs text-[var(--accent)] hover:underline" onClick={() => add(b)}>Add</button>
            </li>
          ))}
          {!found.length && <li className="px-3 py-3 text-neutral-500">No stock found in this branch.</li>}
        </ul>
        {lines.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500"><tr><th className="py-1">Product / batch</th><th className="py-1">In stock</th><th className="py-1">Send</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.batchId} className="border-t border-neutral-100">
                  <td className="py-1.5">{l.name} <span className="text-xs text-neutral-500">{l.batchNo ?? ""}</span></td>
                  <td className="py-1.5 tabular-nums">{l.qty}</td>
                  <td className="py-1.5"><input type="number" min={0} max={l.qty} step="any" value={l.send} aria-label={`Quantity of ${l.name}`} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, send: e.target.value } : x)))} className="w-24 rounded border border-neutral-200 px-2 py-1" /></td>
                  <td className="py-1.5 text-right"><button type="button" className="text-xs text-rose-700 hover:underline" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" disabled={saving || !lines.length} onClick={() => void send()}>{saving ? "Sending..." : "Send stock"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function TransferView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<(Transfer & { items: Item[] }) | null>(null);
  const [got, setGot] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    branchApi<Transfer & { items: Item[] }>("transfer", { id }).then((x) => { setT(x); setGot(Object.fromEntries(x.items.map((i) => [i.id, String(i.qty)]))); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  async function receive() {
    if (!t) return;
    const short = t.items.some((i) => Number(got[i.id]) < i.qty);
    if (short && !note.trim()) return setError("Some lines are short: add a note on what is missing or damaged.");
    try {
      await branchApi("receiveTransfer", { id, note, lines: t.items.map((i) => ({ itemId: i.id, receivedQty: Number(got[i.id]) })) });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function cancel() {
    const reason = prompt("Reason for cancelling this transfer? The stock goes back to the sending branch.");
    if (!reason) return;
    try {
      await branchApi("cancelTransfer", { id, reason });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Modal title={t ? `Transfer TR-${t.no}: ${t.fromName} → ${t.toName}` : "Transfer"} onClose={onClose} width="max-w-3xl">
      {!t ? <p className="text-sm text-neutral-500">{error ?? "Loading…"}</p> : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-neutral-600">Sent {when(t.dispatchedAt)}{t.createdBy ? ` by ${t.createdBy}` : ""}{t.receivedAt ? ` · closed ${when(t.receivedAt)}${t.receivedBy ? ` by ${t.receivedBy}` : ""}` : ""}{t.note ? ` · ${t.note}` : ""}</p>
          {t.receiptNote && <p className="rounded-lg bg-neutral-50 px-3 py-2 text-neutral-700">{t.receiptNote}</p>}
          <table className="w-full">
            <thead className="text-left text-xs uppercase text-neutral-500"><tr><th className="py-1">Product</th><th className="py-1">Batch / expiry</th><th className="py-1">Sent</th><th className="py-1">Received</th></tr></thead>
            <tbody>
              {t.items.map((i) => (
                <tr key={i.id} className="border-t border-neutral-100">
                  <td className="py-1.5">{i.name}</td>
                  <td className="py-1.5 text-neutral-600">{i.batchNo ?? "—"} · {i.expiry ?? "—"}</td>
                  <td className="py-1.5 tabular-nums">{i.qty}</td>
                  <td className="py-1.5">{t.canReceive
                    ? <input type="number" min={0} max={i.qty} step="any" value={got[i.id] ?? ""} aria-label={`Received ${i.name}`} onChange={(e) => setGot({ ...got, [i.id]: e.target.value })} className="w-24 rounded border border-neutral-200 px-2 py-1" />
                    : <span className="tabular-nums">{i.receivedQty ?? "—"}{i.note ? <span className="ml-1 text-xs text-amber-700">{i.note}</span> : null}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {t.canReceive && <Field label="Receipt note (required when short)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>}
          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}
          <div className="flex justify-between gap-2 border-t border-neutral-200 pt-3">
            {t.canCancel ? <Button type="button" variant="danger" onClick={() => void cancel()}>Cancel transfer</Button> : <span />}
            <div className="flex gap-2">
              <Button type="button" onClick={onClose}>Close</Button>
              {t.canReceive && <Button type="button" variant="primary" onClick={() => void receive()}>Receive stock</Button>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
