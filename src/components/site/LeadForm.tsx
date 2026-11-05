"use client";

import { useState } from "react";

const FIELD = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1565c0] focus:ring-2 focus:ring-[#1565c0]/20 aria-[invalid=true]:border-rose-400";

/** Demo / contact request. Sent to /api/site/lead, which checks it and (for
 * now) delivers to a mock: nothing is emailed or stored yet. */
export function LeadForm({ kind, businessTypes, defaultType = "" }: { kind: "demo" | "contact"; businessTypes: string[]; defaultType?: string }) {
  const [shownAt] = useState(() => Date.now());
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    setState("sending");
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/site/lead/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, kind, shownAt }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
      if (!res.ok) {
        setError(body.error ?? "The request could not be sent. Please try again.");
        setFields(body.fields ?? {});
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError("The request could not be sent. Check your connection and try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-900">
        <p className="font-semibold">Thank you. Your request was received.</p>
        <p className="mt-1">We will contact you to arrange a time.</p>
      </div>
    );
  }

  const err = (k: string) => fields[k] && <p id={`lf-${k}-err`} className="mt-1 text-xs text-rose-700">{fields[k]}</p>;
  const aria = (k: string) => ({ "aria-invalid": Boolean(fields[k]), "aria-describedby": fields[k] ? `lf-${k}-err` : undefined });

  return (
    <form onSubmit={submit} noValidate className="relative grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 sm:p-6">
      {/* Honeypot: hidden from people and screen readers. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label htmlFor="lf-website">Website</label>
        <input id="lf-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <label htmlFor="lf-name" className="text-sm font-medium text-slate-700">Your name</label>
        <input id="lf-name" name="name" autoComplete="name" required className={`mt-1 ${FIELD}`} {...aria("name")} />
        {err("name")}
      </div>
      <div>
        <label htmlFor="lf-business" className="text-sm font-medium text-slate-700">Business name</label>
        <input id="lf-business" name="business" autoComplete="organization" required className={`mt-1 ${FIELD}`} {...aria("business")} />
        {err("business")}
      </div>
      <div>
        <label htmlFor="lf-type" className="text-sm font-medium text-slate-700">Business type{kind === "contact" && " (optional)"}</label>
        <select id="lf-type" name="businessType" defaultValue={defaultType} className={`mt-1 ${FIELD}`} {...aria("businessType")}>
          <option value="">Choose…</option>
          {businessTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          <option value="Other">Other</option>
        </select>
        {err("businessType")}
      </div>
      <div>
        <label htmlFor="lf-branches" className="text-sm font-medium text-slate-700">Number of branches</label>
        <input id="lf-branches" name="branches" inputMode="numeric" placeholder="1" className={`mt-1 ${FIELD}`} {...aria("branches")} />
        {err("branches")}
      </div>
      <div>
        <label htmlFor="lf-phone" className="text-sm font-medium text-slate-700">Phone</label>
        <input id="lf-phone" name="phone" type="tel" autoComplete="tel" placeholder="0300 1234567" className={`mt-1 ${FIELD}`} {...aria("phone")} />
        {err("phone")}
      </div>
      <div>
        <label htmlFor="lf-email" className="text-sm font-medium text-slate-700">Email</label>
        <input id="lf-email" name="email" type="email" autoComplete="email" className={`mt-1 ${FIELD}`} {...aria("email")} />
        {err("email")}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="lf-workflow" className="text-sm font-medium text-slate-700">{kind === "demo" ? "What would you like to see?" : "How can we help?"}</label>
        <textarea id="lf-workflow" name="workflow" rows={4} placeholder={kind === "demo" ? "For example: billing with batch and expiry, purchases, FBR invoices" : ""} className={`mt-1 ${FIELD}`} />
      </div>
      <p className="text-xs text-slate-500 sm:col-span-2">Give a phone number or an email address so we can reply.</p>
      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={state === "sending"} className="rounded-lg bg-[#0b2a6b] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0d3a8f] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]">
          {state === "sending" ? "Sending…" : kind === "demo" ? "Request a demo" : "Send message"}
        </button>
      </div>
    </form>
  );
}
