"use client";

import { useEffect, useState } from "react";
import { serverJson } from "@/lib/serverMode";

/** A login's recovery email and mobile (used by "Forgot password"). For your
 * own login the current password is asked; owners and the Super Admin set
 * them for logins they manage. */
interface Contact { email: string | null; mobile: string | null; emailReady: boolean }
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const input = "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

export function RecoveryContact({ userId, self, compact = false, onSaved }: { userId?: string; self: boolean; compact?: boolean; onSaved?: () => void }) {
  const [c, setC] = useState<Contact | null>(null);
  const [editing, setEditing] = useState(!compact);
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    serverJson<Contact>("/api/auth/contact/", { action: "get", userId }).then((x) => { setC(x); setEmail(x.email ?? ""); setMobile(x.mobile ?? ""); })
      .catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, [userId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await serverJson<{ email: string | null; mobile: string | null }>("/api/auth/contact/", { action: "set", userId, email, mobile, currentPassword: password });
      setC((x) => (x ? { ...x, ...r } : x));
      setEmail(r.email ?? "");
      setMobile(r.mobile ?? "");
      setPassword("");
      if (compact) setEditing(false);
      setMsg({ ok: true, text: "Recovery details saved." });
      onSaved?.();
    } catch (err) {
      setMsg({ ok: false, text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!c) return msg ? <p className="text-xs text-rose-700">{msg.text}</p> : <p className="text-xs text-neutral-400">Loading…</p>;
  const id = userId ?? "self";
  return (
    <div className="space-y-2 text-xs">
      {!editing ? (
        <div className="flex items-start justify-between gap-2">
          <dl className="min-w-0 space-y-0.5">
            <div className="flex gap-2"><dt className="text-neutral-500">Email</dt><dd className="truncate font-medium text-neutral-800">{c.email ?? <span className="text-amber-700">not set</span>}</dd></div>
            <div className="flex gap-2"><dt className="text-neutral-500">Mobile</dt><dd className="font-medium text-neutral-800">{c.mobile ?? "not set"}</dd></div>
          </dl>
          <button type="button" onClick={() => { setEditing(true); setMsg(null); }} className="shrink-0 font-medium text-[var(--accent)] hover:underline">Edit</button>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-2">
          <label htmlFor={`rc-email-${id}`} className="block text-neutral-600">Email (the reset code is sent here)
            <input id={`rc-email-${id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" className={`${input} mt-1`} />
          </label>
          <label htmlFor={`rc-mobile-${id}`} className="block text-neutral-600">Mobile
            <input id={`rc-mobile-${id}`} type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="03001234567" autoComplete="tel" className={`${input} mt-1`} />
          </label>
          {self && (
            <label htmlFor={`rc-pw-${id}`} className="block text-neutral-600">Your current password
              <input id={`rc-pw-${id}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className={`${input} mt-1`} />
            </label>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-md bg-[var(--accent)] px-3 py-1.5 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
            {compact && <button type="button" onClick={() => { setEditing(false); setEmail(c.email ?? ""); setMobile(c.mobile ?? ""); setPassword(""); setMsg(null); }} className="rounded-md px-2 py-1.5 text-neutral-500 hover:bg-neutral-100">Cancel</button>}
          </div>
        </form>
      )}
      {!c.emailReady && <p className="text-[11px] text-amber-700">Reset emails are not switched on yet; the details are saved for when they are.</p>}
      <p className="text-[11px] text-neutral-400">Used only to reset a forgotten password. Codes go to the email; text messages come later.</p>
      {msg && <p className={`rounded-md px-2 py-1 ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`} role="status">{msg.text}</p>}
    </div>
  );
}
