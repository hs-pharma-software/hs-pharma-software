"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { listCriticalAlerts, type CriticalRow } from "@/lib/repo/quality";
import { CRITICAL_NOTIFY_MINUTES, CRITICAL_LIMITS } from "@/config/quality";
import { NotifyCriticalModal, err } from "@/components/hospital/quality/SafetyModals";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import type { CriticalAlert } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";

/** Critical results waiting to be told to the clinician, and the log (MSDS COP-6). */
export default function CriticalResultsPage() {
  const [rows, setRows] = useState<CriticalRow[]>([]);
  const [status, setStatus] = useState<CriticalAlert["status"] | "">("pending");
  const [open, setOpen] = useState<CriticalRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listCriticalAlerts({ status })); } catch (e) { err(e); }
  };
  useEffect(() => {
    void reload();
    const t = window.setInterval(() => void reload(), 60000);
    return () => window.clearInterval(t);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <PageHeader title="Critical Results" />
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Show">
            <Select id="crit-st" value={status} onChange={(e) => setStatus(e.target.value as CriticalAlert["status"] | "")}>
              <option value="pending">Waiting to be told</option><option value="notified">Notified</option><option value="">All</option>
            </Select>
          </Field>
          <p className="max-w-xl pb-2 text-[11px] text-neutral-500">
            A verified lab result outside the critical limits appears here. Tell the responsible doctor or nurse within {CRITICAL_NOTIFY_MINUTES} minutes and record it with the read-back.
          </p>
        </div>
        {rows.length === 0 ? <p className="text-sm text-neutral-400">{status === "pending" ? "No critical results waiting." : "No critical results."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Result</th><th className={th}>Patient</th><th className={th}>Where</th><th className={th}>Detected</th><th className={th}>Notification</th><th className={th}></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const late = (r.minutes_open ?? 0) > CRITICAL_NOTIFY_MINUTES;
                  return (
                    <tr key={r.id} className={`border-t border-neutral-100 ${r.status === "pending" ? "bg-rose-50/60" : ""}`}>
                      <td className={td}><b>{r.test_name}</b><span className="block text-xs text-rose-700">{r.value}</span></td>
                      <td className={td}>
                        {r.episode_id ? <Link className="hover:underline" href={`/hospital/episodes/view?id=${r.episode_id}`}>{r.patient_name}</Link> : r.patient_name}
                        <span className="block text-xs text-neutral-500">{r.mr_no}{r.episode_no ? ` · ${r.episode_no}` : ""}</span>
                      </td>
                      <td className={td}>{r.location ?? "—"}</td>
                      <td className={`${td} tabular-nums`}>{fmtWhen(r.detected_at)}<span className="block text-xs text-neutral-500">{r.detected_by_name}</span></td>
                      <td className={`${td} tabular-nums`}>
                        {r.status === "pending"
                          ? <span className={late ? "font-medium text-rose-700" : "text-amber-700"}>Waiting {r.minutes_open} min</span>
                          : <>{r.notified_to} · {r.method}<span className={`block text-xs ${late ? "text-rose-700" : "text-neutral-500"}`}>after {r.minutes_open} min · {r.notified_by_name}</span></>}
                      </td>
                      <td className={td}>{r.status === "pending" && <Button variant="danger" onClick={() => setOpen(r)}>Record notification</Button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <details className="mt-4 text-xs text-neutral-500">
          <summary className="cursor-pointer">Critical limits checked automatically</summary>
          <p className="mt-1">{CRITICAL_LIMITS.map((l) => `${l.name}: ${[l.low !== undefined ? `< ${l.low}` : null, l.high !== undefined ? `> ${l.high}` : null].filter(Boolean).join(" or ")} ${l.unit}`.trim()).join(" · ")} · blood or CSF culture positive. Check these against the laboratory&apos;s own critical-value policy.</p>
        </details>
      </div>
      {open && <NotifyCriticalModal alert={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}
