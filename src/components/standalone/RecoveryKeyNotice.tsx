"use client";

/** Shows a recovery key once, with a way to save it to a file, and asks for
 * confirmation that it was kept somewhere safe before continuing. */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { localBridge, unwrap } from "@/lib/edition";

export function RecoveryKeyNotice({ recoveryKey, title, onDone, doneLabel }: { recoveryKey: string; title: string; onDone: () => void; doneLabel: string }) {
  const [kept, setKept] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      const r = await unwrap(localBridge()!.saveText({
        suggestedName: "Mavin-Pharmacy-recovery-key.txt",
        text: `Mavin Pharmacy Offline: recovery key\r\n\r\n${recoveryKey}\r\n\r\nThis key resets the local Super Admin password on this installation only.\r\nKeep it away from the computer (printed, or on a USB drive in a safe place).\r\nAfter it is used, a new key replaces it.\r\n`,
      }));
      if (r) setSaved(r.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      <p className="text-sm text-neutral-600">It resets the local Super Admin password if it is forgotten. <b>It is shown only now.</b> MAVIN does not keep a copy and cannot recover it.</p>
      <p className="select-all break-all rounded-xl bg-neutral-900 px-4 py-3 text-center font-mono text-lg tracking-wider text-white">{recoveryKey}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()}>Save to a file…</Button>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      {saved && <p className="text-xs text-emerald-700">Saved to {saved}. Move it off this computer.</p>}
      {error && <p className="text-xs text-rose-700">{error}</p>}
      <label className="flex items-center gap-2 text-sm text-neutral-800">
        <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} className="h-4 w-4" />
        I have saved the recovery key somewhere safe.
      </label>
      <Button variant="primary" disabled={!kept} onClick={onDone} className="w-full justify-center">{doneLabel}</Button>
    </div>
  );
}
