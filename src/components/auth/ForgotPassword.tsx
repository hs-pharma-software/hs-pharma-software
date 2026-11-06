"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { serverJson } from "@/lib/serverMode";

/** Forgot password, inside the sign-in card: 1) username, email or mobile;
 * 2) the 6-digit code from the email and a new password. */
const inputCls = "w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-800 outline-none transition focus:border-[#1e88e5] focus:bg-white focus:ring-2 focus:ring-[#1e88e5]/20 placeholder:text-neutral-400";
const labelCls = "text-xs font-semibold uppercase tracking-wide text-neutral-500";
const primary = { background: "linear-gradient(135deg, #1e88e5, #0b4fb3)", boxShadow: "0 4px 14px rgba(30,136,229,0.4)" };

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");

export function ForgotPassword({ onDone, onCancel }: { onDone: (username: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [identifier, setIdentifier] = useState("");
  const [requestId, setRequestId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await serverJson<{ requestId: string; message: string }>("/api/auth/recover/", { action: "request", identifier });
      setRequestId(r.requestId);
      setMessage(r.message);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("The two passwords are not the same."); return; }
    setBusy(true);
    try {
      const r = await serverJson<{ username: string }>("/api/auth/recover/", { action: "reset", requestId, code, newPassword: password });
      onDone(r.username);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-[#0b2a6b]">Reset your password</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {step === "ask" ? "Enter your username, email or mobile number. We will email a 6-digit code." : message}
        </p>
      </div>

      {step === "ask" ? (
        <form onSubmit={ask} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fp-id" className={labelCls}>Username, email or mobile</label>
            <input id="fp-id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus autoComplete="username"
              placeholder="e.g. ali, ali@example.com or 03001234567" className={inputCls} />
          </div>
          {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600 ring-1 ring-rose-200">{error}</div>}
          <button type="submit" disabled={busy || identifier.trim().length < 3} className="w-full rounded-xl py-3 text-sm font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-60" style={primary}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={reset} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fp-code" className={labelCls}>6-digit code</label>
            <input id="fp-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required autoFocus inputMode="numeric"
              autoComplete="one-time-code" placeholder="123456" className={`${inputCls} text-center text-lg font-semibold tracking-[0.4em]`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fp-new" className={labelCls}>New password</label>
            <div className="relative">
              <input id="fp-new" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={4}
                autoComplete="new-password" placeholder="At least 4 characters" className={`${inputCls} pr-11`} />
              <button type="button" onClick={() => setShow((v) => !v)} tabIndex={-1} aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 transition hover:text-neutral-700">
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fp-confirm" className={labelCls}>Confirm new password</label>
            <input id="fp-confirm" type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" className={inputCls} />
          </div>
          {error && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600 ring-1 ring-rose-200">{error}</div>}
          <button type="submit" disabled={busy || code.length !== 6} className="w-full rounded-xl py-3 text-sm font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-60" style={primary}>
            {busy ? "Saving…" : "Set new password"}
          </button>
          <button type="button" onClick={() => void ask()} disabled={busy} className="text-xs font-medium text-[#1565c0] hover:underline disabled:opacity-60">
            Didn&apos;t get it? Send a new code
          </button>
        </form>
      )}

      <button type="button" onClick={onCancel} className="text-sm text-neutral-500 hover:text-neutral-800 hover:underline">Back to sign in</button>
    </div>
  );
}
