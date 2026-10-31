"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import {
  EXPIRY_CORRECTION_LIMIT, correctBatchExpiry, expiryStatus, listExpiryChanges, type ExpiryChange,
} from "@/lib/repo/batchExpiry";

const TONE = {
  expired: "bg-rose-100 text-rose-800 ring-rose-200",
  soon: "bg-amber-100 text-amber-800 ring-amber-200",
  ok: "text-neutral-800 ring-transparent",
  none: "text-neutral-400 ring-transparent",
};

function timeLeft(days: number | null): string {
  if (days == null) return "";
  if (days <= 0) return "Expired";
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} left`;
  return `${Math.round(days / 30)} months left`;
}

/** The stock list's Expiry cell: red once expired, amber within 6 months, and
 * a pencil to correct a wrongly entered date while corrections are left. */
export function ExpiryCell({ expiry, used, onEdit }: { expiry: string | null; used: number; onEdit?: () => void }) {
  const { status, days } = expiryStatus(expiry);
  const left = EXPIRY_CORRECTION_LIMIT - used;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        title={status === "expired" || status === "soon" ? timeLeft(days) : undefined}
        className={`rounded-md px-1.5 py-0.5 tabular-nums ring-1 ${TONE[status]} ${status === "expired" ? "font-semibold" : ""}`}
      >
        {expiry ? expiry.slice(0, 10) : "—"}
      </span>
      {!onEdit ? null : left > 0 ? (
        <button
          type="button"
          title={`Correct the expiry (${left} of ${EXPIRY_CORRECTION_LIMIT} corrections left)`}
          aria-label="Correct the expiry date"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <Pencil size={13} />
        </button>
      ) : (
        <span title="Expiry already corrected 3 times" className="text-[10px] text-neutral-400">locked</span>
      )}
    </span>
  );
}

/** Correct a batch's expiry date: the new date and why; earlier corrections listed. */
export function ExpiryCorrectionModal({ batch, onClose, onSaved }: {
  batch: { id: string; product_name: string; batch_no: string | null; expiry_date: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(batch.expiry_date?.slice(0, 10) ?? "");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<ExpiryChange[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void listExpiryChanges(batch.id).then(setHistory).catch(() => setHistory([])); }, [batch.id]);
  const left = EXPIRY_CORRECTION_LIMIT - history.length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await correctBatchExpiry(batch.id, date, reason);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Correct expiry date" onClose={onClose} width="max-w-md">
      <p className="text-sm text-neutral-700">
        <span className="font-medium">{batch.product_name}</span>{batch.batch_no ? ` · Batch ${batch.batch_no}` : ""}
      </p>
      <p className="mb-3 text-xs text-neutral-500">Current expiry: {batch.expiry_date?.slice(0, 10) ?? "none"}</p>
      <div className={`mb-3 rounded-lg px-3 py-2 text-xs ring-1 ${left > 1 ? "bg-sky-50 text-sky-800 ring-sky-200" : "bg-amber-50 text-amber-900 ring-amber-200"}`}>
        {left > 0
          ? `${left} of ${EXPIRY_CORRECTION_LIMIT} corrections left for this batch. Use it only to fix a date entered by mistake.`
          : `This batch's expiry has been corrected ${EXPIRY_CORRECTION_LIMIT} times and cannot be changed again.`}
      </div>
      {left > 0 && (
        <div className="flex flex-col gap-3">
          <Field label="Correct expiry date" required><Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reason" required><Input id="exp-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Typed 2026 instead of 2028 at purchase" /></Field>
        </div>
      )}
      {history.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Earlier corrections</p>
          <ul className="divide-y divide-neutral-100 text-xs">
            {history.map((h) => (
              <li key={h.id} className="py-1.5">
                {h.old_expiry?.slice(0, 10) ?? "none"} → <span className="font-medium">{h.new_expiry}</span>
                <span className="text-neutral-500"> · {h.changed_by_name ?? "—"} · {new Date(h.created_at).toLocaleString()}</span>
                <div className="text-neutral-600">{h.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        {left > 0 && <Button variant="primary" onClick={() => void save()} disabled={saving || !date || !reason.trim()}>{saving ? "Saving…" : "Save correction"}</Button>}
      </div>
    </Modal>
  );
}
