"use client";

import { useEffect, useState } from "react";
import { serverJson } from "@/lib/serverMode";
import type { Img } from "@/lib/web/sections";

/** Website management: the API call, and small shared controls. */
export const webCall = async <T,>(action: string, body: Record<string, unknown> = {}, tenantId?: string) =>
  (await serverJson<{ result: T }>("/api/web/manage/", { action, ...body, ...(tenantId ? { tenantId } : {}) })).result;

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
export const inputCls = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 disabled:bg-neutral-50";
export const labelCls = "flex flex-col gap-1 text-xs font-medium text-neutral-600";

export function Note({ kind, children }: { kind: "ok" | "error" | "warn" | "info"; children: React.ReactNode }) {
  const cls = { ok: "bg-emerald-50 text-emerald-800 ring-emerald-200", error: "bg-rose-50 text-rose-700 ring-rose-200", warn: "bg-amber-50 text-amber-800 ring-amber-200", info: "bg-sky-50 text-sky-800 ring-sky-200" }[kind];
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm ring-1 ${cls}`}>{children}</div>;
}

export function Toggle({ id, checked, onChange, label, hint, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={`flex items-start gap-2 text-sm ${disabled ? "opacity-60" : ""}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
      <span><span className="font-medium text-neutral-800">{label}</span>{hint && <span className="block text-xs text-neutral-500">{hint}</span>}</span>
    </label>
  );
}

interface Media { id: string; url: string; alt: string; bytes: number; width: number | null; height: number | null }

/** An image field: upload a new image or pick one from the library; alt text required for meaning. */
export function ImageField({ id, label, value, onChange, tenantId, hint }: { id: string; label: string; value: Img | null | undefined; onChange: (v: Img | null) => void; tenantId?: string; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<Media[] | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Images must be under 5 MB."); return; }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("alt", value?.alt ?? "");
      if (tenantId) form.append("tenantId", tenantId);
      const res = await fetch("/api/web/upload/", { method: "POST", body: form, credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as { result?: { url: string }; error?: string };
      if (!res.ok || !j.result) throw new Error(j.error ?? `Upload failed (${res.status}).`);
      onChange({ url: j.result.url, alt: value?.alt ?? "" });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-neutral-600">{label}</p>
      {hint && <p className="text-[11px] text-neutral-400">{hint}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {value?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.url} alt={value.alt} className="h-14 w-20 rounded-md bg-neutral-100 object-cover ring-1 ring-black/5" />
        ) : <span className="flex h-14 w-20 items-center justify-center rounded-md bg-neutral-100 text-[10px] text-neutral-400">No image</span>}
        <label htmlFor={`${id}-file`} className="cursor-pointer rounded-full border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-50">{busy ? "Uploading…" : "Upload"}</label>
        <input id={`${id}-file`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        <button type="button" className="rounded-full border border-neutral-300 px-3 py-1 text-xs font-medium hover:bg-neutral-50" onClick={() => void webCall<Media[]>("media", {}, tenantId).then(setLibrary).catch((e) => setError(errText(e)))}>Library</button>
        {value?.url && <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => onChange(null)}>Remove</button>}
      </div>
      {value?.url && (
        <label htmlFor={`${id}-alt`} className={labelCls}>Image description (for screen readers and search)
          <input id={`${id}-alt`} value={value.alt} maxLength={160} onChange={(e) => onChange({ ...value, alt: e.target.value })} className={inputCls} placeholder="e.g. Our shop front on Main Road" />
        </label>
      )}
      {library && (
        <div className="rounded-lg border border-neutral-200 p-2">
          <div className="mb-1 flex justify-between text-xs"><span className="text-neutral-500">Your images</span><button type="button" className="text-neutral-500 hover:underline" onClick={() => setLibrary(null)}>Close</button></div>
          {library.length ? (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {library.map((m) => (
                <button key={m.id} type="button" onClick={() => { onChange({ url: m.url, alt: m.alt }); setLibrary(null); }} className="overflow-hidden rounded ring-1 ring-black/5 hover:ring-[var(--accent)]" aria-label={`Use ${m.alt || "this image"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          ) : <p className="text-xs text-neutral-400">No images yet. Upload one.</p>}
        </div>
      )}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}

/** Warns before leaving the page with unsaved changes. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

export const STATUS_LABEL: Record<string, [string, string]> = {
  pending: ["Pending", "bg-amber-100 text-amber-800"], confirmed: ["Confirmed", "bg-sky-100 text-sky-800"], preparing: ["Preparing", "bg-sky-100 text-sky-800"],
  ready: ["Ready", "bg-indigo-100 text-indigo-800"], dispatched: ["Dispatched", "bg-indigo-100 text-indigo-800"], completed: ["Completed", "bg-emerald-100 text-emerald-800"],
  cancelled: ["Cancelled", "bg-neutral-200 text-neutral-600"], rejected: ["Rejected", "bg-rose-100 text-rose-700"],
  pending_verification: ["Pending verification", "bg-amber-100 text-amber-800"], dns_pending: ["DNS pending", "bg-amber-100 text-amber-800"],
  ssl_pending: ["SSL pending", "bg-sky-100 text-sky-800"], active: ["Active", "bg-emerald-100 text-emerald-800"], error: ["Error", "bg-rose-100 text-rose-700"],
};
export const Pill = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_LABEL[s]?.[1] ?? "bg-neutral-100 text-neutral-600"}`}>{STATUS_LABEL[s]?.[0] ?? s.replace(/_/g, " ")}</span>;
