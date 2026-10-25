/** Controlled documents (MSDS ROM / IMS document control): policies, SOPs,
 * protocols, plans, forms and job descriptions, each with a number, a
 * version and a review date.
 *
 *   draft -> approved (by the quality team, never by the author)
 *   approved -> a new draft revision -> approved: the old version becomes obsolete
 *   approved -> reviewed without change: the review date moves on
 *
 * Only one version of a document is approved at a time, and old versions
 * stay in the history. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { nowIso } from "../id";
import { localDate } from "../localDate";
import { currentActor, roleAllowed, type Actor } from "./medicalRecord";
import { stamp } from "./emergency";
import { addDays } from "./facility";
import { DOCUMENT_AUTHOR_ROLES, QUALITY_ROLES, designation } from "../../config/hospitalStaff";
import { DOCUMENT_KINDS, DOCUMENT_REVIEW_YEARS, REQUIRED_DOCUMENTS, type DocumentKind } from "../../config/facility";
import type { ControlledDocument } from "../types-hospital";

export const documentsRepo = createTenantRepo<ControlledDocument>("hospital_documents");

async function needAuthor(): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed([...DOCUMENT_AUTHOR_ROLES, ...QUALITY_ROLES], a)) throw new Error("Documents are drafted by the quality team, heads of department and HR.");
  return a;
}
async function needApprover(): Promise<Actor> {
  const a = await currentActor();
  if (!roleAllowed(QUALITY_ROLES, a)) throw new Error("Documents are approved by the quality team (Quality Manager, Nursing Superintendent, HoD).");
  return a;
}
const isDate = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const reviewDue = (from: string) => addDays(from, Math.round(DOCUMENT_REVIEW_YEARS * 365.25));

async function nextDocNo(kind: DocumentKind): Promise<string> {
  const prefix = DOCUMENT_KINDS[kind][1];
  const tenantId = requireCurrentTenantId();
  const rows = await dbSelect<{ n: number }>(`SELECT COUNT(DISTINCT doc_no) AS n FROM hospital_documents WHERE tenant_id = ? AND doc_no LIKE ?`, [tenantId, `${prefix}-%`]);
  let n = (rows[0]?.n ?? 0) + 1;
  for (;;) {
    const no = `${prefix}-${String(n).padStart(3, "0")}`;
    if (!(await dbSelect(`SELECT 1 FROM hospital_documents WHERE tenant_id = ? AND doc_no = ?`, [tenantId, no])).length) return no;
    n++;
  }
}

export interface DocumentInput {
  kind: DocumentKind; title: string; department?: string | null; standardKey?: string | null; designationKey?: string | null;
  body?: string | null; fileRef?: string | null; changeNote?: string | null;
}

function payloadOf(d: DocumentInput): Partial<ControlledDocument> {
  if (!DOCUMENT_KINDS[d.kind]) throw new Error("Choose the type of document.");
  if (!d.title?.trim()) throw new Error("Enter the title.");
  if (!d.body?.trim() && !d.fileRef?.trim()) throw new Error("Write the content, or give the reference of the signed file.");
  if (d.kind === "jd" && !designation(d.designationKey)) throw new Error("Choose the designation the job description is for.");
  if (d.standardKey && !REQUIRED_DOCUMENTS.some((r) => r.key === d.standardKey)) throw new Error("Unknown required document.");
  return {
    kind: d.kind, title: d.title.trim(), department: d.department?.trim() || null, standard_key: d.standardKey || null,
    designation_key: d.kind === "jd" ? d.designationKey! : null, body: d.body?.trim() || null, file_ref: d.fileRef?.trim() || null,
    change_note: d.changeNote?.trim() || null,
  };
}

export async function createDocument(d: DocumentInput): Promise<ControlledDocument> {
  const a = await needAuthor();
  const payload = payloadOf(d);
  return documentsRepo.create({ ...payload, doc_no: await nextDocNo(d.kind), version: 1, status: "draft", author_name: stamp(a), supersedes_id: null });
}

async function doc(id: string): Promise<ControlledDocument> {
  const x = await documentsRepo.get(id);
  if (!x) throw new Error("Document not found.");
  return x;
}

export async function updateDraft(id: string, d: DocumentInput): Promise<ControlledDocument> {
  const a = await needAuthor();
  const x = await doc(id);
  if (x.status !== "draft") throw new Error("Only a draft can be edited. Start a revision to change an approved document.");
  const payload = payloadOf({ ...d, kind: x.kind as DocumentKind });
  return (await documentsRepo.update(id, { ...payload, author_name: stamp(a) }))!;
}

export async function approveDocument(id: string, opts: { effectiveOn?: string | null } = {}): Promise<ControlledDocument> {
  const a = await needApprover();
  const x = await doc(id);
  if (x.status !== "draft") throw new Error("Only a draft is approved.");
  if (x.author_name === stamp(a)) throw new Error("A document is approved by someone other than its author.");
  const effective = opts.effectiveOn || localDate();
  if (!isDate(effective)) throw new Error("Check the effective date.");
  const current = (await documentsRepo.list({ where: "doc_no = ? AND status = 'approved'", params: [x.doc_no] }))[0];
  if (current) await documentsRepo.update(current.id, { status: "obsolete" });
  return (await documentsRepo.update(id, { status: "approved", approved_by_name: stamp(a), approved_at: nowIso(), effective_on: effective, review_due_on: reviewDue(effective) }))!;
}

/** A new draft version of an approved document; the approved one stays in use until the draft is approved. */
export async function reviseDocument(id: string, changeNote: string): Promise<ControlledDocument> {
  const a = await needAuthor();
  const x = await doc(id);
  if (x.status !== "approved") throw new Error("Revise the approved version.");
  if (!changeNote?.trim()) throw new Error("Say what is changing and why.");
  const drafts = await documentsRepo.list({ where: "doc_no = ? AND status = 'draft'", params: [x.doc_no] });
  if (drafts.length) throw new Error(`Version ${drafts[0].version} of ${x.doc_no} is already being drafted.`);
  return documentsRepo.create({
    doc_no: x.doc_no, title: x.title, kind: x.kind, department: x.department, standard_key: x.standard_key, designation_key: x.designation_key,
    version: x.version + 1, status: "draft", body: x.body, file_ref: x.file_ref, change_note: changeNote.trim(), author_name: stamp(a), supersedes_id: x.id,
  });
}

/** The scheduled review found the document still correct: its review date moves on. */
export async function confirmReviewed(id: string, note: string): Promise<ControlledDocument> {
  const a = await needApprover();
  const x = await doc(id);
  if (x.status !== "approved") throw new Error("Only an approved document is reviewed.");
  if (!note?.trim()) throw new Error("Note what was checked in the review.");
  const today = localDate();
  return (await documentsRepo.update(id, {
    review_due_on: reviewDue(today), change_note: [x.change_note, `${today} reviewed, no change: ${note.trim()} (${stamp(a)})`].filter(Boolean).join("\n"),
  }))!;
}

export async function withdrawDocument(id: string, reason: string): Promise<ControlledDocument> {
  const a = await needApprover();
  const x = await doc(id);
  if (x.status === "obsolete") throw new Error("Already withdrawn.");
  if (!reason?.trim()) throw new Error("Give the reason for withdrawing it.");
  return (await documentsRepo.update(id, { status: "obsolete", change_note: [x.change_note, `${localDate()} withdrawn: ${reason.trim()} (${stamp(a)})`].filter(Boolean).join("\n") }))!;
}

export interface DocumentRow extends ControlledDocument {
  review_overdue: boolean;
  draft_version: number | null;
}

/** The register: each document's approved version (or its first draft), with any draft in progress. */
export async function listDocuments(opts: { kind?: DocumentKind | ""; search?: string; includeObsolete?: boolean } = {}, today: string = localDate()): Promise<DocumentRow[]> {
  const all = await documentsRepo.list({ orderBy: "doc_no ASC, version DESC" });
  const q = opts.search?.trim().toLowerCase();
  const byNo = new Map<string, ControlledDocument[]>();
  for (const d of all) byNo.set(d.doc_no, [...(byNo.get(d.doc_no) ?? []), d]);
  const rows: DocumentRow[] = [];
  for (const versions of byNo.values()) {
    const approved = versions.find((v) => v.status === "approved");
    const draft = versions.find((v) => v.status === "draft");
    const shown = approved ?? draft ?? (opts.includeObsolete ? versions[0] : null);
    if (!shown) continue;
    if (opts.kind && shown.kind !== opts.kind) continue;
    if (q && !`${shown.doc_no} ${shown.title} ${shown.department ?? ""}`.toLowerCase().includes(q)) continue;
    rows.push({ ...shown, review_overdue: shown.status === "approved" && !!shown.review_due_on && shown.review_due_on < today, draft_version: approved && draft ? draft.version : null });
  }
  return rows;
}

export async function documentHistory(docNo: string): Promise<ControlledDocument[]> {
  return documentsRepo.list({ where: "doc_no = ?", params: [docNo], orderBy: "version DESC" });
}

export type RequiredState = "approved" | "review_overdue" | "draft" | "missing";
/** Each document the hospital is expected to have, and whether it is approved and in date. */
export async function requiredDocumentStatus(today: string = localDate()): Promise<{ key: string; title: string; area: string; state: RequiredState; doc: ControlledDocument | null }[]> {
  const all = await documentsRepo.list({ where: "standard_key IS NOT NULL AND status != 'obsolete'" });
  return REQUIRED_DOCUMENTS.map((r) => {
    const mine = all.filter((d) => d.standard_key === r.key);
    const approved = mine.find((d) => d.status === "approved") ?? null;
    const draft = mine.find((d) => d.status === "draft") ?? null;
    const state: RequiredState = approved ? (approved.review_due_on && approved.review_due_on < today ? "review_overdue" : "approved") : draft ? "draft" : "missing";
    return { ...r, state, doc: approved ?? draft };
  });
}

/** The approved job description of a designation, if any. */
export async function jobDescriptionFor(designationKey: string): Promise<ControlledDocument | null> {
  return (await documentsRepo.list({ where: "kind = 'jd' AND designation_key = ? AND status = 'approved'", params: [designationKey] }))[0] ?? null;
}
