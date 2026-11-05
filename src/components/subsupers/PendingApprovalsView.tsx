"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { appLabel, money, ownerCall, when } from "@/lib/subSupersClient";
import { ListState, PaymentPill, StatusPill, errText } from "./shared";
import { RequestReviewModal } from "./RequestReviewModal";

/** Submitted customer setups waiting for the owner, oldest first. */
export function PendingApprovalsView() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await ownerCall<Record<string, unknown>[]>("pending"));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => void load()}>Refresh</Button></div>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <table className="w-full min-w-max text-sm">
          <thead className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] uppercase tracking-widest text-neutral-400">
            <tr>{["Submitted", "Distributor", "Customer", "Application / plan", "Expected", "Reported payment", "Status"].map((h) => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)} onClick={() => setOpenId(String(r.id))} className="cursor-pointer border-t border-neutral-100 align-top hover:bg-neutral-50">
                <td className="px-4 py-2.5 text-xs text-neutral-600">{when(r.submitted_at)}</td>
                <td className="px-4 py-2.5">{String(r.distributor_name)}{r.distributor_status === "suspended" && <p className="text-xs text-rose-700">Suspended</p>}</td>
                <td className="px-4 py-2.5"><p className="font-medium text-neutral-800">{String(r.business_name)}</p><p className="text-xs text-neutral-500">{String(r.owner_name ?? "")} · {String(r.phone ?? "")}</p></td>
                <td className="px-4 py-2.5 text-xs">{appLabel(r.app_id)}<br /><span className="text-neutral-500">{String(r.plan_name ?? "—")}</span></td>
                <td className="px-4 py-2.5 tabular-nums">{money(r.expected_amount)}</td>
                <td className="px-4 py-2.5 text-xs">{money(r.claimed_amount)}<br /><span className="text-neutral-500">{String(r.payment_reference ?? "no reference")} · {String(r.payment_date ?? "no date")}</span></td>
                <td className="px-4 py-2.5 space-y-1">
                  <StatusPill status={String(r.status)} /><br /><PaymentPill status={String(r.payment_status)} />
                  {Number(r.needs_owner_review) === 1 && <p className="max-w-[14rem] text-xs text-amber-800">Review: {String(r.owner_review_reason)}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ListState loading={loading} error={error} empty={!rows.length} emptyText="No setups waiting for approval." onRetry={() => void load()} />
      </div>
      {openId && <RequestReviewModal id={openId} onClose={() => { setOpenId(null); void load(); }} />}
    </div>
  );
}
