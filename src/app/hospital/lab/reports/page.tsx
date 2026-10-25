"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { LabReportModal } from "@/components/hospital/LabReportModal";
import {
  searchLabReports, getLabReport, labCapabilities,
  type SearchMode, type ReportSearchRow, type LabReport,
} from "@/lib/repo/labReports";

const MODES: { key: SearchMode; label: string; hint: string }[] = [
  { key: "auto", label: "Lab Invoice / Lab Number", hint: "LI26-000123-4 or LN26-000123-7" },
  { key: "invoice", label: "Lab Invoice Number", hint: "LI26-000123-4" },
  { key: "lab_no", label: "Unique Lab Number", hint: "LN26-000123-7" },
  { key: "order_no", label: "Lab Order Number", hint: "LAB-20261024-0001" },
  { key: "mrn", label: "Patient MRN", hint: "MR-000123" },
  { key: "external_ref", label: "Collection center reference", hint: "The center's own slip number" },
  { key: "name_phone", label: "Patient name or phone", hint: "At least 3 letters or digits" },
];

const STATUS_HELP: Record<string, string> = {
  "Registered (fee unpaid)": "The fee is not paid yet. Reception must take it before the lab can start.",
  "Sample Awaited": "The sample has not reached the lab yet.",
  "Sample Received": "The lab has the sample; results are not ready.",
  Processing: "The lab is processing the sample.",
  "Awaiting Verification": "Results are entered but not yet verified by a pathologist. They cannot be released or printed.",
  Cancelled: "This order was cancelled.",
  Superseded: "This order was replaced by a newer one.",
};

/** Lab Report Search: one central search for the hospital lab counter, every
 * collection center and other authorised staff. Only verified results print. */
export default function LabReportSearchPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<SearchMode>("auto");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ReportSearchRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState<ReportSearchRow | null>(null);
  const [report, setReport] = useState<LabReport | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void labCapabilities().then((c) => setAllowed(c.search)).catch(() => setAllowed(false));
  }, []);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (searching) return;
    setSearching(true);
    try {
      const r = await searchLabReports(query, mode);
      setRows(r.rows);
      setMessage(r.message);
    } catch (err) {
      setRows([]);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function open(row: ReportSearchRow, method: string) {
    try {
      setReport(await getLabReport(row.request.id, { checked: true, method }));
      setConfirming(null);
    } catch (err) {
      window.alert(`Could not open the report: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (allowed === false) {
    return (
      <div>
        <PageHeader title="Lab Reports" />
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">You do not have permission to search lab reports. Ask the administrator to give your login Lab Reports.</p>
      </div>
    );
  }

  const modeInfo = MODES.find((m) => m.key === mode)!;

  return (
    <div>
      <PageHeader title="Lab Reports" />
      <form onSubmit={(e) => void search(e)} className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] md:grid-cols-[16rem_1fr_auto]">
        <Field label="Search by">
          <Select value={mode} onChange={(e) => setMode(e.target.value as SearchMode)}>
            {MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label={modeInfo.label}>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={modeInfo.hint} autoFocus className="font-mono" />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="primary" disabled={searching || !query.trim()}><Search size={14} className="mr-1" />{searching ? "Searching…" : "Search"}</Button>
        </div>
      </form>

      {message && <p className="mb-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">{message}</p>}

      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.request.id} className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{r.patientName} <span className="text-xs font-normal text-neutral-500">{r.mrNo}</span></p>
                  <p className="text-xs text-neutral-600">
                    Lab No <span className="font-mono font-medium">{r.request.lab_no}</span> · Invoice <span className="font-mono font-medium">{r.request.invoice_no}</span>
                    {r.request.external_ref ? <> · Ref <span className="font-mono">{r.request.external_ref}</span></> : null}
                  </p>
                  <p className="text-xs text-neutral-500">Registered at {r.location}{r.reportDate ? ` · Reported ${r.reportDate}` : ""}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.printable ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{r.status}</span>
                  {r.printable ? (
                    <Button variant="primary" onClick={() => setConfirming(r)}>View report</Button>
                  ) : (
                    <span className="max-w-xs text-right text-xs text-neutral-500">{STATUS_HELP[r.status] ?? "Not ready yet."}</span>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.tests.map((t) => (
                  <span key={t.id} className={`rounded-full px-2 py-0.5 text-[11px] ${t.status === "reported" ? "bg-emerald-50 text-emerald-700" : t.status === "cancelled" ? "bg-neutral-100 text-neutral-400 line-through" : "bg-neutral-100 text-neutral-600"}`}>
                    {t.test_name} · {t.label} <span className="font-mono text-neutral-400">{t.order_no}</span>
                  </span>
                ))}
              </div>
              {r.printable && r.pending > 0 && (
                <p className="mt-2 text-xs text-amber-700">{r.pending} test{r.pending === 1 ? " is" : "s are"} not verified yet and will not be on the printed report.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {confirming && <IdentityCheck row={confirming} onCancel={() => setConfirming(null)} onConfirm={(method) => void open(confirming, method)} />}
      {report && <LabReportModal report={report} onClose={() => setReport(null)} />}
    </div>
  );
}

function IdentityCheck({ row, onCancel, onConfirm }: { row: ReportSearchRow; onCancel: () => void; onConfirm: (method: string) => void }) {
  const [method, setMethod] = useState("CNIC");
  const [checked, setChecked] = useState(false);
  return (
    <Modal title="Check the patient's identity" onClose={onCancel} width="max-w-md">
      <p className="mb-3 text-sm text-neutral-700">
        Before handing over the report of <b>{row.patientName}</b> ({row.mrNo}), check that the person is the patient or authorised by them.
      </p>
      <div className="mb-3">
        <Field label="Checked with">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CNIC">CNIC / ID card</option>
            <option value="Lab slip">Lab slip / invoice</option>
            <option value="Phone on file">Phone number on file</option>
            <option value="MR card">MR card</option>
          </Select>
        </Field>
      </div>
      <label className="mb-4 flex items-start gap-2 text-sm text-neutral-700">
        <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        I have checked the patient&apos;s identity.
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!checked} onClick={() => onConfirm(method)}>Open report</Button>
      </div>
    </Modal>
  );
}
