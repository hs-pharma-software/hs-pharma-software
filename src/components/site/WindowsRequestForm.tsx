"use client";

import { useState } from "react";

const FIELD = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1565c0] focus:ring-2 focus:ring-[#1565c0]/20 aria-[invalid=true]:border-rose-400";
const BUTTON = "inline-flex min-h-12 items-center justify-center rounded-lg bg-[#0b2a6b] px-6 py-3 text-base font-semibold text-white hover:bg-[#1565c0] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]";

/** "Request for Windows": name, email, mobile, business type and a note. MAVIN.pk
 * saves it (Super Admin > Queries) and emails the download link and a demo login. */
export function WindowsRequestForm({ businessTypes }: { businessTypes: string[] }) {
  const [open, setOpen] = useState(false);
  const [shownAt, setShownAt] = useState(0);
  const [submissionId, setSubmissionId] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [emailed, setEmailed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  function show() {
    setShownAt(Date.now());
    setSubmissionId(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setOpen(true);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return;
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    setState("sending");
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/site/lead/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, kind: "windows", shownAt, submissionId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string>; emailed?: boolean };
      if (!res.ok) {
        setError(body.error ?? "The request could not be sent. Please try again.");
        setFields(body.fields ?? {});
        setState("idle");
        return;
      }
      setEmailed(body.emailed !== false);
      setState("sent");
    } catch {
      setError("The request could not be sent. Check your connection and try again.");
      setState("idle");
    }
  }

  if (!open) return <button type="button" onClick={show} className={BUTTON}>Request for Windows</button>;

  if (state === "sent") {
    return (
      <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 sm:col-span-2">
        <p className="font-semibold">Thank you. Your request was received.</p>
        <p className="mt-1">{emailed
          ? "We have emailed you the download link and a demo login. If it is not in your inbox in a few minutes, check the spam folder."
          : "We will email you the download link and a demo login shortly."}</p>
      </div>
    );
  }

  const err = (k: string) => fields[k] && <p id={`wr-${k}-err`} className="mt-1 text-xs text-rose-700">{fields[k]}</p>;
  const aria = (k: string) => ({ "aria-invalid": Boolean(fields[k]), "aria-describedby": fields[k] ? `wr-${k}-err` : undefined });

  return (
    <form onSubmit={submit} noValidate className="relative grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5 sm:col-span-2 sm:grid-cols-2">
      <p className="text-sm font-semibold text-[#0b2a6b] sm:col-span-2">Request {`MAVIN for Windows`}: we email you the download link and a demo login.</p>
      {/* Honeypot: hidden from people and screen readers. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="wr-website">Website</label>
        <input id="wr-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <label htmlFor="wr-name" className="text-sm font-medium text-slate-700">Name</label>
        <input id="wr-name" name="name" autoComplete="name" required className={`mt-1 ${FIELD}`} {...aria("name")} />
        {err("name")}
      </div>
      <div>
        <label htmlFor="wr-email" className="text-sm font-medium text-slate-700">Email</label>
        <input id="wr-email" name="email" type="email" autoComplete="email" required className={`mt-1 ${FIELD}`} {...aria("email")} />
        {err("email")}
      </div>
      <div>
        <label htmlFor="wr-phone" className="text-sm font-medium text-slate-700">Mobile</label>
        <input id="wr-phone" name="phone" type="tel" autoComplete="tel" placeholder="0300 1234567" required className={`mt-1 ${FIELD}`} {...aria("phone")} />
        {err("phone")}
      </div>
      <div>
        <label htmlFor="wr-type" className="text-sm font-medium text-slate-700">Business type</label>
        <select id="wr-type" name="businessType" defaultValue="" required className={`mt-1 ${FIELD}`} {...aria("businessType")}>
          <option value="">Choose…</option>
          {businessTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          <option value="Other">Other</option>
        </select>
        {err("businessType")}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="wr-note" className="text-sm font-medium text-slate-700">Note (optional)</label>
        <textarea id="wr-note" name="workflow" rows={3} className={`mt-1 ${FIELD}`} />
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{error}</p>}
      <div className="flex gap-3 sm:col-span-2">
        <button type="submit" disabled={state === "sending"} className={BUTTON}>{state === "sending" ? "Sending…" : "Send request"}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-600 hover:underline">Cancel</button>
      </div>
    </form>
  );
}
