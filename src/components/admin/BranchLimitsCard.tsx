"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { branchAdminApi, type Allowance, type Branch } from "@/lib/branchClient";

interface Req { id: string; extra: number; currentLimit: number | null; reason: string | null; status: string; approvedLimit: number | null; decisionNote: string | null; requestedBy: string | null; createdAt: string; decidedAt: string | null }
interface Audit { id: string; branchName: string | null; actor: string | null; action: string; detail: unknown; createdAt: string }
interface Data { allowance: Allowance; branches: Branch[]; requests: Req[]; audit: Audit[] }

const day = (s: string) => new Date(s).toLocaleDateString("en-PK", { dateStyle: "medium" });

/** Super Admin > Tenant Detail > Branches & Limits. Changes apply at once and never touch branch records. */
export function BranchLimitsCard({ tenantId }: { tenantId: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [limit, setLimit] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const show = useCallback((x: Data) => {
    setD(x);
    setLimit(x.allowance.override == null ? "" : String(x.allowance.override));
    setUnlimited(x.allowance.unlimited);
    setDisabled(x.allowance.disabled);
  }, []);
  const call = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    setError(null);
    setSaved(false);
    try {
      show(await branchAdminApi<Data>(action, { tenantId, ...body }));
      if (action !== "get") setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [tenantId, show]);
  useEffect(() => { void call("get"); }, [call]);

  if (!d) return <p className="text-sm text-neutral-500">{error ?? "Loading…"}</p>;
  const a = d.allowance;
  const pending = d.requests.filter((r) => r.status === "pending");

  async function decide(r: Req, approve: boolean) {
    if (approve) {
      const v = prompt(`New total number of branches (now ${a.limit ?? "unlimited"}, ${a.used} used, ${r.extra} more asked):`, String((a.limit ?? a.used) + r.extra));
      if (!v) return;
      await call("decide", { id: r.id, approve: true, limit: Number(v), note: "" });
    } else {
      const note = prompt("Reason for rejecting (the business sees it):");
      if (!note) return;
      await call("decide", { id: r.id, approve: false, note });
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-4">
        <Box label="Plan" value={a.planName ?? "—"} hint={`Plan includes ${a.planLimit}`} />
        <Box label="Branches" value={String(a.used)} hint={`${d.branches.filter((b) => b.status === "active").length} active`} />
        <Box label="Approved limit" value={a.limit == null ? "Unlimited" : String(a.limit)} hint={a.override != null ? "Override" : a.unlimited ? "Unlimited" : "Plan default"} />
        <Box label="Multi-branch" value={a.disabled ? "Off" : a.entitled ? "On" : "Not on plan"} hint={a.overLimit ? "Over the limit" : a.remaining == null ? "" : `${a.remaining} left`} />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">Limit for this business
          <input type="number" min={1} value={limit} disabled={unlimited} onChange={(e) => setLimit(e.target.value)} placeholder={`Plan: ${a.planLimit}`} className="w-28 rounded-lg border border-neutral-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />Unlimited</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />Turn multi-branch off</label>
        <Button variant="primary" onClick={() => void call("policy", { limit: limit === "" ? null : Number(limit), unlimited, disabled })}>Save limits</Button>
        {saved && <span className="text-xs text-emerald-700">Saved</span>}
      </div>
      <p className="text-[11px] text-neutral-500">Mavin Elite plans include 5 branches (the main branch counts). Blank uses the plan&apos;s number. Lowering the limit or turning multi-branch off never deletes or hides records: new branches are blocked, and with multi-branch off only the main branch is used.</p>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">{error}</p>}

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Capacity requests</p>
        {d.requests.length ? (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
            {d.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <b>{r.extra}</b> more · {day(r.createdAt)}{r.requestedBy ? ` · ${r.requestedBy}` : ""}{r.reason ? <span className="block text-xs text-neutral-500">{r.reason}</span> : null}
                  {r.status !== "pending" && <span className="block text-xs text-neutral-500">{r.status}{r.approvedLimit ? `: limit ${r.approvedLimit}` : ""}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</span>}
                </span>
                {r.status === "pending" ? (
                  <span className="flex gap-2">
                    <Button variant="primary" onClick={() => void decide(r, true)}>Approve</Button>
                    <Button onClick={() => void decide(r, false)}>Reject</Button>
                  </span>
                ) : <span className="text-xs text-neutral-500">{r.decidedAt ? day(r.decidedAt) : ""}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-neutral-500">No requests.</p>}
        {pending.length > 0 && <p className="mt-1 text-xs text-neutral-500">Approving raises the limit; the business adds the branches itself.</p>}
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Branches</p>
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {d.branches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>{b.name} <span className="text-xs text-neutral-500">{b.code}{b.isMain ? " · main" : ""} · {b.status}{b.capacityReleased ? " · place released" : ""}</span></span>
              {b.status === "archived" && !b.isMain && !b.capacityReleased && (
                <Button onClick={() => { const note = prompt(`Release ${b.name}'s place? Its records stay. Reason:`); if (note) void call("release", { branchId: b.id, note }); }}>Release place</Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <details className="rounded-lg border border-neutral-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-neutral-500">History</summary>
        <ul className="mt-2 divide-y divide-neutral-100 text-xs">
          {d.audit.map((x) => <li key={x.id} className="flex justify-between gap-2 py-1"><span>{x.action}{x.branchName ? ` · ${x.branchName}` : ""}</span><span className="text-neutral-500">{x.actor ?? ""} · {new Date(x.createdAt).toLocaleString("en-PK")}</span></li>)}
          {!d.audit.length && <li className="py-1 text-neutral-500">Nothing yet.</li>}
        </ul>
      </details>
    </div>
  );
}

function Box({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="text-base font-semibold text-neutral-900">{value}</p>
      {hint && <p className="text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}
