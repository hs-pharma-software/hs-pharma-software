"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { myAppraisals, acknowledgeAppraisal } from "@/lib/repo/hrRecords";
import { APPRAISAL_CRITERIA } from "@/config/facility";
import { err } from "@/components/hospital/quality/SafetyModals";
import type { Appraisal } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

/** A staff member reads and acknowledges their own appraisals. */
export default function MyAppraisalsPage() {
  const [rows, setRows] = useState<Appraisal[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await myAppraisals()); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  const ack = async (id: string) => {
    try { await acknowledgeAppraisal(id, comments[id]); void reload(); } catch (e) { err(e); }
  };
  return (
    <div>
      <PageHeader title="My appraisals" />
      {rows.length === 0 ? <div className={card}><p className="text-sm text-neutral-400">No finalized appraisals for you yet.</p></div> : (
        <div className="flex flex-col gap-4">
          {rows.map((x) => {
            const ratings = JSON.parse(x.ratings ?? "{}") as Record<string, number>;
            return (
              <div key={x.id} className={card}>
                <p className="text-sm font-semibold text-neutral-700">{x.period_from} to {x.period_to} · overall {x.overall}/5</p>
                <p className="mb-3 text-xs text-neutral-500">Appraised by {x.appraiser_name}</p>
                <div className="grid gap-1 text-sm sm:grid-cols-2">
                  {APPRAISAL_CRITERIA.map(([k, l]) => <p key={k} className="flex justify-between gap-2"><span>{l}</span><b className="tabular-nums">{ratings[k] ?? "—"}/5</b></p>)}
                </div>
                {x.strengths && <p className="mt-3 text-sm"><b>Strengths:</b> {x.strengths}</p>}
                {x.improvements && <p className="text-sm"><b>To improve:</b> {x.improvements}</p>}
                {x.goals && <p className="text-sm"><b>Goals:</b> {x.goals}</p>}
                {x.status === "final" ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <Field label="Your comments"><Textarea id={`ack-${x.id}`} rows={2} value={comments[x.id] ?? ""} onChange={(e) => setComments({ ...comments, [x.id]: e.target.value })} /></Field>
                    <div><Button variant="primary" onClick={() => ack(x.id)}>I have read this appraisal</Button></div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-emerald-700">Acknowledged {x.acknowledged_at?.slice(0, 10)}{x.staff_comments ? `: ${x.staff_comments}` : ""}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
