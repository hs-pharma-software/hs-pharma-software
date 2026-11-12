"use client";

/** Mavin Pharmacy Offline: first setup on this computer. Creates the pharmacy
 * and its local Super Admin (the desktop stores the password with scrypt),
 * then shows the installation's recovery key once. */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { localBridge, unwrap } from "@/lib/edition";
import { RecoveryKeyNotice } from "./RecoveryKeyNotice";

const input = "w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm outline-none focus:border-[#1e88e5] focus:bg-white focus:ring-2 focus:ring-[#1e88e5]/20";

export function StandaloneSetup({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ pharmacyName: "", ownerName: "", phone: "", address: "", username: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.password !== f.confirm) { setError("The two passwords are different."); return; }
    setBusy(true);
    try {
      const r = await unwrap(localBridge()!.setup({ pharmacyName: f.pharmacyName, ownerName: f.ownerName, username: f.username, password: f.password, phone: f.phone, address: f.address }));
      setRecoveryKey(r.recoveryKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#071640] via-[#0b2a6b] to-[#1565c0] px-4 py-8">
      <div className="w-full max-w-lg rounded-3xl bg-white px-8 py-8 shadow-2xl">
        <h1 className="text-xl font-bold text-neutral-900">Mavin Pharmacy Offline: first setup</h1>
        {recoveryKey ? (
          <RecoveryKeyNotice recoveryKey={recoveryKey} title="Your recovery key" onDone={onDone} doneLabel="Continue to sign in" />
        ) : (
          <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-3">
            <p className="text-sm text-neutral-600">This computer keeps its own data and works without the internet. The login you create here is this pharmacy&apos;s <b>local Super Admin</b>.</p>
            <input className={input} placeholder="Pharmacy name" value={f.pharmacyName} onChange={set("pharmacyName")} required minLength={2} />
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={input} placeholder="Owner name" value={f.ownerName} onChange={set("ownerName")} required minLength={2} />
              <input className={input} placeholder="Phone (optional)" value={f.phone} onChange={set("phone")} />
            </div>
            <input className={input} placeholder="Address (optional)" value={f.address} onChange={set("address")} />
            <hr className="my-1" />
            <input className={input} placeholder="Super Admin username" value={f.username} onChange={set("username")} required minLength={3} autoComplete="username" />
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={input} type="password" placeholder="Password (10+ characters)" value={f.password} onChange={set("password")} required minLength={10} autoComplete="new-password" />
              <input className={input} type="password" placeholder="Repeat password" value={f.confirm} onChange={set("confirm")} required autoComplete="new-password" />
            </div>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <Button type="submit" variant="primary" disabled={busy} className="justify-center">{busy ? "Setting up…" : "Create pharmacy and Super Admin"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
