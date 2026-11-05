"use client";

import { useState } from "react";
import { STATUS_TEXT } from "@/lib/subSupersClient";

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_TEXT[status] ?? { label: status, cls: "bg-neutral-100 text-neutral-600" };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>;
}

export function PaymentPill({ status }: { status: string }) {
  return status === "verified"
    ? <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">Payment verified</span>
    : <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">Payment unverified</span>;
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "warn"; children: React.ReactNode }) {
  const cls = kind === "error" ? "bg-rose-50 text-rose-700 ring-rose-200" : kind === "ok" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-amber-200";
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ring-1 ${cls}`}>{children}</div>;
}

/** A one-time sign-in setup link: shown once, to be sent to the person. */
export function SetupLink({ url, who }: { url: string; who: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-200">
      <p className="font-medium">Send this one-time link to {who}. It is shown only now and works for 7 days.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs">{url}</code>
        <button
          type="button"
          className="rounded-full bg-white px-3 py-1 text-xs font-medium ring-1 ring-sky-300"
          onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1 text-xs text-sky-800">Nothing is emailed automatically. If it does not arrive, create a new link; the old one stops working.</p>
    </div>
  );
}

/** Loading / error / empty states around a list. */
export function ListState({ loading, error, empty, emptyText, onRetry }: { loading: boolean; error: string | null; empty: boolean; emptyText: string; onRetry?: () => void }) {
  if (loading) return <p className="py-8 text-center text-sm text-neutral-400">Loading…</p>;
  if (error) return <div className="py-4"><Notice kind="error">{error}{onRetry && <> <button type="button" className="font-medium underline" onClick={onRetry}>Try again</button></>}</Notice></div>;
  if (empty) return <p className="py-8 text-center text-sm text-neutral-400">{emptyText}</p>;
  return null;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
