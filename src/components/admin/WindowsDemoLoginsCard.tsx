"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { queriesCall } from "@/lib/queriesClient";
import { SITE_PRODUCTS } from "@/config/siteProducts";

interface DemoLogin { businessType: string; username: string; password: string; note: string }
const ANY = "Any";

/** Super Admin > Queries: the demo login emailed with each "Request for Windows"
 * from www.mavin.pk/download. One per business type; "Any" for every other type. */
export function WindowsDemoLoginsCard() {
  const [rows, setRows] = useState<DemoLogin[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void queriesCall<DemoLogin[]>("demoLogins").then((r) => setRows(r.length ? r : [{ businessType: ANY, username: "", password: "", note: "" }])).catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
  }, [open]);

  const set = (i: number, patch: Partial<DemoLogin>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      setRows(await queriesCall<DemoLogin[]>("saveDemoLogins", { logins: rows }));
      setMsg("Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-4 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-neutral-800">Windows requests: demo logins</p>
          <p className="text-xs text-neutral-500">Emailed with the download link to everyone who sends &quot;Request for Windows&quot; on mavin.pk. The request also appears here as a query.</p>
        </div>
        <Button onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Set demo logins"}</Button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[180px_1fr_1fr_1.4fr_auto]">
              <Select value={r.businessType} onChange={(e) => set(i, { businessType: e.target.value })} aria-label="Business type">
                <option value={ANY}>Any business type</option>
                {SITE_PRODUCTS.map((p) => <option key={p.slug} value={p.name}>{p.name}</option>)}
              </Select>
              <Input value={r.username} onChange={(e) => set(i, { username: e.target.value })} placeholder="Username" aria-label="Username" autoComplete="off" />
              <Input value={r.password} onChange={(e) => set(i, { password: e.target.value })} placeholder="Password" aria-label="Password" autoComplete="new-password" />
              <Input value={r.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="Note in the email (optional)" aria-label="Note" />
              <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="text-xs text-rose-600 hover:underline">Remove</button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button type="button" onClick={() => setRows((x) => [...x, { businessType: SITE_PRODUCTS[0]?.name ?? ANY, username: "", password: "", note: "" }])} className="text-xs text-sky-700 hover:underline">
              + Add a login for a business type
            </button>
            <div className="flex items-center gap-2">
              {msg && <span className="text-xs text-neutral-600">{msg}</span>}
              <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            </div>
          </div>
          <p className="text-[11px] text-neutral-500">Use demo accounts only: the password is sent by email to whoever asks. Without a login for their type (and no &quot;Any&quot;), the email says one will follow.</p>
        </div>
      )}
    </div>
  );
}
