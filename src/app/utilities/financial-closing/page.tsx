"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { useIsTauri } from "@/lib/platform";
import { financialClosingsRepo } from "@/lib/repo/financialClosings";

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function FinancialClosingPage() {
  const [systemPassword] = useState(generatePassword);
  const [enteredPassword, setEnteredPassword] = useState("");
  const [batchAction, setBatchAction] = useState("keep");
  const [description, setDescription] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClose() {
    if (enteredPassword !== systemPassword) {
      setError("Password does not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ts = new Date().toISOString();
      await financialClosingsRepo.create({
        date: ts.slice(0, 10),
        closed_at: ts,
        batch_action: batchAction,
        description: description || null,
      });
      setDone(ts);
    } finally {
      setBusy(false);
    }
  }

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Financial Closing" />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to close the financial year.
        </p>
      ) : (
        <div className="mx-auto max-w-md rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-medium text-rose-700">
            You are going to close the financial year. This is destructive and cannot be undone {"\u2014"}
            confirm before closing.
          </p>
          <p className="mb-3 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
            One-time password: <span className="font-mono font-semibold">{systemPassword}</span>
          </p>
          <div className="flex flex-col gap-3">
            <Field label={`Enter Password (${systemPassword})`} required>
              <Input value={enteredPassword} onChange={(e) => setEnteredPassword(e.target.value)} />
            </Field>
            <Field label="What should we do about Batches?" required>
              <Select value={batchAction} onChange={(e) => setBatchAction(e.target.value)}>
                <option value="keep">Keep all batches</option>
                <option value="archive">Archive expired batches</option>
              </Select>
            </Field>
            <Field label="Description">
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            {done && (
              <p className="text-sm text-emerald-700">
                Financial year closed at {new Date(done).toLocaleString()}. See View Financial Closing for the record.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="danger" onClick={() => void handleClose()} disabled={busy}>
                {busy ? "Closing..." : "OK"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
