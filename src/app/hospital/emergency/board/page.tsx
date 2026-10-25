"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { erBoard, erIndicators, type ErBoardRow, type ErIndicators } from "@/lib/repo/emergency";
import { triageLevel, DISPOSITIONS, type Disposition } from "@/config/quality";
import { levelPill } from "@/components/hospital/record/EmergencyPanel";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import { err } from "@/components/hospital/quality/SafetyModals";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";

/** The emergency department board: patients waiting, most urgent first (MSDS COP-1). */
export default function ErBoardPage() {
  const [tab, setTab] = useState<"board" | "indicators">("board");
  return (
    <div>
      <PageHeader title="ER Board" actions={
        <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {([["board", "Patients"], ["indicators", "Indicators"]] as const).map(([t, l]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-rose-700 text-white" : "bg-white text-neutral-600"}`}>{l}</button>
          ))}
        </div>
      } />
      {tab === "board" ? <Board /> : <Indicators />}
    </div>
  );
}

function Board() {
  const [rows, setRows] = useState<ErBoardRow[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    const load = () => void erBoard().then(setRows).catch(err);
    load();
    const t = window.setInterval(load, 60000);
    return () => window.clearInterval(t);
  }, []);
  const untriaged = rows.filter((r) => !r.triage).length;
  const overdue = rows.filter((r) => r.overdue).length;
  return (
    <div className={card}>
      <p className="mb-3 text-sm text-neutral-600">
        {rows.length} in the emergency department{untriaged ? <> · <span className="font-medium text-rose-700">{untriaged} not triaged</span></> : null}
        {overdue ? <> · <span className="font-medium text-rose-700">{overdue} past the time to see a doctor</span></> : null}
        <span className="ml-2 text-xs text-neutral-400">Refreshes every minute.</span>
      </p>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No patients waiting in the emergency department.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Triage</th><th className={th}>Patient</th><th className={th}>Complaint</th><th className={th}>Arrived</th><th className={th}>Doctor</th><th className={th}>MLC</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const target = triageLevel(r.triage?.level)?.targetMin;
                return (
                  <tr key={r.episode_id} className={`border-t border-neutral-100 ${r.overdue || !r.triage ? "bg-rose-50/60" : ""}`}>
                    <td className={td}>{levelPill(r.triage?.level)}</td>
                    <td className={td}><Link className="font-medium text-neutral-800 hover:underline" href={`/hospital/episodes/view?id=${r.episode_id}`}>{r.patient_name}</Link><span className="block text-xs text-neutral-500">{r.mr_no} · {r.episode_no}</span></td>
                    <td className={td}>{r.triage?.chief_complaint ?? "—"}</td>
                    <td className={`${td} tabular-nums`}>{fmtWhen(r.arrived_at)}</td>
                    <td className={`${td} tabular-nums`}>
                      {r.triage?.seen_at ? <span className="text-emerald-700">Seen {fmtWhen(r.triage.seen_at)}</span>
                        : r.waiting_min !== null ? <span className={r.overdue ? "font-medium text-rose-700" : "text-amber-700"}>Waiting {r.waiting_min} min{target !== undefined ? ` (target ${target})` : ""}</span> : "—"}
                    </td>
                    <td className={td}>{r.mlc_no ? <span className="font-mono text-xs">{r.mlc_no}</span> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Indicators() {
  const [from, setFrom] = useState(() => localDate().slice(0, 8) + "01");
  const [to, setTo] = useState(localDate());
  const [ind, setInd] = useState<ErIndicators | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void erIndicators({ from, to }).then(setInd).catch(err);
  }, [from, to]);
  const min = (x: number | null) => (x === null ? "—" : `${x} min`);
  const pc = (x: number | null) => (x === null ? "—" : `${x}%`);
  return (
    <div className={card}>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From"><Input id="er-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input id="er-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {ind && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["Emergency visits", String(ind.visits), `${ind.triaged} triaged`],
              ["Arrival to triage (median)", min(ind.doorToTriageMedian), ""],
              ["Arrival to doctor (median)", min(ind.doorToDoctorMedian), ""],
              ["Seen within target", pc(ind.seenInTargetPct), "of triaged patients"],
              ["Left against advice / unseen", pc(ind.lamaPct), "of visits"],
              ["Less urgent than vitals suggested", String(ind.undertriageOverrides), "with a recorded reason"],
              ["Medico-legal cases", String(ind.mlcCases), ""],
            ] as [string, string, string][]).map(([l, n, sub]) => (
              <div key={l} className="rounded-xl bg-neutral-50 p-3">
                <p className="text-xs text-neutral-500">{l}</p>
                <p className="text-xl font-semibold tabular-nums">{n}</p>
                {sub && <p className="text-[11px] text-neutral-500">{sub}</p>}
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Triage level</th><th className={th}>Patients</th><th className={th}>Seen within target</th><th className={th}>Median wait for a doctor</th></tr></thead>
              <tbody>
                {ind.byLevel.map((b) => (
                  <tr key={b.level} className="border-t border-neutral-100 tabular-nums">
                    <td className={td}>{levelPill(b.level)}</td><td className={td}>{b.n}</td><td className={td}>{b.n ? `${b.seenInTarget} (${pc(b.seenPct)})` : "—"}</td><td className={td}>{min(b.medianWait)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(ind.dispositions).length > 0 && (
            <p className="text-xs text-neutral-600">
              {Object.entries(ind.dispositions).map(([k, v]) => `${DISPOSITIONS[k as Disposition] ?? k}: ${v}`).join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
