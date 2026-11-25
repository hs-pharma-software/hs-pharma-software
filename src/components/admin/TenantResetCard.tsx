"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { serverJson } from "@/lib/serverMode";

/** Super Admin: empties a business after testing. Takes effect at once and cannot be undone. */
export function TenantResetCard({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [open, setOpen] = useState(false);
  const [keepSetup, setKeepSetup] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    try {
      const r = await serverJson<{ result: { tables: number; rows: number; keptSetup: boolean } }>("/api/tenant-reset/", { tenantId, confirmName: typed, keepSetup });
      setDone(`Reset done: ${r.result.rows} records removed${r.result.keptSetup ? ", setup kept" : ""}. Its logins see an empty business on their next page.`);
      setOpen(false);
      setTyped("");
    } catch (e) {
      window.alert(`Could not reset: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-sm">
      {done && <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">{done}</p>}
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-neutral-600">Removes all records of this business (for example after testing), so it starts fresh.</p>
          <Button onClick={() => { setOpen(true); setDone(null); }}>Reset business data…</Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
          <p className="font-medium text-rose-900">This removes every record of {tenantName} and cannot be undone.</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-900">
            <li>Removed: patients, visits, orders, reports, invoices, bills, payments, cash register, expenses, revenue, stock, customers, suppliers and all other records.</li>
            <li>Kept: the business, its logins and branches, its plan, settings and profile, print templates, FBR / PRA credentials, offline computers and the website.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-neutral-800">
            <input type="checkbox" checked={keepSetup} onChange={(e) => setKeepSetup(e.target.checked)} className="mt-0.5" />
            <span>Keep the setup: staff, tests / studies and rates, machines, report templates, products and categories (stock goes to zero).</span>
          </label>
          <Field label={`Type the business name to confirm: ${tenantName}`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={tenantName} autoComplete="off" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setOpen(false); setTyped(""); }} disabled={busy}>Cancel</Button>
            <Button loading={busy} variant="danger" disabled={busy || typed.trim() !== tenantName.trim()} onClick={() => void reset()}>
              {busy ? "Resetting…" : "Reset now"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
