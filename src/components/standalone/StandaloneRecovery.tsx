"use client";

/** Forgotten local Super Admin password: reset with this installation's
 * recovery key, offline. The old key stops working and a new one is shown. */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { localBridge, unwrap } from "@/lib/edition";
import { RecoveryKeyNotice } from "./RecoveryKeyNotice";

const input = "w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm outline-none focus:border-[#1e88e5] focus:bg-white";

export function StandaloneRecovery({ onDone, onCancel }: { onDone: (username: string) => void; onCancel: () => void }) {
  const [key, setKey] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ username: string; recoveryKey: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw !== pw2) { setError("The two passwords are different."); return; }
    setBusy(true);
    try {
      setResult(await unwrap(localBridge()!.recover({ recoveryKey: key, newPassword: pw })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  if (result) {
    return <RecoveryKeyNotice recoveryKey={result.recoveryKey} title={`Password reset for ${result.username}. Your NEW recovery key`} onDone={() => onDone(result.username)} doneLabel="Sign in" />;
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-neutral-900">Reset the local Super Admin password</h2>
      <p className="text-sm text-neutral-600">Enter the recovery key shown when this pharmacy was set up. Other logins are reset by the Super Admin from Settings.</p>
      <input className={`${input} font-mono`} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" value={key} onChange={(e) => setKey(e.target.value)} required autoFocus />
      <input className={input} type="password" placeholder="New password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} autoComplete="new-password" />
      <input className={input} type="password" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" />
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={onCancel}>Back</Button>
        <Button type="submit" variant="primary" disabled={busy} className="flex-1 justify-center">{busy ? "Checking…" : "Reset password"}</Button>
      </div>
    </form>
  );
}
