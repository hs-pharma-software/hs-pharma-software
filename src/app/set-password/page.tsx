"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MuawinTagline } from "@/components/brand/MuawinTagline";

/** One-time link from the platform owner: a new Sub Super or a newly
 * activated customer chooses their password. The link works once. */
export default function SetPasswordPage() {
  return (
    <Suspense fallback={<Frame><p className="text-sm text-neutral-500">Loading…</p></Frame>}>
      <SetPassword />
    </Suspense>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mavin-header.png" alt="MAVIN.pk" className="mx-auto h-auto w-48" />
        <p className="mb-5 mt-2 flex justify-center"><MuawinTagline className="text-sm font-medium text-[#0b2a6b]" logoClassName="h-7 w-auto" /></p>
        {children}
      </div>
    </div>
  );
}

function SetPassword() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setError("Choose a password of at least 6 characters.");
    if (password !== confirm) return setError("The two passwords are different.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/setup-password/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const body = (await res.json().catch(() => ({}))) as { username?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "The password could not be set.");
      setDone(body.username ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Frame><p className="text-sm text-rose-700">This link is incomplete. Open the full link you were sent.</p></Frame>;
  if (done !== null) {
    return (
      <Frame>
        <p className="font-semibold text-neutral-800">Your password is set.</p>
        <p className="mt-1 text-sm text-neutral-600">Sign in with your login ID <b>{done}</b> and the new password.</p>
        <Link href="/" className="mt-4 inline-block rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">Go to sign in</Link>
      </Frame>
    );
  }
  return (
    <Frame>
      <h1 className="text-lg font-semibold text-neutral-800">Choose your password</h1>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        <label htmlFor="sp-pass" className="text-xs font-semibold uppercase tracking-wide text-neutral-500">New password</label>
        <input id="sp-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm" />
        <label htmlFor="sp-confirm" className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Repeat the password</label>
        <input id="sp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm" />
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <button type="submit" disabled={busy} className="mt-1 rounded-xl bg-[var(--accent)] py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {busy ? "Saving…" : "Set password"}
        </button>
      </form>
    </Frame>
  );
}
