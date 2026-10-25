"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import {
  listDocuments, createDocument, updateDraft, approveDocument, reviseDocument, confirmReviewed, withdrawDocument, documentHistory, requiredDocumentStatus,
  type DocumentRow, type RequiredState,
} from "@/lib/repo/documents";
import { DOCUMENT_KINDS, DOCUMENT_REVIEW_YEARS, REQUIRED_DOCUMENTS, type DocumentKind } from "@/config/facility";
import { DESIGNATIONS } from "@/config/hospitalStaff";
import { err } from "@/components/hospital/quality/SafetyModals";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import type { ControlledDocument } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const pill = (label: string, cls: string) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
const STATUS: Record<ControlledDocument["status"], [string, string]> = {
  draft: ["Draft", "bg-amber-100 text-amber-800"], approved: ["Approved", "bg-emerald-100 text-emerald-700"], obsolete: ["Obsolete", "bg-neutral-200 text-neutral-600"],
};
const REQ: Record<RequiredState, [string, string]> = {
  approved: ["Approved", "bg-emerald-100 text-emerald-700"], review_overdue: ["Review overdue", "bg-rose-100 text-rose-700"],
  draft: ["Draft only", "bg-amber-100 text-amber-800"], missing: ["Missing", "bg-rose-100 text-rose-700"],
};

/** Controlled documents: policies, SOPs, protocols, plans, forms and job descriptions. */
export default function DocumentsPage() {
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [required, setRequired] = useState<Awaited<ReturnType<typeof requiredDocumentStatus>>>([]);
  const [kind, setKind] = useState<DocumentKind | "">("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ doc: ControlledDocument | null; standardKey?: string } | null>(null);
  const [open, setOpen] = useState<DocumentRow | null>(null);
  const [showRequired, setShowRequired] = useState(false);
  const reload = async () => {
    if (!isTauri()) return;
    try {
      const list = await listDocuments({ kind, search });
      setRows(list);
      setRequired(await requiredDocumentStatus());
      setOpen((o) => (o ? list.find((x) => x.doc_no === o.doc_no) ?? null : null));
    } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [kind, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const reqOk = required.filter((r) => r.state === "approved").length;
  return (
    <div>
      <PageHeader title="Documents" />
      <div className="flex flex-col gap-4">
        <div className={card}>
          <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowRequired((x) => !x)}>
            <span className="text-sm font-semibold text-neutral-700">Key documents: {reqOk} of {required.length} approved and in date</span>
            <span className="text-xs text-neutral-500">{showRequired ? "Hide" : "Show"}</span>
          </button>
          {showRequired && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {required.map((r) => (
                    <tr key={r.key} className="border-t border-neutral-100">
                      <td className={`${td} w-12 text-xs font-semibold text-neutral-500`}>{r.area}</td>
                      <td className={td}>{r.title}{r.doc ? <span className="ml-1 font-mono text-xs text-neutral-500">{r.doc.doc_no} v{r.doc.version}</span> : null}</td>
                      <td className={td}>{pill(REQ[r.state][0], REQ[r.state][1])}</td>
                      <td className={td}>{r.state === "missing" && <Button variant="ghost" onClick={() => setEditing({ doc: null, standardKey: r.key })}>Draft it</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className={card}>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Field label="Search"><Input id="doc-q" value={search} placeholder="Number or title" onChange={(e) => setSearch(e.target.value)} /></Field>
            <Field label="Type">
              <Select id="doc-k" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind | "")}><option value="">All</option>{Object.entries(DOCUMENT_KINDS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
            </Field>
            <p className="pb-2 text-[11px] text-neutral-400">Approved documents are reviewed every {DOCUMENT_REVIEW_YEARS} years.</p>
            <div className="ml-auto"><Button variant="primary" onClick={() => setEditing({ doc: null })}><Plus size={14} />New document</Button></div>
          </div>
          {rows.length === 0 ? <p className="text-sm text-neutral-400">No documents.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Number</th><th className={th}>Title</th><th className={th}>Version</th><th className={th}>Status</th><th className={th}>Review due</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                      <td className={`${td} font-mono text-xs`}>{r.doc_no}</td>
                      <td className={td}>{r.title}<span className="block text-xs text-neutral-500">{DOCUMENT_KINDS[r.kind as DocumentKind]?.[0]}{r.department ? ` · ${r.department}` : ""}</span></td>
                      <td className={`${td} tabular-nums`}>v{r.version}{r.draft_version ? <span className="block text-[11px] text-amber-700">v{r.draft_version} in draft</span> : null}</td>
                      <td className={td}>{pill(STATUS[r.status][0], STATUS[r.status][1])}</td>
                      <td className={`${td} tabular-nums ${r.review_overdue ? "font-medium text-rose-700" : ""}`}>{r.review_due_on ?? "—"}{r.review_overdue ? " · overdue" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {editing && <DocumentEditor doc={editing.doc} standardKey={editing.standardKey} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {open && <DocumentView row={open} onClose={() => setOpen(null)} onEdit={(d) => setEditing({ doc: d })} onChanged={reload} />}
    </div>
  );
}

function DocumentEditor({ doc, standardKey, onClose, onSaved }: { doc: ControlledDocument | null; standardKey?: string; onClose: () => void; onSaved: () => void }) {
  const req = REQUIRED_DOCUMENTS.find((r) => r.key === (doc?.standard_key ?? standardKey));
  const [v, setV] = useState({
    kind: (doc?.kind ?? (req ? "policy" : "")) as DocumentKind | "", title: doc?.title ?? req?.title ?? "", department: doc?.department ?? "",
    standardKey: doc?.standard_key ?? standardKey ?? "", designationKey: doc?.designation_key ?? "", body: doc?.body ?? "", fileRef: doc?.file_ref ?? "", changeNote: doc?.change_note ?? "",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    if (!v.kind) return window.alert("Choose the type of document.");
    const input = { ...v, kind: v.kind, standardKey: v.standardKey || null, designationKey: v.designationKey || null };
    try { await (doc ? updateDraft(doc.id, input) : createDocument(input)); onSaved(); } catch (e) { err(e); }
  };
  return (
    <Modal title={doc ? `${doc.doc_no} v${doc.version} (draft)` : "New document"} onClose={onClose} width="max-w-3xl">
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" required>
            <Select id="de-k" disabled={!!doc} value={v.kind} onChange={set("kind")}><option value="">Choose…</option>{Object.entries(DOCUMENT_KINDS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
          </Field>
          <Field label="Department"><Input id="de-dept" value={v.department} placeholder="Hospital-wide if empty" onChange={set("department")} /></Field>
        </div>
        <Field label="Title" required><Input id="de-title" value={v.title} onChange={set("title")} /></Field>
        {v.kind === "jd" ? (
          <Field label="For the designation" required>
            <Select id="de-desig" value={v.designationKey} onChange={set("designationKey")}><option value="">Choose…</option>{DESIGNATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select>
          </Field>
        ) : (
          <Field label="Is this one of the key documents?">
            <Select id="de-std" value={v.standardKey} onChange={set("standardKey")}><option value="">No</option>{REQUIRED_DOCUMENTS.map((r) => <option key={r.key} value={r.key}>{r.area} · {r.title}</option>)}</Select>
          </Field>
        )}
        <Field label="Content"><Textarea id="de-body" rows={14} value={v.body} placeholder={"1. Purpose\n2. Scope\n3. Responsibilities\n4. Procedure\n5. References"} onChange={set("body")} /></Field>
        <Field label="Or: reference of the signed copy (file / folder)"><Input id="de-file" value={v.fileRef} onChange={set("fileRef")} /></Field>
        {doc && doc.version > 1 && <Field label="What changed"><Input id="de-chg" value={v.changeNote} onChange={set("changeNote")} /></Field>}
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save draft</Button></div>
    </Modal>
  );
}

function DocumentView({ row, onClose, onEdit, onChanged }: { row: DocumentRow; onClose: () => void; onEdit: (d: ControlledDocument) => void; onChanged: () => Promise<void> }) {
  const [history, setHistory] = useState<ControlledDocument[]>([]);
  const [shown, setShown] = useState<ControlledDocument>(row);
  useEffect(() => {
    void documentHistory(row.doc_no).then((h) => { setHistory(h); setShown(h.find((x) => x.id === row.id) ?? row); }).catch(() => undefined);
  }, [row]);
  const run = async (f: () => Promise<unknown>) => { try { await f(); await onChanged(); } catch (e) { err(e); } };
  const draft = history.find((h) => h.status === "draft");
  const ask = (q: string, f: (answer: string) => Promise<unknown>) => { const a = window.prompt(q); if (a) void run(() => f(a)); };
  return (
    <Modal title={`${shown.doc_no} · ${shown.title}`} onClose={onClose} width="max-w-3xl">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {pill(`v${shown.version} ${STATUS[shown.status][0]}`, STATUS[shown.status][1])}
          <span className="text-xs text-neutral-500">
            Author {shown.author_name}{shown.approved_by_name ? ` · approved by ${shown.approved_by_name} ${fmtWhen(shown.approved_at)}` : ""}
            {shown.effective_on ? ` · effective ${shown.effective_on}` : ""}{shown.review_due_on ? ` · review by ${shown.review_due_on}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {shown.status === "draft" && <><Button variant="ghost" onClick={() => onEdit(shown)}>Edit draft</Button><Button variant="primary" onClick={() => run(() => approveDocument(shown.id))}>Approve</Button></>}
          {shown.status === "approved" && !draft && <Button onClick={() => ask("What is changing and why?", (a) => reviseDocument(shown.id, a))}>Start revision</Button>}
          {shown.status === "approved" && <Button variant="ghost" onClick={() => ask("What was checked in this review?", (a) => confirmReviewed(shown.id, a))}>Reviewed, no change</Button>}
          {shown.status !== "obsolete" && <Button variant="ghost" onClick={() => ask("Why is it being withdrawn?", (a) => withdrawDocument(shown.id, a))}>Withdraw</Button>}
        </div>
        {shown.change_note && <p className="whitespace-pre-wrap rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-600">{shown.change_note}</p>}
        {shown.file_ref && <p className="text-xs text-neutral-600">Signed copy: {shown.file_ref}</p>}
        {shown.body && <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-neutral-200 p-4 font-serif text-[13px] leading-relaxed">{shown.body}</div>}
        {history.length > 1 && (
          <div className="flex flex-wrap gap-1 text-xs">
            <span className="text-neutral-500">Versions:</span>
            {history.map((h) => (
              <button key={h.id} type="button" onClick={() => setShown(h)} className={`rounded-full px-2 py-0.5 ${h.id === shown.id ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-600"}`}>v{h.version} {h.status}</button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
