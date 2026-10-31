"use client";

import { useEffect, useState } from "react";
import { BedDouble } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { adviseAdmission, consultationsRepo } from "@/lib/repo/clinic";
import type { ClinicConsultation } from "@/lib/types-clinic";

const URGENCY = { routine: "Routine", urgent: "Urgent", emergency: "Emergency" } as const;

/** The consultant advises admission for indoor treatment: reason, ward /
 * room, expected stay and urgency. Printed on the consultation and shown to
 * reception on the dashboard. Advising on a new consultation saves it first. */
export function AdmissionAdvice({ consultationId, ensureSaved, canAdvise }: {
  consultationId: string | null;
  ensureSaved: () => Promise<string>;
  canAdvise: boolean;
}) {
  const [c, setC] = useState<ClinicConsultation | null>(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [ward, setWard] = useState("");
  const [days, setDays] = useState("");
  const [urgency, setUrgency] = useState<keyof typeof URGENCY>("routine");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isTauri() || !consultationId) return;
    void consultationsRepo.get(consultationId).then(setC).catch(() => setC(null));
  }, [consultationId]);

  const advised = Boolean(c?.admit_advised);
  function open() {
    setReason(c?.admit_reason ?? "");
    setWard(c?.admit_ward ?? "");
    setDays(c?.admit_days ? String(c.admit_days) : "");
    setUrgency((c?.admit_urgency as keyof typeof URGENCY) ?? "routine");
    setEditing(true);
  }

  async function save(withdraw = false) {
    setSaving(true);
    try {
      const id = consultationId ?? (await ensureSaved());
      setC(await adviseAdmission(id, withdraw ? null : { reason, ward, days: days ? Number(days) : null, urgency }));
      setEditing(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`mb-4 rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ${advised ? "bg-rose-50 ring-rose-200" : "bg-white ring-black/[0.04]"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-700"><BedDouble size={16} />Admission</h2>
        {!editing && (advised
          ? <div className="flex gap-2"><Button onClick={open}>Change</Button><Button variant="ghost" onClick={() => { if (window.confirm("Withdraw the admission advice?")) void save(true); }} disabled={saving}>Withdraw</Button></div>
          : <Button variant="primary" onClick={open} disabled={!canAdvise}>Advise admission</Button>)}
      </div>
      {advised && !editing && c && (
        <p className="mt-2 text-sm text-rose-900">
          <b>Admission advised</b> ({URGENCY[(c.admit_urgency as keyof typeof URGENCY) ?? "routine"]}): {c.admit_reason}
          {c.admit_ward ? ` · ${c.admit_ward}` : ""}{c.admit_days ? ` · about ${c.admit_days} day${c.admit_days === 1 ? "" : "s"}` : ""}
        </p>
      )}
      {!advised && !editing && <p className="mt-1 text-xs text-neutral-500">Advise admission for indoor treatment when needed; it prints on the consultation and reception sees it in today&apos;s queue.</p>}
      {editing && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-4"><Field label="Reason for admission" required><Input id="adm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Severe dehydration, IV fluids and observation" autoFocus /></Field></div>
          <Field label="Ward / room"><Input id="adm-ward" value={ward} onChange={(e) => setWard(e.target.value)} placeholder="e.g. General ward" /></Field>
          <Field label="Expected stay (days)"><Input id="adm-days" type="number" min="1" step="1" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
          <Field label="Urgency">
            <Select id="adm-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value as keyof typeof URGENCY)}>
              {Object.entries(URGENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <div className="flex items-end justify-end gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving || !reason.trim()}>{saving ? "Saving…" : "Save advice"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
