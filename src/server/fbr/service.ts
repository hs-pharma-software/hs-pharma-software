/** FBR Digital Invoicing through MAVIN's server.
 *
 * Every attempt to send a document is recorded in fbr_submissions BEFORE it
 * is sent; a partial unique index allows one live attempt (pending, uncertain
 * or accepted) per document and environment, so double clicks, two tabs or
 * two devices cannot send the same invoice twice.
 *
 * Routes:
 * - gateway: MAVIN's server sends it through the FBR gateway (static IP).
 * - direct:  no gateway configured; the browser sends it (as before) and
 *            reports FBR's answer back here (finish), still recorded.
 *
 * An unclear outcome (timeout, dropped connection, server error) is never
 * sent again automatically: a person checks FBR and resolves it. */
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "@/server/db";
import type { Sql } from "@/server/subSupers";
import { callerCan, type Caller } from "@/server/sqlPolicy";
import type { BranchScope } from "@/server/branches";
import { FBR_REFERENCE_PATH, interpretFbrSubmit, UNCERTAIN_MESSAGE, type FbrOutcome } from "@/lib/fbrResponse";
import { normalizeNtn } from "@/lib/fbrData";
import { gatewaySettings, tenantRef, viaGateway, type Environment, type GatewayOutcome, type GatewaySettings } from "./gatewayClient";
import { openToken, sealToken, tokenHint, tokenStorageReady } from "./secretBox";

export interface FbrDeps {
  now?: () => Date;
  /** null: direct mode. Undefined: from the environment. */
  gateway?: GatewaySettings | null;
  fetchImpl?: typeof fetch;
}

export type DocType = "invoice" | "es_doc";
export type SubmissionStatus = "pending" | "accepted" | "rejected" | "uncertain" | "not_received";
/** A "pending" attempt older than this lost its sender (browser closed, server stopped): treated as uncertain. */
export const STALE_PENDING_MS = 3 * 60_000;

const iso = (d: Date) => d.toISOString();
const gw = (deps: FbrDeps) => (deps.gateway === undefined ? gatewaySettings() : deps.gateway);
const routeOf = (deps: FbrDeps): "gateway" | "direct" => (gw(deps) ? "gateway" : "direct");

// ── Who may do what ──────────────────────────────────────────────────────

function tenantOf(caller: Caller): string {
  if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
  return caller.tenantId;
}
/** Settings > FBR: the owner, staff with the Settings section, or the Super Admin (for any business). */
export const canManage = (c: Caller) => c.role === "super_admin" || c.role === "owner" || (c.role === "staff" && (c.permissions == null || c.permissions.includes("settings")));

/** The business whose FBR settings are meant: the caller's own; the Super Admin names one. */
async function settingsTenant(sql: Sql, caller: Caller, input: { tenantId?: unknown }): Promise<string> {
  if (caller.role !== "super_admin") return tenantOf(caller);
  const id = typeof input.tenantId === "string" ? input.tenantId : "";
  if (!id || !(await sql.execute(`SELECT 1 FROM tenants WHERE id = ?`, [id])).rows.length) throw new HttpError(400, "Choose the business.");
  return id;
}
/** Submitting to FBR: the owner, or staff given "Submit to FBR". */
export const canSubmit = (c: Caller) => !!c.tenantId && c.role !== "super_admin" && callerCan(c, "invoice.fbr_submit");
/** Reference lookups (rates, units, SROs) for product forms. */
const canLookUp = (c: Caller) => canSubmit(c) || canManage(c) || c.role !== "staff" || c.permissions == null || c.permissions.includes("products");

// ── Settings and tokens ──────────────────────────────────────────────────

async function setting(sql: Sql, tenantId: string, key: string): Promise<string | null> {
  const r = await sql.execute(`SELECT value FROM settings WHERE key = ?`, [`${tenantId}::${key}`]);
  return (r.rows[0]?.value as string | null | undefined) ?? null;
}
async function environmentOf(sql: Sql, tenantId: string): Promise<Environment> {
  return (await setting(sql, tenantId, "fbr_environment")) === "production" ? "production" : "sandbox";
}
async function fbrAllowed(sql: Sql, tenantId: string): Promise<boolean> {
  const r = await sql.execute(`SELECT fbr_allowed FROM tenants WHERE id = ?`, [tenantId]);
  if (!r.rows.length) throw new HttpError(404, "Business not found.");
  return Number(r.rows[0].fbr_allowed ?? 1) !== 0;
}

interface Tokens { sandbox: string | null; production: string | null; sandboxHint: string | null; productionHint: string | null }

/** The business's tokens. Tokens typed before this version (plain text in
 * settings) are copied into encrypted storage the first time they are needed. */
export async function tokensOf(sql: Sql, tenantId: string, deps: FbrDeps = {}): Promise<Tokens> {
  const r = await sql.execute(`SELECT * FROM fbr_credentials WHERE tenant_id = ?`, [tenantId]);
  const row = r.rows[0];
  if (row) {
    return {
      sandbox: openToken(row.sandbox_token_enc as string | null), production: openToken(row.production_token_enc as string | null),
      sandboxHint: (row.sandbox_hint as string | null) ?? null, productionHint: (row.production_hint as string | null) ?? null,
    };
  }
  const sb = (await setting(sql, tenantId, "fbr_sandbox_token"))?.trim() || null;
  const pr = (await setting(sql, tenantId, "fbr_production_token"))?.trim() || null;
  if ((sb || pr) && tokenStorageReady()) {
    const t = iso((deps.now ?? (() => new Date()))());
    await sql.execute(
      `INSERT OR IGNORE INTO fbr_credentials (tenant_id, sandbox_token_enc, production_token_enc, sandbox_hint, production_hint, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'copied-from-settings', ?, ?)`,
      [tenantId, sb ? sealToken(sb) : null, pr ? sealToken(pr) : null, sb ? tokenHint(sb) : null, pr ? tokenHint(pr) : null, t, t],
    );
  }
  return { sandbox: sb, production: pr, sandboxHint: sb ? tokenHint(sb) : null, productionHint: pr ? tokenHint(pr) : null };
}

export async function config(sql: Sql, caller: Caller, deps: FbrDeps = {}, input: { tenantId?: unknown } = {}) {
  const T = await settingsTenant(sql, caller, input);
  const k = await tokensOf(sql, T, deps);
  return {
    route: routeOf(deps), hasSandbox: !!k.sandbox, hasProduction: !!k.production,
    sandboxHint: canManage(caller) ? k.sandboxHint : null, productionHint: canManage(caller) ? k.productionHint : null,
    canManage: canManage(caller), canSubmit: canSubmit(caller), storageReady: tokenStorageReady(),
  };
}

const TOKEN_RE = /^[^\s]{8,500}$/;

/** Saves (or clears with "") the tokens, encrypted. The old plain-text copies in settings are removed. */
export async function saveTokens(sql: Sql, caller: Caller, input: { sandbox?: unknown; production?: unknown; tenantId?: unknown }, deps: FbrDeps = {}) {
  const T = await settingsTenant(sql, caller, input);
  if (!canManage(caller)) throw new HttpError(403, "Only the owner (or staff with Settings) can change FBR tokens.");
  if (!tokenStorageReady()) throw new HttpError(503, "FBR token storage is not set up on the server yet (FBR_TOKEN_KEY).");
  const current = await tokensOf(sql, T, deps);
  const next = { sandbox: current.sandbox, production: current.production };
  for (const env of ["sandbox", "production"] as const) {
    const v = input[env];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") throw new HttpError(400, `The ${env} token must be text.`);
    const t = v.trim();
    if (t && !TOKEN_RE.test(t)) throw new HttpError(400, `The ${env} token does not look like an FBR token (no spaces, 8 to 500 characters).`);
    next[env] = t || null;
  }
  const now = iso((deps.now ?? (() => new Date()))());
  await sql.batch([
    {
      sql: `INSERT INTO fbr_credentials (tenant_id, sandbox_token_enc, production_token_enc, sandbox_hint, production_hint, updated_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id) DO UPDATE SET sandbox_token_enc = excluded.sandbox_token_enc, production_token_enc = excluded.production_token_enc,
              sandbox_hint = excluded.sandbox_hint, production_hint = excluded.production_hint, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      args: [T, next.sandbox ? sealToken(next.sandbox) : null, next.production ? sealToken(next.production) : null,
        next.sandbox ? tokenHint(next.sandbox) : null, next.production ? tokenHint(next.production) : null, caller.userId, now, now],
    },
    { sql: `DELETE FROM settings WHERE key IN (?, ?)`, args: [`${T}::fbr_sandbox_token`, `${T}::fbr_production_token`] },
  ]);
  return config(sql, caller, deps, { tenantId: T });
}

/** Token test on FBR's validate address (records nothing): the typed token, or the saved one. */
export async function testToken(sql: Sql, caller: Caller, input: { environment?: unknown; token?: unknown; tenantId?: unknown }, deps: FbrDeps = {}) {
  const T = await settingsTenant(sql, caller, input);
  if (!canManage(caller)) throw new HttpError(403, "Only the owner (or staff with Settings) can test FBR tokens.");
  const env: Environment = input.environment === "production" ? "production" : "sandbox";
  const typed = typeof input.token === "string" ? input.token.trim() : "";
  const token = typed || (await tokensOf(sql, T, deps))[env];
  if (!token) return { ok: false, message: `Enter the ${env} token first.` };
  const g = gw(deps);
  if (!g) return { direct: true, token, ok: false, message: "" };
  const r = await viaGateway(g, { environment: env, operation: "validate", token, tenantRef: tenantRef(T, g.secret), payload: {} }, { fetchImpl: deps.fetchImpl });
  if (r.outcome !== "response") return { ok: false, message: `${r.error} Try again.` };
  if (r.status === 401 || r.status === 403) return { ok: false, message: `FBR rejected this token for ${env} (HTTP ${r.status}). Check it is the ${env} token issued by PRAL, and that MAVIN's gateway IP is whitelisted.` };
  if (r.status >= 500) return { ok: false, message: `FBR server error (HTTP ${r.status}). Try again later.` };
  return { ok: true, message: `Token accepted by FBR ${env} through MAVIN's gateway (HTTP ${r.status}).` };
}

/** FBR's reference lookups (rates, units, SROs) with the business's token. */
export async function reference(sql: Sql, caller: Caller, input: { path?: unknown }, deps: FbrDeps = {}) {
  const T = tenantOf(caller);
  if (!canLookUp(caller)) throw new HttpError(403, "Your login cannot look up FBR data.");
  const path = typeof input.path === "string" ? input.path : "";
  if (!FBR_REFERENCE_PATH.test(path)) throw new HttpError(400, "This FBR lookup is not allowed.");
  const env = await environmentOf(sql, T);
  const token = (await tokensOf(sql, T, deps))[env];
  if (!token) throw new HttpError(400, `No FBR ${env} token in Settings > FBR.`);
  const g = gw(deps);
  if (!g) return { direct: true, token };
  const r = await viaGateway(g, { environment: env, operation: "reference", token, tenantRef: tenantRef(T, g.secret), referencePath: path }, { fetchImpl: deps.fetchImpl });
  if (r.outcome !== "response") throw new HttpError(502, r.error);
  return { status: r.status, body: r.body };
}

// ── Submissions ──────────────────────────────────────────────────────────

interface DocInfo { branchId: string | null; fbrInvoiceNo: string | null; deleted: boolean }

async function loadDoc(sql: Sql, tenantId: string, docType: DocType, docId: string): Promise<DocInfo | null> {
  const table = docType === "invoice" ? "invoices" : "es_docs";
  const r = await sql.execute(`SELECT branch_id, fbr_invoice_no, deleted_at FROM ${table} WHERE id = ? AND tenant_id = ?`, [docId, tenantId]);
  const row = r.rows[0];
  if (!row) return null;
  return { branchId: (row.branch_id as string | null) ?? null, fbrInvoiceNo: ((row.fbr_invoice_no as string | null) || null), deleted: row.deleted_at != null };
}

/** The FBR number on the document itself (only when it has none yet). */
async function writeDocNumber(sql: Sql, tenantId: string, docType: DocType, docId: string, fbrNo: string, now: string) {
  if (docType === "invoice") {
    await sql.execute(`UPDATE invoices SET fbr_invoice_no = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND (fbr_invoice_no IS NULL OR fbr_invoice_no = '')`, [fbrNo, now, docId, tenantId]);
  } else {
    await sql.execute(`UPDATE es_docs SET fbr_invoice_no = ?, fbr_status = 'accepted', updated_at = ? WHERE id = ? AND tenant_id = ? AND (fbr_invoice_no IS NULL OR fbr_invoice_no = '')`, [fbrNo, now, docId, tenantId]);
  }
}

export interface SubmitResult {
  success: boolean;
  fbrInvoiceNo: string | null;
  error: string | null;
  outcome: FbrOutcome | "not_received";
  submissionId: string | null;
  rawResponse: null;
  /** Direct mode: this browser sends it, then calls finish. */
  direct?: boolean;
  token?: string;
  environment?: Environment;
}
const result = (o: Partial<SubmitResult> & { outcome: SubmitResult["outcome"] }): SubmitResult => ({
  success: o.outcome === "accepted", fbrInvoiceNo: null, error: null, submissionId: null, rawResponse: null, ...o,
});

function docRef(input: { docType?: unknown; docId?: unknown }): { docType: DocType; docId: string } {
  const docType = input.docType === "invoice" || input.docType === "es_doc" ? input.docType : null;
  const docId = typeof input.docId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(input.docId) ? input.docId : null;
  if (!docType || !docId) throw new HttpError(400, "Say which document to submit.");
  return { docType, docId };
}

/** Records what happened to a pending (or stale, uncertain) attempt. */
async function record(sql: Sql, tenantId: string, row: { id: string; docType: DocType; docId: string }, sent: GatewayOutcome, now: Date): Promise<SubmitResult> {
  const t = iso(now);
  let status: SubmissionStatus;
  let fbrNo: string | null = null;
  let error: string | null = null;
  let http: number | null = null;
  let excerpt: string | null = null;
  if (sent.outcome === "response") {
    const i = interpretFbrSubmit(sent.status, sent.body);
    status = i.outcome;
    fbrNo = i.fbrInvoiceNo;
    error = i.error;
    http = sent.status;
    excerpt = sent.body.slice(0, 2000);
  } else if (sent.outcome === "not_sent") {
    status = "not_received";
    error = `${sent.error} Nothing reached FBR; it can be sent again.`;
  } else {
    status = "uncertain";
    error = `${sent.error} ${UNCERTAIN_MESSAGE}`;
  }
  await sql.execute(
    `UPDATE fbr_submissions SET status = ?, fbr_invoice_no = ?, http_status = ?, error = ?, response_excerpt = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'uncertain')`,
    [status, fbrNo, http, error, excerpt, t, row.id, tenantId],
  );
  if (status === "accepted" && fbrNo) await writeDocNumber(sql, tenantId, row.docType, row.docId, fbrNo, t);
  return result({ outcome: status as SubmitResult["outcome"], fbrInvoiceNo: fbrNo, error, submissionId: row.id });
}

/** Sends a document's FBR invoice (built by the browser from the document) once. */
export async function submit(
  sql: Sql, caller: Caller,
  input: { docType?: unknown; docId?: unknown; environment?: unknown; payload?: unknown },
  scope: BranchScope | undefined, deps: FbrDeps = {},
): Promise<SubmitResult> {
  const T = tenantOf(caller);
  if (!canSubmit(caller)) throw new HttpError(403, "Your login cannot submit invoices to FBR.");
  if (!(await fbrAllowed(sql, T))) throw new HttpError(403, "FBR Digital Invoicing is switched off for this business.");
  if ((await setting(sql, T, "fbr_enabled")) !== "true") throw new HttpError(400, "FBR Digital Invoicing is not enabled (Settings > FBR).");
  const { docType, docId } = docRef(input);
  const env = await environmentOf(sql, T);
  if (input.environment !== env) throw new HttpError(409, `FBR settings changed (now ${env}). Reload the page and try again.`);

  const doc = await loadDoc(sql, T, docType, docId);
  if (!doc) throw new HttpError(404, "Document not found.");
  if (doc.deleted) throw new HttpError(400, "A deleted document cannot go to FBR.");
  if (scope && doc.branchId && !scope.accessible.includes(doc.branchId)) throw new HttpError(403, "This document belongs to a branch your login cannot use.");
  if (doc.fbrInvoiceNo) return result({ outcome: "accepted", fbrInvoiceNo: doc.fbrInvoiceNo });

  const payload = input.payload as { sellerNTNCNIC?: unknown; items?: unknown } | null;
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 1000) {
    throw new HttpError(400, "The FBR invoice has no items.");
  }
  const body = JSON.stringify(payload);
  if (body.length > 500_000) throw new HttpError(413, "The FBR invoice is too large.");
  const sellerNtn = normalizeNtn(await setting(sql, T, "fbr_seller_ntn"));
  if (sellerNtn && normalizeNtn(String(payload.sellerNTNCNIC ?? "")) !== sellerNtn) {
    throw new HttpError(400, "The seller NTN on this invoice is not this business's NTN (Settings > FBR).");
  }
  const token = (await tokensOf(sql, T, deps))[env];
  if (!token) throw new HttpError(400, `No FBR ${env} token in Settings > FBR.`);

  // Claim: one live attempt per document and environment (the database refuses a second).
  const nowD = (deps.now ?? (() => new Date()))();
  const now = iso(nowD);
  const id = randomUUID();
  const route = routeOf(deps);
  try {
    await sql.execute(
      `INSERT INTO fbr_submissions (id, tenant_id, branch_id, doc_type, doc_id, environment, route, status, payload_hash, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [id, T, doc.branchId, docType, docId, env, route, createHash("sha256").update(body).digest("hex"), caller.userId, now, now],
    );
  } catch (e) {
    if (!/UNIQUE|constraint/i.test(String((e as Error)?.message))) throw e;
    return liveConflict(sql, T, docType, docId, env, nowD);
  }

  const g = gw(deps);
  if (!g) return result({ outcome: "uncertain", direct: true, token, environment: env, submissionId: id });
  const sent = await viaGateway(g, { environment: env, operation: "post", token, tenantRef: tenantRef(T, g.secret), payload }, { fetchImpl: deps.fetchImpl });
  return record(sql, T, { id, docType, docId }, sent, (deps.now ?? (() => new Date()))());
}

/** A live attempt already exists for this document: say what it is. */
async function liveConflict(sql: Sql, T: string, docType: DocType, docId: string, env: Environment, now: Date): Promise<SubmitResult> {
  const r = await sql.execute(
    `SELECT id, status, fbr_invoice_no, error, created_at FROM fbr_submissions WHERE tenant_id = ? AND doc_type = ? AND doc_id = ? AND environment = ? AND status IN ('pending', 'uncertain', 'accepted')`,
    [T, docType, docId, env],
  );
  const live = r.rows[0];
  if (!live) throw new HttpError(409, "Another submission of this document just changed. Try again.");
  const id = String(live.id);
  if (live.status === "accepted") {
    const no = String(live.fbr_invoice_no ?? "");
    if (no) await writeDocNumber(sql, T, docType, docId, no, iso(now));
    return result({ outcome: "accepted", fbrInvoiceNo: no || null, submissionId: id });
  }
  if (live.status === "pending" && now.getTime() - Date.parse(String(live.created_at)) < STALE_PENDING_MS) {
    return result({ outcome: "uncertain", submissionId: id, error: "This invoice is being sent to FBR right now (another click, tab or device). Wait a moment, then reload." });
  }
  if (live.status === "pending") {
    await sql.execute(`UPDATE fbr_submissions SET status = 'uncertain', error = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      [`The sender stopped before FBR's answer was saved. ${UNCERTAIN_MESSAGE}`, iso(now), id]);
  }
  return result({ outcome: "uncertain", submissionId: id, error: `An earlier attempt has no clear outcome. ${UNCERTAIN_MESSAGE}` });
}

/** Direct mode: the browser reports what FBR answered (or that no answer came). */
export async function finish(sql: Sql, caller: Caller, input: { submissionId?: unknown; report?: unknown }, deps: FbrDeps = {}): Promise<SubmitResult> {
  const T = tenantOf(caller);
  if (!canSubmit(caller)) throw new HttpError(403, "Your login cannot submit invoices to FBR.");
  const id = typeof input.submissionId === "string" ? input.submissionId : "";
  const r = await sql.execute(`SELECT id, doc_type, doc_id, route, status FROM fbr_submissions WHERE id = ? AND tenant_id = ?`, [id, T]);
  const row = r.rows[0];
  if (!row) throw new HttpError(404, "Submission not found.");
  if (row.route !== "direct") throw new HttpError(400, "This submission was sent by MAVIN's server.");
  if (row.status !== "pending" && row.status !== "uncertain") throw new HttpError(409, "This submission is already finished.");
  const rep = input.report as { kind?: unknown; status?: unknown; text?: unknown; error?: unknown } | null;
  let sent: GatewayOutcome;
  if (rep?.kind === "response" && typeof rep.status === "number" && typeof rep.text === "string") sent = { outcome: "response", status: rep.status, body: rep.text.slice(0, 200_000) };
  else sent = { outcome: "uncertain", error: typeof rep?.error === "string" ? rep.error.slice(0, 300) : "No answer reached this computer." };
  return record(sql, T, { id, docType: row.doc_type as DocType, docId: String(row.doc_id) }, sent, (deps.now ?? (() => new Date()))());
}

/** A person checked FBR (IRIS / PRAL portal) about an unclear attempt:
 * FBR does not have it (it can be sent again), or FBR has it under this number. */
export async function resolve(sql: Sql, caller: Caller, input: { submissionId?: unknown; resolution?: unknown; fbrInvoiceNo?: unknown }, deps: FbrDeps = {}) {
  const T = tenantOf(caller);
  if (!canSubmit(caller)) throw new HttpError(403, "Your login cannot submit invoices to FBR.");
  const now = (deps.now ?? (() => new Date()))();
  const id = typeof input.submissionId === "string" ? input.submissionId : "";
  const r = await sql.execute(`SELECT id, doc_type, doc_id, status, created_at FROM fbr_submissions WHERE id = ? AND tenant_id = ?`, [id, T]);
  const row = r.rows[0];
  if (!row) throw new HttpError(404, "Submission not found.");
  const stalePending = row.status === "pending" && now.getTime() - Date.parse(String(row.created_at)) >= STALE_PENDING_MS;
  if (row.status !== "uncertain" && !stalePending) throw new HttpError(409, "Only an attempt without a clear outcome can be resolved.");
  const t = iso(now);
  if (input.resolution === "not_received") {
    await sql.execute(`UPDATE fbr_submissions SET status = 'not_received', resolution = 'not_received', resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [caller.userId, t, t, id, T]);
    return { status: "not_received" as const };
  }
  if (input.resolution === "accepted") {
    const no = typeof input.fbrInvoiceNo === "string" ? input.fbrInvoiceNo.trim() : "";
    if (!/^[A-Za-z0-9-]{6,80}$/.test(no)) throw new HttpError(400, "Enter the FBR invoice number exactly as FBR shows it.");
    await sql.execute(`UPDATE fbr_submissions SET status = 'accepted', fbr_invoice_no = ?, resolution = 'accepted_by_user', resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [no, caller.userId, t, t, id, T]);
    await writeDocNumber(sql, T, row.doc_type as DocType, String(row.doc_id), no, t);
    return { status: "accepted" as const, fbrInvoiceNo: no };
  }
  throw new HttpError(400, "Choose: FBR does not have it, or enter the FBR invoice number.");
}

/** This business's recent attempts (a stale pending one shows as uncertain). */
export async function list(sql: Sql, caller: Caller, input: { docId?: unknown; problemsOnly?: unknown }, deps: FbrDeps = {}) {
  const T = tenantOf(caller);
  if (!canSubmit(caller) && !canManage(caller)) throw new HttpError(403, "Your login cannot see FBR submissions.");
  const now = (deps.now ?? (() => new Date()))().getTime();
  const args: unknown[] = [T];
  let where = `s.tenant_id = ?`;
  if (typeof input.docId === "string" && input.docId) { where += ` AND s.doc_id = ?`; args.push(input.docId); }
  if (input.problemsOnly === true) where += ` AND s.status IN ('pending', 'uncertain', 'rejected', 'not_received')`;
  const r = await sql.execute(
    `SELECT s.id, s.doc_type, s.doc_id, s.environment, s.route, s.status, s.fbr_invoice_no, s.http_status, s.error, s.resolution, s.created_at, s.updated_at,
            i.invoice_no, i.date AS doc_date, i.customer_name, i.payable
     FROM fbr_submissions s LEFT JOIN invoices i ON s.doc_type = 'invoice' AND i.id = s.doc_id AND i.tenant_id = s.tenant_id
     WHERE ${where} ORDER BY s.created_at DESC LIMIT 200`, args,
  );
  return r.rows.map((x): Record<string, unknown> => ({
    ...x,
    status: x.status === "pending" && now - Date.parse(String(x.created_at)) >= STALE_PENDING_MS ? "uncertain" : x.status,
  }));
}

// ── Super Admin ──────────────────────────────────────────────────────────

/** Gateway reachability and every business's FBR state (no tokens). */
export async function adminOverview(sql: Sql, caller: Caller, deps: FbrDeps = {}) {
  if (caller.role !== "super_admin") throw new HttpError(403, "Super Admin only.");
  const g = gw(deps);
  let gateway: { configured: boolean; ok: boolean | null; version?: string; uptimeSec?: number; ms?: number; error?: string } = { configured: !!g, ok: null };
  if (g) {
    const t0 = Date.now();
    try {
      const res = await (deps.fetchImpl ?? fetch)(`${g.url}/health`, { signal: AbortSignal.timeout(8000) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; version?: string; uptimeSec?: number };
      gateway = { configured: true, ok: res.ok && j.ok === true, version: j.version, uptimeSec: j.uptimeSec, ms: Date.now() - t0 };
    } catch (e) {
      gateway = { configured: true, ok: false, error: (e as Error)?.name === "TimeoutError" ? "No answer within 8 seconds." : "Not reachable.", ms: Date.now() - t0 };
    }
  }
  const since = iso(new Date((deps.now ?? (() => new Date()))().getTime() - 30 * 86_400_000));
  const tenants = await sql.execute(
    `SELECT t.id, t.name, t.fbr_allowed,
       (SELECT value FROM settings WHERE key = t.id || '::fbr_enabled') AS enabled,
       (SELECT value FROM settings WHERE key = t.id || '::fbr_environment') AS environment,
       (SELECT CASE WHEN c.sandbox_token_enc IS NOT NULL THEN 1 ELSE 0 END FROM fbr_credentials c WHERE c.tenant_id = t.id) AS has_sandbox,
       (SELECT CASE WHEN c.production_token_enc IS NOT NULL THEN 1 ELSE 0 END FROM fbr_credentials c WHERE c.tenant_id = t.id) AS has_production,
       (SELECT COUNT(*) FROM fbr_submissions s WHERE s.tenant_id = t.id AND s.status = 'accepted' AND s.created_at >= ?) AS accepted_30d,
       (SELECT COUNT(*) FROM fbr_submissions s WHERE s.tenant_id = t.id AND s.status = 'rejected' AND s.created_at >= ?) AS rejected_30d,
       (SELECT COUNT(*) FROM fbr_submissions s WHERE s.tenant_id = t.id AND (s.status = 'uncertain' OR s.status = 'pending')) AS open_uncertain,
       (SELECT MAX(created_at) FROM fbr_submissions s WHERE s.tenant_id = t.id AND s.status = 'accepted') AS last_accepted
     FROM tenants t
     WHERE EXISTS (SELECT 1 FROM settings WHERE key = t.id || '::fbr_enabled' AND value = 'true') OR EXISTS (SELECT 1 FROM fbr_submissions s WHERE s.tenant_id = t.id)
     ORDER BY t.name`, [since, since],
  );
  const problems = await sql.execute(
    `SELECT s.id, s.tenant_id, t.name AS tenant_name, s.doc_type, s.doc_id, s.environment, s.route, s.status, s.http_status, s.error, s.created_at
     FROM fbr_submissions s LEFT JOIN tenants t ON t.id = s.tenant_id
     WHERE s.status IN ('uncertain', 'rejected', 'not_received', 'pending') ORDER BY s.created_at DESC LIMIT 100`,
  );
  return { route: routeOf(deps), storageReady: tokenStorageReady(), gateway, tenants: tenants.rows, problems: problems.rows };
}

/** The address FBR sees the gateway's calls coming from (to give PRAL for whitelisting). */
export async function adminEgressIp(caller: Caller, deps: FbrDeps = {}) {
  if (caller.role !== "super_admin") throw new HttpError(403, "Super Admin only.");
  const g = gw(deps);
  if (!g) throw new HttpError(400, "No FBR gateway is configured (FBR_GATEWAY_URL, FBR_GATEWAY_SECRET).");
  const { callGateway } = await import("./gatewayClient");
  const r = await callGateway(g, "GET", "/v1/egress-ip", undefined, { fetchImpl: deps.fetchImpl, timeoutMs: 20_000 });
  if (r.httpStatus !== 200) throw new HttpError(502, "The gateway could not tell its outbound IP.");
  return { ip: String((r as { data: Record<string, unknown> }).data.ip ?? "") };
}
