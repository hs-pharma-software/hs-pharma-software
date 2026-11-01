"use client";

import { Fragment, useEffect, useState } from "react";
import { Microscope } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { ClinicReportModal } from "@/components/clinic/ClinicPrints";
import { VisitProgress, PRIORITY_CLS } from "@/components/lab/labUi";
import { isTauri } from "@/lib/platform";
import { parseComponents } from "@/config/labPanels";
import { getLabVisit, listLabVisits, returnForRecheck, verifyLabResults, type LabVisitDetail, type LabVisitRow } from "@/lib/repo/lab";

const FLAG: Record<string, string> = { H: "High", L: "Low", N: "" };

/** Pathologist: results waiting for verification. Verified results are
 * released as the report; a doubtful one goes back to the technologist. */
export default function LabVerifyPage() {
  const [rows, setRows] = useState<LabVisitRow[]>([]);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<LabVisitDetail | null>(null);
  const [printing, setPrinting] = useState<string[] | null>(null);

  async function reload() {
    if (isTauri()) setRows(await listLabVisits({ stage: "verify", term }).catch(() => []));
  }
  useEffect(() => {
    const t = setTimeout(() => void reload(), 250);
    return () => clearTimeout(t);
  }, [term]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns: Column<LabVisitRow>[] = [
    { header: "Visit", render: (v) => <span className="font-mono text-xs">{v.visit_no}</span> },
    { header: "Patient", render: (v) => <span><span className="font-medium">{v.patient_name}</span> <span className="text-xs text-neutral-500">{[v.mrn, v.gender].filter(Boolean).join(" · ")}</span></span> },
    { header: "Referred by", render: (v) => v.referred_by ?? "—" },
    { header: "Priority", render: (v) => <span className={`text-xs font-semibold uppercase ${PRIORITY_CLS[v.priority] ?? ""}`}>{v.priority}</span> },
    { header: "Progress", render: (v) => <VisitProgress v={v} /> },
    {
      header: "",
      render: (v) => (
        <button type="button" title="Review and verify" aria-label="Review and verify" onClick={(e) => { e.stopPropagation(); void getLabVisit(v.id).then(setOpen); }} className="rounded-full bg-neutral-900 p-1.5 text-white hover:bg-neutral-700"><Microscope size={15} /></button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Pathologist" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      <Input id="lv-search" className="mb-3 max-w-sm" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search patient, MRN, mobile or visit…" />
      <DataTable columns={columns} rows={rows} onRowClick={(v) => void getLabVisit(v.id).then(setOpen)} emptyMessage="Nothing to verify. Results entered by the technologist appear here." />
      {open && (
        <VerifyModal
          detail={open}
          onClose={() => { setOpen(null); void reload(); }}
          onReleased={(ids) => { setOpen(null); void reload(); setPrinting(ids); }}
        />
      )}
      {printing && <ClinicReportModal orderIds={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

function VerifyModal({ detail, onClose, onReleased }: { detail: LabVisitDetail; onClose: () => void; onReleased: (reportedIds: string[]) => void }) {
  const waiting = detail.orders.filter((o) => o.status === "performed");
  const [selected, setSelected] = useState<string[]>(waiting.map((o) => o.id));
  const [note, setNote] = useState("");
  const [recheck, setRecheck] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(waiting);

  async function verify() {
    setBusy(true);
    try {
      await verifyLabResults(selected, note);
      const d = await getLabVisit(detail.visit.id);
      onReleased(d.orders.filter((o) => o.status === "reported").map((o) => o.id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendBack() {
    if (!recheck) return;
    setBusy(true);
    try {
      await returnForRecheck(recheck.id, recheck.reason);
      setLeft((l) => l.filter((o) => o.id !== recheck.id));
      setSelected((s) => s.filter((x) => x !== recheck.id));
      setRecheck(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const p = detail.patient;
  return (
    <Modal title={`Verify: ${p?.name ?? ""}`} onClose={onClose} width="max-w-4xl">
      <p className="mb-3 text-sm text-neutral-600">
        {detail.visit.visit_no} · {[p?.mrn, p?.gender, p?.dob].filter(Boolean).join(" · ")}{detail.visit.referred_by ? ` · Ref: ${detail.visit.referred_by}` : ""}
      </p>
      {left.length === 0 ? <p className="py-4 text-sm text-neutral-500">Nothing left to verify on this visit.</p> : (
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="w-8 pb-1" /><th className="pb-1">Test / parameter</th><th className="pb-1">Result</th><th className="pb-1">Unit</th><th className="pb-1">Normal range</th><th className="pb-1">Flag</th><th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {left.map((o) => {
                const parts = parseComponents(o.components);
                return (
                  <Fragment key={o.id}>
                    <tr className="border-b border-neutral-100 bg-neutral-50/60">
                      <td className="py-1.5"><input type="checkbox" aria-label={`Verify ${o.name}`} checked={selected.includes(o.id)} onChange={() => setSelected((s) => (s.includes(o.id) ? s.filter((x) => x !== o.id) : [...s, o.id]))} /></td>
                      <td className="py-1.5 font-semibold" colSpan={parts.length ? 5 : 1}>{o.name}<span className="ml-2 text-xs font-normal text-neutral-500">by {o.collected_by ?? "technologist"}</span></td>
                      {!parts.length && <>
                        <td className={`py-1.5 font-semibold ${o.flag === "H" || o.flag === "L" ? "text-rose-700" : ""}`}>{o.result_value}</td>
                        <td className="py-1.5">{o.unit ?? ""}</td><td className="py-1.5">{o.ref_range ?? ""}</td><td className="py-1.5">{o.flag ? FLAG[o.flag] : ""}</td>
                      </>}
                      <td className="py-1.5 text-right"><button type="button" onClick={() => setRecheck({ id: o.id, reason: "" })} className="text-xs text-amber-700 hover:underline">Send back</button></td>
                    </tr>
                    {parts.map((c) => (
                      <tr key={c.key} className="border-b border-neutral-50">
                        <td /><td className="py-1 pl-3">{c.name}</td>
                        <td className={`py-1 font-semibold tabular-nums ${c.flag === "H" || c.flag === "L" ? "text-rose-700" : ""}`}>{c.value}</td>
                        <td className="py-1">{c.unit ?? ""}</td><td className="py-1">{c.ref_range ?? ""}</td><td className="py-1">{c.flag ? FLAG[c.flag] : ""}</td><td />
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {recheck && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
          <div className="min-w-[16rem] flex-1"><Field label={`Recheck ${left.find((o) => o.id === recheck.id)?.name ?? ""}: why?`}><Input id="lv-recheck" autoFocus value={recheck.reason} onChange={(e) => setRecheck({ ...recheck, reason: e.target.value })} placeholder="e.g. Haemolysed sample, repeat" /></Field></div>
          <Button onClick={() => setRecheck(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => void sendBack()} disabled={busy || !recheck.reason.trim()}>Send back</Button>
        </div>
      )}
      {left.length > 0 && (
        <div className="mt-3">
          <Field label="Comments on the report (optional)"><Textarea id="lv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Correlate clinically. Advise HbA1c." /></Field>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        {left.length > 0 && <Button variant="primary" onClick={() => void verify()} disabled={busy || !selected.length}>{busy ? "Saving…" : `Verify and release ${selected.length}`}</Button>}
      </div>
    </Modal>
  );
}
