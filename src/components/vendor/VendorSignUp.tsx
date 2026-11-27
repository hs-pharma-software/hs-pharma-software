"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { vendorSignUp, errText } from "@/lib/vendorPortalClient";

const labelCls = "text-xs font-semibold uppercase tracking-wide text-neutral-500";
const inputCls = "w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800 outline-none transition focus:border-[#1e88e5] focus:bg-white focus:ring-2 focus:ring-[#1e88e5]/20 placeholder:text-neutral-400 aria-[invalid=true]:border-rose-400";
const primary = { background: "linear-gradient(135deg, #1e88e5, #0b4fb3)", boxShadow: "0 4px 14px rgba(30,136,229,0.4)" };

type Key = "companyName" | "contactName" | "email" | "phone" | "username" | "password" | "again";
const CHECKS: Record<Key, (v: string, all: Record<Key, string>) => string | null> = {
  companyName: (v) => (v.trim().length >= 2 ? null : "Enter your company name"),
  contactName: (v) => (v.trim().length >= 2 ? null : "Enter your name"),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim()) ? null : "Enter a valid email (the password reset code is sent there)"),
  phone: (v) => (/^\+?[0-9][0-9 -]{6,18}$/.test(v.trim()) ? null : "Enter your mobile number"),
  username: (v) => (/^[A-Za-z0-9._@-]{3,60}$/.test(v.trim()) ? null : "At least 3 letters or digits, no spaces"),
  password: (v) => (v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v) ? null : "At least 8 characters with letters and numbers"),
  again: (v, all) => (v === all.password ? null : "The two passwords do not match"),
};

/** Vendor portal: a supplier or service company makes its own account. The
 * registration steps (company, address, bank, review) open after sign-in. */
export function VendorSignUp({ onDone, onCancel }: { onDone: (username: string, password: string) => void; onCancel: () => void }) {
  const [v, setV] = useState<Record<Key, string>>({ companyName: "", contactName: "", email: "", phone: "", username: "", password: "", again: "" });
  const [tried, setTried] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = Object.fromEntries((Object.keys(CHECKS) as Key[]).map((k) => [k, CHECKS[k](v[k], v)])) as Record<Key, string | null>;
  const set = (k: Key) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    const first = (Object.keys(problems) as Key[]).find((k) => problems[k]);
    if (first) { document.getElementById(`vs-${first}`)?.focus(); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await vendorSignUp({ companyName: v.companyName.trim(), contactName: v.contactName.trim(), email: v.email.trim(), phone: v.phone.trim(), username: v.username.trim(), password: v.password });
      onDone(r.username, v.password);
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }

  const field = (k: Key, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`vs-${k}`} className={labelCls}>{label}</label>
      <input id={`vs-${k}`} value={v[k]} onChange={set(k)} aria-invalid={(tried && Boolean(problems[k])) || undefined}
        aria-describedby={tried && problems[k] ? `vs-${k}-err` : undefined} className={inputCls} {...props} />
      {tried && problems[k] && <p id={`vs-${k}-err`} className="field-msg text-xs text-rose-600">{problems[k]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      <div>
        <p className="text-base font-semibold text-neutral-900">Create your vendor account</p>
        <p className="mt-0.5 text-xs text-neutral-500">For suppliers and service companies. After this you fill in your company, address and bank details; MAVIN.pk checks and approves them before hospitals can add you.</p>
      </div>
      {field("companyName", "Company name", { autoFocus: true, autoComplete: "organization", placeholder: "e.g. Ali Traders" })}
      {field("contactName", "Your name", { autoComplete: "name" })}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {field("email", "Email", { type: "email", autoComplete: "email", inputMode: "email" })}
        {field("phone", "Mobile", { type: "tel", autoComplete: "tel", inputMode: "tel", placeholder: "03xx-xxxxxxx" })}
      </div>
      {field("username", "Choose a username", { autoComplete: "username", autoCapitalize: "none", spellCheck: false })}
      <div className="relative">
        {field("password", "Password", { type: show ? "text" : "password", autoComplete: "new-password" })}
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-[1.9rem] flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 transition hover:text-neutral-700">
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {field("again", "Password again", { type: show ? "text" : "password", autoComplete: "new-password" })}
      {error && <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600 ring-1 ring-rose-200">{error}</div>}
      <button type="submit" disabled={busy} className="mt-1 w-full rounded-xl py-3 text-sm font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-60" style={primary}>
        {busy ? "Creating account…" : "Create account"}
      </button>
      <button type="button" onClick={onCancel} className="text-center text-xs font-medium text-[#1565c0] hover:underline">I already have an account: sign in</button>
    </form>
  );
}
