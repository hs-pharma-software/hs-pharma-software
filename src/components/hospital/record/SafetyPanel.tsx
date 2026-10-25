"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { listCriticalAlerts, type CriticalRow } from "@/lib/repo/quality";
import { fmtWhen } from "./FormEditor";
import { ReportIncidentModal, ComplaintModal, NotifyCriticalModal, RaiseCriticalModal } from "../quality/SafetyModals";
import type { HospitalEpisode } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

/** Critical results of this visit, and reporting an incident or complaint from it. */
export function SafetyPanel({ episode }: { episode: HospitalEpisode }) {
  const [alerts, setAlerts] = useState<CriticalRow[]>([]);
  const [modal, setModal] = useState<"incident" | "complaint" | "critical" | null>(null);
  const [notifying, setNotifying] = useState<CriticalRow | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const load = () => listCriticalAlerts({ episodeId: episode.id }).then(setAlerts).catch(() => undefined);
  useEffect(() => { void load(); }, [episode.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (msg: string) => () => { setModal(null); setNotifying(null); setSaved(msg); void load(); };
  const pending = alerts.filter((a) => a.status === "pending");

  return (
    <div className={`${card} ${pending.length ? "ring-2 ring-rose-300" : ""}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700"><ShieldAlert size={14} className="text-rose-600" />Patient safety</h2>
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" onClick={() => setModal("critical")}>Raise critical result</Button>
          <Button variant="ghost" onClick={() => setModal("incident")}>Report incident</Button>
          <Button variant="ghost" onClick={() => setModal("complaint")}>Record complaint</Button>
        </div>
      </div>
      {saved && <p className="mb-2 text-xs text-emerald-700">{saved}</p>}
      {alerts.length === 0 ? <p className="text-sm text-neutral-400">No critical results on this visit.</p> : (
        <ul className="flex flex-col gap-2 text-sm">
          {alerts.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 ${a.status === "pending" ? "bg-rose-50" : "bg-neutral-50"}`}>
              <span>
                <b>{a.test_name}</b>: {a.value}
                <span className="block text-xs text-neutral-500">
                  {fmtWhen(a.detected_at)} · {a.detected_by_name}
                  {a.status === "notified" ? ` · told ${a.notified_to} by ${a.method?.toLowerCase()} (read back) at ${fmtWhen(a.notified_at)}` : ""}
                </span>
              </span>
              {a.status === "pending" && <Button variant="danger" onClick={() => setNotifying(a)}>Record notification</Button>}
            </li>
          ))}
        </ul>
      )}
      {modal === "incident" && <ReportIncidentModal episode={episode} onClose={() => setModal(null)} onSaved={done("Incident reported to the quality team.")} />}
      {modal === "complaint" && <ComplaintModal episode={episode} onClose={() => setModal(null)} onSaved={done("Complaint recorded.")} />}
      {modal === "critical" && <RaiseCriticalModal episode={episode} onClose={() => setModal(null)} onSaved={done("Critical result raised.")} />}
      {notifying && <NotifyCriticalModal alert={notifying} onClose={() => setNotifying(null)} onSaved={done("Notification recorded.")} />}
    </div>
  );
}
