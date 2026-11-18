/** PRA (Punjab Revenue Authority) eIMS through MAVIN's server.
 *
 * Who may do what
 * - The platform Super Admin grants or revokes a business's PRA access,
 *   records onboarding (registration, sandbox test, IP whitelist), maps each
 *   branch counter to the POS ID PRA issued (with its credentials), approves
 *   counters, approves going live, and keeps the tax-rule catalogue.
 * - A business owner sees their own setup and status, their submissions,
 *   and records the outcome of a portal check (reconciliation).
 * - Staff trigger fiscalisation of a paid bill of a branch they work in.
 *   Nothing else.
 *
 * Fiscalisation (restaurant bills today; other sectors are blocked until
 * their eIMS mapping is confirmed)
 * - The submission is recorded BEFORE it is sent. Unique indexes allow one
 *   record per bill, invoice type and environment, and one per POS + USIN:
 *   double clicks, two counters, retries and restarts cannot send it twice.
 * - Accepted only when PRA answers Code 100 with a fiscal invoice number.
 * - A timeout or unclear answer is never sent again on its own: it becomes
 *   "needs_reconciliation" until a person checks the IRIS IMS Fiscal Report.
 * - Anything unresolved (no approved rule, a rate that differs from the rule,
 *   a mixed or unconfirmed payment method, no POS mapping) is "blocked":
 *   nothing is sent and the reason is shown.
 *
 * Credentials are encrypted (PRA_TOKEN_KEY) and never returned; buyer names
 * and phone numbers stay out of every answer and log. */
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "@/server/db";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import type { BranchScope } from "@/server/branches";
import { buildPraInvoice, isFiscalNumber, mapPraResponse, validatePraInvoice, type PraSourceLine } from "@/lib/restaurant/praModel";
import {
  PRA_CASES, PRA_SECTORS, SEED_RULES, approvalProblems, caseBlock, checkPayment, expectedRate, pctCodeOf, ruleOn,
  type CaseState, type CaseStates, type PaymentComponent, type PraCaseKey, type PraRule,
} from "@/lib/pra/rules";
import { PRA_INVOICE_TYPE, PRA_SERVICE, isPraInvoice } from "@/lib/pra/services";
import { PRA_GATEWAY_IP, PRA_INVOICE_SECTORS, PRA_TEMPLATES, PRA_TEMPLATE_READ_ON, PRA_TEMPLATE_REVIEW_NOTE, PRA_TEMPLATE_SOURCE_URL, praTemplate, type PraTemplate } from "@/lib/pra/templates";
import { openPra, praHint, praStorageReady, sealPra } from "./secretBox";
import { postToPra, praRoute, type PraEnvironment, type PraTransportDeps } from "./transport";

export interface PraDeps extends PraTransportDeps { now?: () => Date }

export type SubStatus = "sending" | "queued" | "accepted" | "rejected" | "needs_reconciliation" | "blocked" | "legacy";
export type AccountState = "disabled" | "setup_required" | "sandbox_ready" | "awaiting_whitelist" | "ready_for_approval" | "live" | "suspended";

/** "Not on PRA" is accepted only this long after the request (a missing report entry right away proves nothing). */
export const RECONCILE_WAIT_HOURS = 2;
/** A "sending" record older than this lost its sender (server stopped mid-request): it may have reached PRA. */
export const SEND_LOCK_MS = 90_000;
/** How far back the sweep looks for bills that were never handed to PRA. */
export const SWEEP_DAYS = 3;

const iso = (d: Date) => d.toISOString();
const nowOf = (deps: PraDeps) => (deps.now ?? (() => new Date()))();
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optStr = (v: unknown, max = 200) => str(v, max) || null;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ── Who ──────────────────────────────────────────────────────────────────

export const isSuper = (c: Caller) => c.role === "super_admin";
function superOnly(c: Caller) {
  if (!isSuper(c)) throw new HttpError(403, "Only the platform Super Admin can change PRA setup.");
}
/** The business a caller acts on: their own; the Super Admin names one. */
function tenantFor(c: Caller, input: { tenantId?: unknown }): string {
  if (isSuper(c)) {
    const t = str(input.tenantId, 80);
    if (!t) throw new HttpError(400, "Choose the business.");
    return t;
  }
  if (!c.tenantId) throw new HttpError(403, "This login is not attached to a business.");
  return c.tenantId;
}
function ownerOrSuper(c: Caller, tenantId: string) {
  if (isSuper(c)) return;
  if (c.role !== "owner" || c.tenantId !== tenantId) throw new HttpError(403, "Only the business owner (or the Super Admin) can do this.");
}

async function audit(sql: Sql, tenantId: string | null, c: Caller | null, action: string, detail: unknown, deps: PraDeps = {}) {
  await sql.execute(`INSERT INTO pra_audit (id, tenant_id, actor_id, actor_role, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), tenantId, c?.userId ?? null, c?.role ?? "system", action, detail == null ? null : JSON.stringify(detail), iso(nowOf(deps))]);
}

// ── Accounts and counters ────────────────────────────────────────────────

interface AccountRow { tenant_id: string; status: string; pntn: string | null; registered_name: string | null; registration_status: string; sandbox_status: string; whitelist_status: string; whitelist_ip: string | null; live_approved_by: string | null; live_approved_at: string | null; suspended_reason: string | null; notes: string | null }
interface PosRow { id: string; tenant_id: string; branch_id: string; counter: string; sector: string; environment: string; sandbox_pos_id: string | null; production_pos_id: string | null; sandbox_token_enc: string | null; production_token_enc: string | null; sandbox_token_hint: string | null; production_token_hint: string | null; status: string; approved_by: string | null; approved_at: string | null; active_from: string | null; whitelist_status: string; whitelist_ip: string | null; whitelist_reference: string | null; whitelist_updated_at: string | null }

async function account(sql: Sql, tenantId: string): Promise<AccountRow | null> {
  return ((await sql.execute(`SELECT * FROM pra_accounts WHERE tenant_id = ?`, [tenantId])).rows[0] as unknown as AccountRow) ?? null;
}
async function counters(sql: Sql, tenantId: string): Promise<PosRow[]> {
  return (await sql.execute(`SELECT * FROM pra_pos WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY branch_id, counter`, [tenantId])).rows as unknown as PosRow[];
}

/** The account's state, from what has been recorded (shown everywhere). */
export function accountState(a: AccountRow | null, pos: PosRow[]): AccountState {
  if (!a || a.status === "disabled") return "disabled";
  if (a.status === "suspended") return "suspended";
  const approved = pos.filter((p) => p.status === "approved");
  if (!a.pntn || a.registration_status !== "registered" || !approved.length) return "setup_required";
  if (a.live_approved_at && approved.some((p) => p.environment === "production")) return "live";
  if (a.sandbox_status !== "passed") return "sandbox_ready";
  if (a.whitelist_status !== "approved") return "awaiting_whitelist";
  return "ready_for_approval";
}

/** A counter as pages see it: never the tokens, hints only for the Super Admin. */
const showPos = (p: PosRow, c: Caller) => ({
  id: p.id, branchId: p.branch_id, counter: p.counter, sector: p.sector, environment: p.environment,
  sandboxPosId: p.sandbox_pos_id, productionPosId: p.production_pos_id, status: p.status, approvedAt: p.approved_at, activeFrom: p.active_from,
  hasSandboxToken: !!p.sandbox_token_enc, hasProductionToken: !!p.production_token_enc,
  sandboxTokenHint: isSuper(c) ? p.sandbox_token_hint : null, productionTokenHint: isSuper(c) ? p.production_token_hint : null,
  whitelistStatus: p.whitelist_status ?? "not_requested", whitelistIp: p.whitelist_ip, whitelistReference: isSuper(c) ? p.whitelist_reference : null, whitelistUpdatedAt: p.whitelist_updated_at,
});

/** Super Admin: every business with PRA set up or asked for, and its state. */
export async function listAccounts(sql: Sql, c: Caller, input: { search?: unknown } = {}) {
  superOnly(c);
  const q = str(input.search, 80);
  const rows = (await sql.execute(
    `SELECT t.id, t.name, t.business_type, a.status, a.pntn, a.registration_status, a.sandbox_status, a.whitelist_status, a.live_approved_at, a.suspended_reason,
            (SELECT COUNT(*) FROM pra_pos p WHERE p.tenant_id = t.id AND p.deleted_at IS NULL) AS counters,
            (SELECT COUNT(*) FROM pra_submissions s WHERE s.tenant_id = t.id AND s.status IN ('needs_reconciliation', 'blocked', 'rejected')) AS attention
     FROM tenants t LEFT JOIN pra_accounts a ON a.tenant_id = t.id
     WHERE (a.tenant_id IS NOT NULL OR t.business_type IN ('restaurant', 'banquet_hall', 'contractor')) ${q ? "AND (t.name LIKE ? OR t.id = ?)" : ""}
     ORDER BY (a.tenant_id IS NULL), t.name LIMIT 300`, q ? [`%${q}%`, q] : [])).rows;
  const out = [];
  for (const r of rows) {
    const pos = r.status ? await counters(sql, String(r.id)) : [];
    out.push({
      tenantId: String(r.id), name: String(r.name), businessType: String(r.business_type ?? ""), pntn: (r.pntn as string | null) ?? null,
      state: accountState(r.status ? (r as unknown as AccountRow) : null, pos), counters: Number(r.counters) || 0, attention: Number(r.attention) || 0,
    });
  }
  return out;
}

/** One business's PRA setup: Super Admin (any) or the owner (their own, without credential hints). */
export async function setup(sql: Sql, c: Caller, input: { tenantId?: unknown }) {
  const T = tenantFor(c, input);
  ownerOrSuper(c, T);
  const t = (await sql.execute(`SELECT id, name, business_type FROM tenants WHERE id = ?`, [T])).rows[0];
  if (!t) throw new HttpError(404, "Business not found.");
  const a = await account(sql, T);
  const pos = await counters(sql, T);
  const branches = (await sql.execute(`SELECT id, name, code, is_main FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, name`, [T])).rows
    .map((b) => ({ id: String(b.id), name: String(b.name), code: String(b.code ?? ""), isMain: Number(b.is_main) === 1 }));
  const assignments = (await sql.execute(`SELECT * FROM pra_rule_assignments WHERE tenant_id = ? AND status = 'active' ORDER BY assigned_at DESC`, [T])).rows;
  const counts = (await sql.execute(`SELECT status, COUNT(*) AS n FROM pra_submissions WHERE tenant_id = ? GROUP BY status`, [T])).rows;
  return {
    tenant: { id: String(t.id), name: String(t.name), businessType: String(t.business_type ?? "") },
    state: accountState(a, pos),
    account: a ? {
      status: a.status, pntn: a.pntn, registeredName: a.registered_name, registrationStatus: a.registration_status, sandboxStatus: a.sandbox_status,
      whitelistStatus: a.whitelist_status, whitelistIp: a.whitelist_ip, liveApprovedAt: a.live_approved_at, suspendedReason: a.suspended_reason, notes: isSuper(c) ? a.notes : null,
    } : null,
    counters: pos.map((p) => showPos(p, c)),
    branches,
    assignments: assignments.map((r) => ({ id: String(r.id), branchId: (r.branch_id as string | null) ?? null, ruleKey: String(r.rule_key), contractNote: (r.contract_note as string | null) ?? null, assignedAt: String(r.assigned_at) })),
    submissions: Object.fromEntries(counts.map((r) => [String(r.status), Number(r.n)])),
    storageReady: praStorageReady(),
    productionRoute: praRoute("production").via,
    productionSwitch: process.env.PRA_PRODUCTION_ENABLED === "1",
    audit: isSuper(c) ? (await sql.execute(`SELECT action, actor_role, detail, created_at FROM pra_audit WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50`, [T])).rows : [],
  };
}

const REG = ["not_started", "submitted", "registered"] as const;
const SANDBOX = ["not_started", "in_progress", "passed", "failed"] as const;
const WHITELIST = ["not_requested", "requested", "approved", "rejected"] as const;
const pick = <T extends readonly string[]>(v: unknown, list: T, fallback: T[number]): T[number] => (list.includes(String(v)) ? (String(v) as T[number]) : fallback);

/** Super Admin: the business's registration details and onboarding steps. Does not switch anything on. */
export async function saveAccount(sql: Sql, c: Caller, input: Record<string, unknown>, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  if (!(await sql.execute(`SELECT 1 FROM tenants WHERE id = ?`, [T])).rows[0]) throw new HttpError(404, "Business not found.");
  const pntn = optStr(input.pntn, 20);
  if (pntn && !/^[A-Z0-9-]{5,20}$/i.test(pntn)) throw new HttpError(400, "PNTN looks wrong.");
  const ip = optStr(input.whitelistIp, 45);
  if (ip && !/^[0-9a-f:.]{7,45}$/i.test(ip)) throw new HttpError(400, "Whitelisted IP looks wrong.");
  const cur = await account(sql, T);
  const next = {
    pntn, registered_name: optStr(input.registeredName, 150),
    registration_status: pick(input.registrationStatus, REG, (cur?.registration_status as (typeof REG)[number]) ?? "not_started"),
    sandbox_status: pick(input.sandboxStatus, SANDBOX, (cur?.sandbox_status as (typeof SANDBOX)[number]) ?? "not_started"),
    whitelist_status: pick(input.whitelistStatus, WHITELIST, (cur?.whitelist_status as (typeof WHITELIST)[number]) ?? "not_requested"),
    whitelist_ip: ip, notes: optStr(input.notes, 2000),
  };
  const now = iso(nowOf(deps));
  await sql.execute(
    `INSERT INTO pra_accounts (tenant_id, status, pntn, registered_name, registration_status, sandbox_status, whitelist_status, whitelist_ip, notes, updated_by, created_at, updated_at)
     VALUES (?, 'disabled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET pntn = excluded.pntn, registered_name = excluded.registered_name, registration_status = excluded.registration_status,
       sandbox_status = excluded.sandbox_status, whitelist_status = excluded.whitelist_status, whitelist_ip = excluded.whitelist_ip, notes = excluded.notes,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [T, next.pntn, next.registered_name, next.registration_status, next.sandbox_status, next.whitelist_status, next.whitelist_ip, next.notes, c.userId, now, now]);
  // Whitelist or sandbox no longer passed: going live is withdrawn.
  if (cur?.live_approved_at && (next.whitelist_status !== "approved" || next.sandbox_status !== "passed")) {
    await sql.execute(`UPDATE pra_accounts SET live_approved_at = NULL, live_approved_by = NULL WHERE tenant_id = ?`, [T]);
    await audit(sql, T, c, "live.withdrawn", { reason: "onboarding step no longer complete" }, deps);
  }
  await audit(sql, T, c, "account.save", { ...next, notes: undefined }, deps);
  return setup(sql, c, { tenantId: T });
}

/** Super Admin: grant (enable), revoke (disable) or suspend a business's PRA access. */
export async function setAccess(sql: Sql, c: Caller, input: { tenantId?: unknown; access?: unknown; reason?: unknown }, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  const access = input.access === "enabled" ? "enabled" : input.access === "suspended" ? "suspended" : input.access === "disabled" ? "disabled" : null;
  if (!access) throw new HttpError(400, "Choose enabled, suspended or disabled.");
  const reason = optStr(input.reason, 300);
  if (access !== "enabled" && !reason) throw new HttpError(400, "Give a reason.");
  if (!(await account(sql, T))) await saveAccount(sql, c, { tenantId: T }, deps);
  const now = iso(nowOf(deps));
  await sql.execute(`UPDATE pra_accounts SET status = ?, suspended_reason = ?, updated_by = ?, updated_at = ?${access === "enabled" ? "" : ", live_approved_at = NULL, live_approved_by = NULL"} WHERE tenant_id = ?`,
    [access, access === "enabled" ? null : reason, c.userId, now, T]);
  // The old desktop sender (Restaurant > PRA on the Tauri app) stands down for a business MAVIN's server handles.
  await legacyFlag(sql, T, access === "enabled", now);
  await audit(sql, T, c, `access.${access}`, { reason }, deps);
  return setup(sql, c, { tenantId: T });
}

async function legacyFlag(sql: Sql, T: string, managed: boolean, now: string) {
  const put = (k: string, v: string) => sql.execute(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, [`${T}::${k}`, v, now]);
  await put("pra_server_managed", managed ? "true" : "false");
  if (managed) await put("pra_enabled", "false");
}

const POS_ID = /^\d{1,18}$/;
/** PRA's API tokens are long; the 8-character access code (or a browser's saved password) is not one. */
const TOKEN = /^[^\s]{20,500}$/;

/** Super Admin: add or change a counter (branch, counter name, sector, POS IDs, credentials). A changed counter needs approval again. */
export async function savePos(sql: Sql, c: Caller, input: Record<string, unknown>, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  const id = optStr(input.id, 80);
  const cur = id ? ((await sql.execute(`SELECT * FROM pra_pos WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [id, T])).rows[0] as unknown as PosRow | undefined) : undefined;
  if (id && !cur) throw new HttpError(404, "Counter not found.");
  const branchId = str(input.branchId ?? cur?.branch_id, 80);
  if (!(await sql.execute(`SELECT 1 FROM branches WHERE id = ? AND tenant_id = ?`, [branchId, T])).rows[0]) throw new HttpError(400, "Choose a branch of this business.");
  const counter = str(input.counter ?? cur?.counter, 60);
  if (!counter) throw new HttpError(400, "Name the counter as registered with PRA.");
  const sector = str(input.sector ?? cur?.sector, 40);
  if (!PRA_SECTORS.some((s) => s.id === sector)) throw new HttpError(400, "Choose the PRA sector.");
  const environment: PraEnvironment = (input.environment ?? cur?.environment) === "production" ? "production" : "sandbox";
  const posIds = { sandbox: optStr(input.sandboxPosId ?? cur?.sandbox_pos_id, 20), production: optStr(input.productionPosId ?? cur?.production_pos_id, 20) };
  for (const [k, v] of Object.entries(posIds)) if (v && !POS_ID.test(v)) throw new HttpError(400, `The ${k} POS ID must be the number PRA issued (digits only).`);
  const tokens: Record<"sandbox" | "production", { enc: string | null; hint: string | null; changed: boolean }> = {
    sandbox: { enc: cur?.sandbox_token_enc ?? null, hint: cur?.sandbox_token_hint ?? null, changed: false },
    production: { enc: cur?.production_token_enc ?? null, hint: cur?.production_token_hint ?? null, changed: false },
  };
  for (const env of ["sandbox", "production"] as const) {
    const v = input[`${env}Token`];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") throw new HttpError(400, "Tokens are text.");
    const t = v.trim();
    if (t && !TOKEN.test(t)) throw new HttpError(400, `The ${env} token does not look right. Enter PRA's API token (a long code with no spaces), not the POS access code or a saved password.`);
    if (t && !praStorageReady()) throw new HttpError(503, "PRA credential storage is not set up on the server yet (PRA_TOKEN_KEY).");
    tokens[env] = { enc: t ? sealPra(t) : null, hint: t ? praHint(t) : null, changed: true };
  }
  // Production IP whitelisting, tracked for this PNTN + POS ID.
  const wl = {
    status: pick(input.whitelistStatus ?? cur?.whitelist_status, WHITELIST, "not_requested"),
    ip: input.whitelistIp === undefined ? cur?.whitelist_ip ?? null : optStr(input.whitelistIp, 45),
    reference: input.whitelistReference === undefined ? cur?.whitelist_reference ?? null : optStr(input.whitelistReference, 300),
  };
  if (wl.ip && !/^[0-9a-f:.]{7,45}$/i.test(wl.ip)) throw new HttpError(400, "Whitelisted IP looks wrong.");
  if (wl.status === "approved" && (!wl.ip || !wl.reference || !posIds.production)) throw new HttpError(400, "An approved whitelist needs the production POS ID, the IP and PRA's reference.");
  const wlChanged = !cur || cur.whitelist_status !== wl.status || cur.whitelist_ip !== wl.ip || cur.whitelist_reference !== wl.reference;
  const now = iso(nowOf(deps));
  // A different POS ID, environment, branch or sector is a different registration: approve it again.
  const material = !cur || cur.branch_id !== branchId || cur.sector !== sector || cur.environment !== environment || cur.sandbox_pos_id !== posIds.sandbox || cur.production_pos_id !== posIds.production || tokens.production.changed;
  const status = material ? "pending" : cur!.status;
  const row = [branchId, counter, sector, environment, posIds.sandbox, posIds.production, tokens.sandbox.enc, tokens.production.enc, tokens.sandbox.hint, tokens.production.hint, status, c.userId, now];
  try {
    if (cur) {
      await sql.execute(`UPDATE pra_pos SET branch_id = ?, counter = ?, sector = ?, environment = ?, sandbox_pos_id = ?, production_pos_id = ?, sandbox_token_enc = ?, production_token_enc = ?,
          sandbox_token_hint = ?, production_token_hint = ?, status = ?, updated_by = ?, updated_at = ?${material ? ", approved_by = NULL, approved_at = NULL" : ""} WHERE id = ? AND tenant_id = ?`, [...row, cur.id, T]);
      await sql.execute(`UPDATE pra_pos SET whitelist_status = ?, whitelist_ip = ?, whitelist_reference = ?, whitelist_updated_at = ? WHERE id = ?`, [wl.status, wl.ip, wl.reference, wlChanged ? now : cur.whitelist_updated_at, cur.id]);
    } else {
      await sql.execute(`INSERT INTO pra_pos (id, tenant_id, branch_id, counter, sector, environment, sandbox_pos_id, production_pos_id, sandbox_token_enc, production_token_enc, sandbox_token_hint, production_token_hint, status, updated_by, updated_at, created_at, whitelist_status, whitelist_ip, whitelist_reference, whitelist_updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), T, ...row, now, wl.status, wl.ip, wl.reference, now]);
    }
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, "This branch already has a counter with that name.");
    throw e;
  }
  await audit(sql, T, c, cur ? "pos.update" : "pos.create", { branchId, counter, sector, environment, posIds, reapproval: material && !!cur }, deps);
  if (wlChanged && cur) await audit(sql, T, c, "whitelist.update", { counter, posId: posIds.production, status: wl.status, ip: wl.ip, reference: wl.reference }, deps);
  for (const env of ["sandbox", "production"] as const) if (tokens[env].changed) await audit(sql, T, c, "credential.rotate", { counter, environment: env, set: !!tokens[env].enc }, deps);
  return setup(sql, c, { tenantId: T });
}

/** Super Admin: approve or revoke a counter (one approved counter per branch: bills don't say which counter billed them yet). */
export async function decidePos(sql: Sql, c: Caller, input: { tenantId?: unknown; id?: unknown; approve?: unknown; reason?: unknown }, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  const p = (await sql.execute(`SELECT * FROM pra_pos WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [str(input.id, 80), T])).rows[0] as unknown as PosRow | undefined;
  if (!p) throw new HttpError(404, "Counter not found.");
  const now = iso(nowOf(deps));
  if (input.approve === true) {
    const posId = p.environment === "production" ? p.production_pos_id : p.sandbox_pos_id;
    const tok = p.environment === "production" ? p.production_token_enc : p.sandbox_token_enc;
    if (!posId || !tok) throw new HttpError(409, `Enter the ${p.environment} POS ID and token first.`);
    const other = (await sql.execute(`SELECT counter FROM pra_pos WHERE tenant_id = ? AND branch_id = ? AND status = 'approved' AND id <> ? AND deleted_at IS NULL`, [T, p.branch_id, p.id])).rows[0];
    if (other) throw new HttpError(409, `Counter "${other.counter}" is already approved for this branch. MAVIN's bills do not record the counter yet: one approved counter per branch.`);
    await sql.execute(`UPDATE pra_pos SET status = 'approved', approved_by = ?, approved_at = ?, active_from = ?, updated_at = ? WHERE id = ?`, [c.userId, now, now, now, p.id]);
  } else {
    const reason = optStr(input.reason, 300);
    if (!reason) throw new HttpError(400, "Give a reason.");
    await sql.execute(`UPDATE pra_pos SET status = 'revoked', updated_at = ? WHERE id = ?`, [now, p.id]);
  }
  await audit(sql, T, c, input.approve === true ? "pos.approve" : "pos.revoke", { counter: p.counter, environment: p.environment, reason: input.reason ?? null }, deps);
  return setup(sql, c, { tenantId: T });
}

/** Super Admin: approve production ("Live") once registration, sandbox test and whitelist are done. */
export async function approveLive(sql: Sql, c: Caller, input: { tenantId?: unknown; approve?: unknown }, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  const a = await account(sql, T);
  if (!a) throw new HttpError(409, "Set up the business first.");
  const now = iso(nowOf(deps));
  if (input.approve === false) {
    await sql.execute(`UPDATE pra_accounts SET live_approved_at = NULL, live_approved_by = NULL, updated_at = ? WHERE tenant_id = ?`, [now, T]);
    await audit(sql, T, c, "live.revoke", null, deps);
    return setup(sql, c, { tenantId: T });
  }
  const missing: string[] = [];
  if (a.status !== "enabled") missing.push("PRA access is not enabled");
  if (a.registration_status !== "registered") missing.push("POS registration with PRA is not recorded as done");
  if (a.sandbox_status !== "passed") missing.push("the sandbox test has not passed");
  const all = (await counters(sql, T)).filter((p) => p.status !== "revoked");
  const withProd = all.filter((p) => p.production_pos_id && p.production_token_enc);
  const prod = withProd.filter((p) => p.environment === "production" && p.status === "approved");
  if (!withProd.length) missing.push("no counter has its production POS ID and token");
  else if (!prod.length) missing.push(`switch counter "${withProd[0].counter}" to the production environment (Edit counter), then approve the counter again`);
  // PRA's whitelist approval for each PNTN + POS ID (recorded on the counter with PRA's reference) is the approval for MAVIN's shared IP.
  for (const p of prod) if (p.whitelist_status !== "approved") missing.push(`PRA has not whitelisted the IP for PNTN ${a.pntn ?? "?"} / POS ID ${p.production_pos_id}`);
  if (missing.length) throw new HttpError(409, `Not ready to go live: ${missing.join("; ")}.`);
  await sql.execute(`UPDATE pra_accounts SET live_approved_at = ?, live_approved_by = ?, updated_at = ? WHERE tenant_id = ?`, [now, c.userId, now, T]);
  await audit(sql, T, c, "live.approve", null, deps);
  return setup(sql, c, { tenantId: T });
}

// ── Tax rules ────────────────────────────────────────────────────────────

async function allRules(sql: Sql): Promise<PraRule[]> {
  return (await sql.execute(`SELECT * FROM pra_tax_rules ORDER BY sector, rule_key, version DESC`)).rows as unknown as PraRule[];
}

/** The starting drafts, once (an empty catalogue). */
export async function seedRules(sql: Sql, deps: PraDeps = {}) {
  if ((await sql.execute(`SELECT 1 FROM pra_tax_rules LIMIT 1`)).rows[0]) {
    // Starting drafts nobody has touched yet get the latest review notes (approved rules never change).
    for (const r of SEED_RULES) await sql.execute(`UPDATE pra_tax_rules SET review_notes = ? WHERE rule_key = ? AND version = 1 AND status = 'draft' AND created_by = 'seed' AND COALESCE(review_notes, '') <> ?`, [r.review_notes, r.rule_key, r.review_notes ?? ""]);
    return 0;
  }
  const now = iso(nowOf(deps));
  for (const r of SEED_RULES) {
    await sql.execute(
      `INSERT OR IGNORE INTO pra_tax_rules (id, rule_key, version, sector, service, classification_code, rate_type, rate, fixed_amount, fixed_unit, payment_condition, alt_rate, input_adjustment, exemptions,
         effective_from, effective_to, source, clause, source_url, last_verified_at, status, review_notes, needs_scope_review, eims_applicable, created_by, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?, ?, 'seed', ?, ?)`,
      [randomUUID(), r.rule_key, r.sector, r.service, r.classification_code, r.rate_type, r.rate, r.fixed_amount, r.fixed_unit, r.payment_condition, r.alt_rate, r.input_adjustment, r.exemptions,
        r.effective_from, r.effective_to, r.source, r.clause, r.source_url, r.review_notes, r.needs_scope_review, r.eims_applicable, now, now]);
  }
  return SEED_RULES.length;
}

/** Super Admin: the catalogue (searchable). Seeds the drafts the first time. */
export async function listRules(sql: Sql, c: Caller, input: { search?: unknown; sector?: unknown; status?: unknown } = {}, deps: PraDeps = {}) {
  superOnly(c);
  await seedRules(sql, deps);
  const q = str(input.search, 80).toLowerCase();
  const sector = str(input.sector, 40);
  const status = str(input.status, 20);
  return (await allRules(sql)).filter((r) => (!sector || r.sector === sector) && (!status || r.status === status)
    && (!q || `${r.service} ${r.classification_code ?? ""} ${r.sector} ${r.source} ${r.rule_key}`.toLowerCase().includes(q)))
    .map((r) => ({ ...r, problems: approvalProblems(r) }));
}

const RATE = (v: unknown) => (v === "" || v == null ? null : Number(v));

/** Super Admin: a new rule, or a new version of one (dates decide which applies). Always a draft. */
export async function saveRule(sql: Sql, c: Caller, input: Record<string, unknown>, deps: PraDeps = {}) {
  superOnly(c);
  const base = input.ruleKey ? (await allRules(sql)).filter((r) => r.rule_key === input.ruleKey) : [];
  const key = str(input.ruleKey, 80) || `${str(input.sector, 40)}-${randomUUID().slice(0, 8)}`;
  if (!/^[a-z0-9._-]{3,80}$/i.test(key)) throw new HttpError(400, "Rule key: letters, digits, dot, dash.");
  const sector = str(input.sector, 40);
  if (!PRA_SECTORS.some((s) => s.id === sector)) throw new HttpError(400, "Choose the sector.");
  const version = base.length ? Math.max(...base.map((r) => r.version)) + 1 : 1;
  const r = {
    sector, service: str(input.service, 300), classification_code: optStr(input.classificationCode, 20),
    rate_type: input.rateType === "fixed" ? "fixed" : "percent", rate: RATE(input.rate), fixed_amount: RATE(input.fixedAmount), fixed_unit: optStr(input.fixedUnit, 60),
    payment_condition: input.paymentCondition === "digital_split" ? "digital_split" : "any", alt_rate: RATE(input.altRate),
    input_adjustment: str(input.inputAdjustment, 300) || "unknown", exemptions: optStr(input.exemptions, 1000),
    effective_from: str(input.effectiveFrom, 10), effective_to: optStr(input.effectiveTo, 10),
    source: str(input.source, 1000), clause: optStr(input.clause, 2000), source_url: optStr(input.sourceUrl, 500), last_verified_at: optStr(input.lastVerifiedAt, 10),
    review_notes: optStr(input.reviewNotes, 2000), needs_scope_review: input.needsScopeReview ? 1 : 0,
    eims_applicable: input.eimsApplicable === "yes" ? "yes" : input.eimsApplicable === "no" ? "no" : "unconfirmed",
  };
  if (!r.service) throw new HttpError(400, "Describe the actual service.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effective_from)) throw new HttpError(400, "Effective-from date is required.");
  if (r.effective_to && r.effective_to < r.effective_from) throw new HttpError(400, "The end date is before the start date.");
  if (r.source_url && !/^https:\/\//.test(r.source_url)) throw new HttpError(400, "The source link must start with https://.");
  const now = iso(nowOf(deps));
  const id = randomUUID();
  await sql.execute(
    `INSERT INTO pra_tax_rules (id, rule_key, version, sector, service, classification_code, rate_type, rate, fixed_amount, fixed_unit, payment_condition, alt_rate, input_adjustment, exemptions,
       effective_from, effective_to, source, clause, source_url, last_verified_at, status, review_notes, needs_scope_review, eims_applicable, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    [id, key, version, r.sector, r.service, r.classification_code, r.rate_type, r.rate, r.fixed_amount, r.fixed_unit, r.payment_condition, r.alt_rate, r.input_adjustment, r.exemptions,
      r.effective_from, r.effective_to, r.source, r.clause, r.source_url, r.last_verified_at, r.review_notes, r.needs_scope_review, r.eims_applicable, c.userId, now, now]);
  await audit(sql, null, c, "rule.save", { ruleKey: key, version }, deps);
  return { id, ruleKey: key, version };
}

/** Super Admin: approve a verified draft, or retire a rule version. Approved versions are never edited (a change is a new version). */
export async function decideRule(sql: Sql, c: Caller, input: { id?: unknown; decision?: unknown; lastVerifiedAt?: unknown }, deps: PraDeps = {}) {
  superOnly(c);
  const r = (await sql.execute(`SELECT * FROM pra_tax_rules WHERE id = ?`, [str(input.id, 80)])).rows[0] as unknown as PraRule | undefined;
  if (!r) throw new HttpError(404, "Rule not found.");
  const now = iso(nowOf(deps));
  if (input.decision === "approve") {
    if (r.status !== "draft") throw new HttpError(409, "Only a draft can be approved.");
    const verified = optStr(input.lastVerifiedAt, 10) ?? r.last_verified_at;
    const problems = approvalProblems({ ...r, last_verified_at: verified });
    if (problems.length) throw new HttpError(409, problems.join(" "));
    await sql.execute(`UPDATE pra_tax_rules SET status = 'approved', last_verified_at = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`, [verified, c.userId, now, now, r.id]);
  } else if (input.decision === "retire") {
    await sql.execute(`UPDATE pra_tax_rules SET status = 'retired', updated_at = ? WHERE id = ?`, [now, r.id]);
  } else throw new HttpError(400, "Approve or retire.");
  await audit(sql, null, c, `rule.${input.decision}`, { ruleKey: r.rule_key, version: r.version }, deps);
  return { ok: true };
}

/** Super Admin: assign a rule to a business (all branches, or one). Rules that need the scope of work reviewed need a contract note. */
export async function assignRule(sql: Sql, c: Caller, input: { tenantId?: unknown; branchId?: unknown; ruleKey?: unknown; contractNote?: unknown; revokeId?: unknown }, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  const now = iso(nowOf(deps));
  if (input.revokeId) {
    await sql.execute(`UPDATE pra_rule_assignments SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [c.userId, now, now, str(input.revokeId, 80), T]);
    await audit(sql, T, c, "rule.unassign", { id: input.revokeId }, deps);
    return setup(sql, c, { tenantId: T });
  }
  const key = str(input.ruleKey, 80);
  const versions = (await allRules(sql)).filter((r) => r.rule_key === key);
  if (!versions.length) throw new HttpError(404, "Rule not found.");
  if (!versions.some((r) => r.status === "approved")) throw new HttpError(409, "Only an approved rule can be assigned (drafts stay suggestions).");
  const branchId = optStr(input.branchId, 80);
  if (branchId && !(await sql.execute(`SELECT 1 FROM branches WHERE id = ? AND tenant_id = ?`, [branchId, T])).rows[0]) throw new HttpError(400, "Choose a branch of this business.");
  const note = optStr(input.contractNote, 1000);
  if (versions.some((r) => r.needs_scope_review) && !note) throw new HttpError(400, "This rule depends on the scope of work: record what the contract covers before assigning it.");
  // One active rule per sector for a branch (or for the whole business).
  const sector = versions[0].sector;
  const active = (await sql.execute(`SELECT a.id, a.rule_key FROM pra_rule_assignments a WHERE a.tenant_id = ? AND a.status = 'active' AND COALESCE(a.branch_id, '') = ?`, [T, branchId ?? ""])).rows;
  const keys = new Map((await allRules(sql)).map((r) => [r.rule_key, r.sector]));
  for (const x of active) if (keys.get(String(x.rule_key)) === sector) await sql.execute(`UPDATE pra_rule_assignments SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ? WHERE id = ?`, [c.userId, now, now, x.id]);
  await sql.execute(`INSERT INTO pra_rule_assignments (id, tenant_id, branch_id, rule_key, status, contract_note, assigned_by, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [randomUUID(), T, branchId, key, note, c.userId, now, now, now]);
  await audit(sql, T, c, "rule.assign", { ruleKey: key, branchId }, deps);
  return setup(sql, c, { tenantId: T });
}

// ── Vendor templates: one-screen set-up for the Super Admin ──────────────

/** The template's rule, approved and in force: the current version when it already matches, otherwise a new approved version. */
async function approvedTemplateRule(sql: Sql, c: Caller, t: PraTemplate, deps: PraDeps): Promise<PraRule> {
  await seedRules(sql, deps);
  const day = iso(nowOf(deps)).slice(0, 10);
  const matches = (r: PraRule | null): r is PraRule => !!r && r.eims_applicable === "yes" && r.rate_type === "percent" && Number(r.rate) === t.rate && pctCodeOf(r.classification_code) === pctCodeOf(t.code);
  const current = ruleOn(await allRules(sql), t.ruleKey, day);
  if (matches(current)) return current;
  const saved = await saveRule(sql, c, {
    ruleKey: t.ruleKey, sector: t.sector, service: t.service, classificationCode: t.code, rateType: "percent", rate: t.rate, paymentCondition: "any", inputAdjustment: t.inputAdjustment,
    effectiveFrom: "2026-07-01", source: t.source, clause: t.clause, sourceUrl: PRA_TEMPLATE_SOURCE_URL, lastVerifiedAt: PRA_TEMPLATE_READ_ON, reviewNotes: PRA_TEMPLATE_REVIEW_NOTE,
    needsScopeReview: t.needsScope, eimsApplicable: "yes",
  }, deps);
  await decideRule(sql, c, { id: saved.id, decision: "approve", lastVerifiedAt: PRA_TEMPLATE_READ_ON }, deps);
  return ruleOn(await allRules(sql), t.ruleKey, day)!;
}

/** Super Admin: the vendor templates and whether each one's rule is approved for use. */
export async function listTemplates(sql: Sql, c: Caller, deps: PraDeps = {}) {
  superOnly(c);
  await seedRules(sql, deps);
  const rules = await allRules(sql);
  const day = iso(nowOf(deps)).slice(0, 10);
  return PRA_TEMPLATES.map((t) => {
    const r = ruleOn(rules, t.ruleKey, day);
    return { ...t, approved: !!r && r.eims_applicable === "yes" && Number(r.rate) === t.rate && pctCodeOf(r.classification_code) === pctCodeOf(t.code) };
  });
}

/** Super Admin: approve a vendor template's tax rule (or every template's). */
export async function approveTemplates(sql: Sql, c: Caller, input: { templateId?: unknown }, deps: PraDeps = {}) {
  superOnly(c);
  const list = input.templateId ? [praTemplate(input.templateId)].filter((t): t is PraTemplate => !!t) : PRA_TEMPLATES;
  if (!list.length) throw new HttpError(400, "Choose the service.");
  for (const t of list) await approvedTemplateRule(sql, c, t, deps);
  return listTemplates(sql, c, deps);
}

/** The template's starter services in the business's Products > Services (existing services are left as they are). */
async function seedServices(sql: Sql, T: string, t: PraTemplate, deps: PraDeps): Promise<number> {
  const now = iso(nowOf(deps));
  const have = new Set((await sql.execute(`SELECT LOWER(TRIM(name)) AS n FROM products WHERE tenant_id = ? AND product_classification = ? AND deleted_at IS NULL`, [T, PRA_SERVICE])).rows.map((r) => String(r.n)));
  let added = 0;
  for (const s of t.starters) {
    if (have.has(s.name.toLowerCase())) continue;
    let unit = (await sql.execute(`SELECT id FROM uoms WHERE tenant_id = ? AND deleted_at IS NULL AND LOWER(TRIM(name)) = ? LIMIT 1`, [T, s.unit.toLowerCase()])).rows[0]?.id as string | undefined;
    if (!unit) {
      unit = randomUUID();
      await sql.execute(`INSERT INTO uoms (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, [unit, T, s.unit, now, now]);
    }
    await sql.execute(`INSERT INTO products (id, tenant_id, name, base_unit_id, packing, tax_rate_pct, gst_rate_pct, pct_code, product_classification, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), T, s.name, unit, t.rate, t.rate, t.code, PRA_SERVICE, now, now]);
    added += 1;
  }
  return added;
}

/** Super Admin, one step: choose the vendor's service, enter its PRA details and tokens. Registers the business,
 * enables PRA, adds and approves the counter on the Sandbox, approves and assigns the tax rule, and adds the starter services.
 * Safe to run again until the business is live. Never goes live by itself. */
export async function quickSetup(sql: Sql, c: Caller, input: Record<string, unknown>, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  const t = praTemplate(input.templateId);
  if (!t) throw new HttpError(400, "Choose the vendor's service.");
  const tenant = (await sql.execute(`SELECT business_type FROM tenants WHERE id = ?`, [T])).rows[0];
  if (!tenant) throw new HttpError(404, "Business not found.");
  if (tenant.business_type !== "contractor") throw new HttpError(409, "PRA Invoices and Services are for Contractor businesses: set this business's type to Contractor first.");
  const cur = await account(sql, T);
  if (cur?.live_approved_at) throw new HttpError(409, "This business is already live. Withdraw live approval before setting it up again.");
  const pntn = str(input.pntn, 20), registeredName = str(input.registeredName, 150), counter = str(input.counter, 60), sandboxPosId = str(input.sandboxPosId, 20);
  const scopeNote = str(input.scopeNote, 1000);
  if (!pntn || !registeredName) throw new HttpError(400, "Enter the PNTN and the registered business name.");
  if (!counter) throw new HttpError(400, "Name the counter as registered with PRA.");
  if (!sandboxPosId) throw new HttpError(400, "Enter the Sandbox POS ID.");
  if (t.needsScope && !scopeNote) throw new HttpError(400, "This rate depends on the contract: describe the work it covers.");
  const branchId = str(input.branchId, 80) || (await mainBranch(sql, T));
  if (!branchId) throw new HttpError(400, "This business has no branch.");
  const existing = (await counters(sql, T)).find((p) => p.branch_id === branchId && p.status !== "revoked");
  const sandboxToken = str(input.sandboxToken, 500);
  if (!sandboxToken && !existing?.sandbox_token_enc) throw new HttpError(400, "Enter the Sandbox token.");

  const rule = await approvedTemplateRule(sql, c, t, deps);
  await saveAccount(sql, c, { tenantId: T, pntn, registeredName, registrationStatus: "registered", sandboxStatus: "in_progress", whitelistStatus: cur?.whitelist_status, whitelistIp: cur?.whitelist_ip, notes: cur?.notes }, deps);
  await setAccess(sql, c, { tenantId: T, access: "enabled" }, deps);
  await savePos(sql, c, {
    tenantId: T, id: existing?.id, branchId, counter, sector: t.sector, environment: "sandbox", sandboxPosId, productionPosId: str(input.productionPosId, 20) || existing?.production_pos_id,
    ...(sandboxToken ? { sandboxToken } : {}), ...(str(input.productionToken, 500) ? { productionToken: str(input.productionToken, 500) } : {}),
  }, deps);
  const pos = (await counters(sql, T)).find((p) => p.branch_id === branchId && p.status !== "revoked")!;
  await decidePos(sql, c, { tenantId: T, id: pos.id, approve: true }, deps);
  await assignRule(sql, c, { tenantId: T, ruleKey: rule.rule_key, contractNote: scopeNote || t.label }, deps);
  const services = await seedServices(sql, T, t, deps);
  await audit(sql, T, c, "quick_setup", { template: t.id, rule: rule.rule_key, version: rule.version, services }, deps);
  return { services, setup: await setup(sql, c, { tenantId: T }) };
}

/** Super Admin: one sample invoice to PRA's Sandbox with this business's POS ID, token and tax rule. Nothing is written to its books. */
export async function sandboxTest(sql: Sql, c: Caller, input: { tenantId?: unknown }, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  const pos = (await counters(sql, T)).find((p) => p.status === "approved" && p.environment === "sandbox");
  if (!pos?.sandbox_pos_id || !pos.sandbox_token_enc) throw new HttpError(409, "Set up an approved counter on the Sandbox first.");
  const day = iso(nowOf(deps)).slice(0, 10);
  const rules = await allRules(sql);
  const assigned = (await sql.execute(`SELECT rule_key FROM pra_rule_assignments WHERE tenant_id = ? AND status = 'active' AND (branch_id = ? OR branch_id IS NULL)`, [T, pos.branch_id])).rows;
  const rule = assigned.map((x) => ruleOn(rules, String(x.rule_key), day)).find((r) => r?.sector === pos.sector);
  const pct = pctCodeOf(rule?.classification_code);
  if (!rule || !pct) throw new HttpError(409, "Assign an approved tax rule first.");
  const rate = Number(rule.rate) || 0;
  const payload = JSON.stringify(buildPraInvoice({
    posId: pos.sandbox_pos_id, usin: `MAVIN-TEST-${nowOf(deps).getTime()}`, refUsin: null, invoiceType: 1, at: nowOf(deps), pctCode: pct, methods: ["cash"],
    lines: [{ code: "MAVIN-TEST", name: "MAVIN Sandbox test", qty: 1, grossPaisa: 10000, discountPaisa: 0, taxPaisa: Math.round(100 * rate), taxRate: rate }],
  }));
  const res = await postToPra("sandbox", openPra(pos.sandbox_token_enc) ?? "", payload, T, deps);
  const outcome = res.outcome === "response" ? mapPraResponse({ httpStatus: res.status, body: res.body }) : null;
  const passed = outcome?.status === "accepted";
  await sql.execute(`UPDATE pra_accounts SET sandbox_status = ?, updated_by = ?, updated_at = ? WHERE tenant_id = ?`, [passed ? "passed" : "failed", c.userId, iso(nowOf(deps)), T]);
  await audit(sql, T, c, passed ? "sandbox.passed" : "sandbox.failed", { code: outcome?.code ?? null }, deps);
  const message = passed ? `PRA accepted the test invoice: ${outcome!.praInvoiceNo}` : outcome ? `PRA refused the test invoice: ${outcome.message}${outcome.code ? ` (code ${outcome.code})` : ""}` : (res as { error: string }).error;
  return { passed, message, setup: await setup(sql, c, { tenantId: T }) };
}

/** Super Admin: after a passed Sandbox test, moves the counter to production and approves going live. Bills issued before this moment are never sent. */
export async function goLive(sql: Sql, c: Caller, input: Record<string, unknown>, deps: PraDeps = {}) {
  superOnly(c);
  const T = tenantFor(c, input);
  const a = await account(sql, T);
  if (a?.status !== "enabled") throw new HttpError(409, "Set up PRA for this business first.");
  if (a.sandbox_status !== "passed") throw new HttpError(409, "Run the Sandbox test first: it must pass before going live.");
  if (process.env.PRA_PRODUCTION_ENABLED !== "1" && deps.env?.PRA_PRODUCTION_ENABLED !== "1") throw new HttpError(409, "Live PRA sending is off on the server: set PRA_PRODUCTION_ENABLED=1 in Vercel and redeploy first.");
  const route = praRoute("production", deps);
  if (route.via === "blocked") throw new HttpError(409, route.reason ?? "The production route is not ready.");
  const whitelistReference = str(input.whitelistReference, 300);
  if (!whitelistReference) throw new HttpError(400, "Enter PRA's whitelist approval reference (email or ticket) for this POS ID.");
  const pos = (await counters(sql, T)).find((p) => p.status === "approved");
  if (!pos) throw new HttpError(409, "No approved counter.");
  const productionPosId = str(input.productionPosId, 20) || pos.production_pos_id;
  const productionToken = str(input.productionToken, 500);
  if (!productionPosId) throw new HttpError(400, "Enter the production POS ID.");
  if (!productionToken && !pos.production_token_enc) throw new HttpError(400, "Enter the production token from PRA's POS Registration screen.");
  await savePos(sql, c, { tenantId: T, id: pos.id, environment: "production", productionPosId, ...(productionToken ? { productionToken } : {}), whitelistStatus: "approved", whitelistIp: PRA_GATEWAY_IP, whitelistReference }, deps);
  await decidePos(sql, c, { tenantId: T, id: pos.id, approve: true }, deps);
  await saveAccount(sql, c, { tenantId: T, pntn: a.pntn, registeredName: a.registered_name, registrationStatus: a.registration_status, sandboxStatus: a.sandbox_status, whitelistStatus: "approved", whitelistIp: PRA_GATEWAY_IP, notes: a.notes }, deps);
  return approveLive(sql, c, { tenantId: T, approve: true }, deps);
}

// ── PRA cases (what PRA still has to confirm) ─────────────────────────────

/** The Super Admin's record per case (platform-wide). */
export async function caseStates(sql: Sql): Promise<CaseStates> {
  const r = (await sql.execute(`SELECT value FROM pra_platform WHERE key = 'cases'`)).rows[0];
  if (!r) return {};
  try { return JSON.parse(String(r.value)) as CaseStates; } catch { return {}; }
}

/** Super Admin: the cases with what is documented, what is pending, and their state. */
export async function listCases(sql: Sql, c: Caller) {
  superOnly(c);
  const st = await caseStates(sql);
  return (Object.keys(PRA_CASES) as PraCaseKey[]).map((key) => ({
    key, ...PRA_CASES[key], state: st[key] ?? {},
    implemented: true, sandboxAllowed: st[key]?.sandbox !== false, sandboxPassed: !!st[key]?.sandboxPassedAt,
    productionReady: caseBlock(key, st, "production") === null,
  }));
}

/** Super Admin: record a case (Sandbox on / off, Sandbox passed, PRA's written confirmation, rate policy, PaymentMode, approved text). */
export async function saveCase(sql: Sql, c: Caller, input: Record<string, unknown>, deps: PraDeps = {}) {
  superOnly(c);
  const key = str(input.key, 40) as PraCaseKey;
  if (!(key in PRA_CASES)) throw new HttpError(400, "Unknown case.");
  const all = await caseStates(sql);
  const cur = all[key] ?? {};
  const date = (v: unknown) => { const s = optStr(v, 10); if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, "Dates are yyyy-mm-dd."); return s; };
  const mode = input.praMode === undefined ? cur.praMode ?? null : input.praMode === null || input.praMode === "" ? null : Number(input.praMode);
  if (mode != null && ![1, 2, 3, 4, 5, 6].includes(mode)) throw new HttpError(400, "PaymentMode must be 1-6 (eIMS manual §6.1).");
  const policy = input.ratePolicy === undefined ? cur.ratePolicy ?? null : input.ratePolicy === "whole_other" || input.ratePolicy === "whole_qualifying" ? input.ratePolicy : null;
  const next = {
    sandbox: input.sandbox === undefined ? cur.sandbox !== false : input.sandbox !== false,
    sandboxPassedAt: input.sandboxPassedAt === undefined ? cur.sandboxPassedAt ?? null : date(input.sandboxPassedAt),
    confirmedAt: input.confirmedAt === undefined ? cur.confirmedAt ?? null : date(input.confirmedAt),
    reference: input.reference === undefined ? cur.reference ?? null : optStr(input.reference, 300),
    sampleAccepted: input.sampleAccepted === undefined ? !!cur.sampleAccepted : input.sampleAccepted === true,
    note: input.note === undefined ? cur.note ?? null : optStr(input.note, 1000),
    text: input.text === undefined ? cur.text ?? null : optStr(input.text, 500),
    ratePolicy: policy as CaseState["ratePolicy"], praMode: mode,
  } satisfies CaseState;
  if (next.confirmedAt && !next.reference) throw new HttpError(400, "Record PRA's reference (email or letter) with the confirmation date.");
  if (key === "qr_verifier" && next.text && !/^https:\/\/[^\s]+\{fiscal\}/.test(next.text)) throw new HttpError(400, "QR link format: https://… with {fiscal} where the fiscal number goes.");
  all[key] = next;
  const now = iso(nowOf(deps));
  await sql.execute(`INSERT INTO pra_platform (key, value, updated_by, updated_at) VALUES ('cases', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, [JSON.stringify(all), c.userId, now]);
  await audit(sql, null, c, "case.save", { key, ...next }, deps);
  return listCases(sql, c);
}

// ── Fiscalisation ────────────────────────────────────────────────────────

interface OrderRow { id: string; tenant_id: string; branch_id: string | null; status: string; invoice_no: number | null; invoiced_at: string | null; created_at: string; refund_of: string | null; tax_rate: number; tax: number; service_charge: number; total: number; payments: string | null; customer_name: string | null; customer_phone: string | null }
interface Prepared {
  pos: PosRow; environment: PraEnvironment; posId: string; usin: string; refUsin: string | null; refFiscal: string | null; invoiceType: 1 | 3; rule: PraRule | null; payload: string | null;
  methods: string[]; components: PaymentComponent[]; praMode: number | null; cases: PraCaseKey[]; problems: string[]; sale: number; tax: number; total: number; qty: number;
}

const paise = (n: number) => Math.round((Number(n) || 0) * 100);
const rupees = (p: number) => Math.round(p) / 100;
const componentsOf = (raw: unknown): PaymentComponent[] => {
  try {
    const v = JSON.parse(String(raw ?? "[]")) as { method?: unknown; amount?: unknown; reference?: unknown; ref?: unknown }[];
    return Array.isArray(v) ? v.map((p) => ({ method: String(p.method ?? ""), amount: Number(p.amount) || 0, reference: (p.reference ?? p.ref ?? null) as string | null })) : [];
  } catch { return []; }
};

async function mainBranch(sql: Sql, T: string): Promise<string | null> {
  return ((await sql.execute(`SELECT id FROM branches WHERE tenant_id = ? ORDER BY is_main DESC, created_at LIMIT 1`, [T])).rows[0]?.id as string | undefined) ?? null;
}

/** Everything needed to send one restaurant bill, or why it can't be sent. Nothing is written. */
async function prepareRestaurant(sql: Sql, T: string, order: OrderRow, deps: PraDeps): Promise<Prepared | { skip: string }> {
  const a = await account(sql, T);
  if (!a || a.status !== "enabled") return { skip: "PRA is not enabled for this business." };
  const branchId = order.branch_id ?? (await mainBranch(sql, T));
  const pos = (await counters(sql, T)).find((p) => p.branch_id === branchId && p.status === "approved");
  if (!pos) return { skip: "No approved PRA counter for this branch." };
  if (pos.active_from && (order.invoiced_at ?? order.created_at) < pos.active_from) return { skip: "Billed before PRA was switched on for this counter." };
  const environment: PraEnvironment = pos.environment === "production" ? "production" : "sandbox";
  const states = await caseStates(sql);
  const problems: string[] = [];
  const cases: PraCaseKey[] = [];
  if (environment === "production") {
    if (!a.live_approved_at) problems.push("Going live has not been approved by the Super Admin.");
    if (process.env.PRA_PRODUCTION_ENABLED !== "1" && deps.env?.PRA_PRODUCTION_ENABLED !== "1") problems.push("Live PRA submission is switched off on this server (PRA_PRODUCTION_ENABLED).");
    if (!a.pntn) problems.push("No PNTN recorded.");
    if (pos.whitelist_status !== "approved") problems.push(`PRA has not whitelisted the server IP for PNTN ${a.pntn ?? "?"} / POS ID ${pos.production_pos_id ?? "?"}.`);
  }
  const posId = (environment === "production" ? pos.production_pos_id : pos.sandbox_pos_id) ?? "";
  if (!posId) problems.push(`No ${environment} POS ID for counter "${pos.counter}".`);
  if (!(environment === "production" ? pos.production_token_enc : pos.sandbox_token_enc)) problems.push(`No ${environment} token for counter "${pos.counter}".`);
  if (pos.sector !== "restaurant" && pos.sector !== "hotel") problems.push(`Bills of sector "${pos.sector}" have no confirmed eIMS mapping in MAVIN yet.`);

  // The approved rule assigned to this branch (or the whole business), in force on the bill's date.
  const day = (order.invoiced_at ?? order.created_at).slice(0, 10);
  const assigned = (await sql.execute(`SELECT rule_key, branch_id FROM pra_rule_assignments WHERE tenant_id = ? AND status = 'active' AND (branch_id = ? OR branch_id IS NULL) ORDER BY (branch_id IS NULL)`, [T, branchId])).rows;
  const rules = await allRules(sql);
  let rule: PraRule | null = null;
  for (const x of assigned) {
    const r = ruleOn(rules, String(x.rule_key), day);
    if (r && r.sector === pos.sector) { rule = r; break; }
  }
  if (!rule) problems.push(`No approved PRA tax rule for sector "${pos.sector}" is assigned to this branch for ${day}.`);
  else if (rule.eims_applicable !== "yes") problems.push(`eIMS reporting for "${rule.service}" is not confirmed.`);

  // Lines: the frozen amounts of the bill (as printed), plus service charge.
  const lineRows = async (orderId: string) => (await sql.execute(`SELECT * FROM rest_order_items WHERE order_id = ? AND tenant_id = ? AND deleted_at IS NULL AND parent_item_id IS NULL AND kitchen_status <> 'cancelled' ORDER BY created_at, id`, [orderId, T])).rows;
  const items = await lineRows(order.id);

  const invoiceType: 1 | 3 = order.refund_of ? 3 : 1;
  let refUsin: string | null = null;
  let refFiscal: string | null = null;
  let original: Record<string, unknown> | undefined;
  if (invoiceType === 3) {
    original = (await sql.execute(`SELECT * FROM rest_orders WHERE id = ? AND tenant_id = ?`, [order.refund_of, T])).rows[0];
    refUsin = original?.invoice_no != null ? String(original.invoice_no) : null;
    if (!refUsin) problems.push("The original invoice of this refund was not found.");
    // A credit note references an invoice PRA has: the original must be accepted first (same environment).
    const origSub = (await sql.execute(`SELECT status, fiscal_invoice_no FROM pra_submissions WHERE tenant_id = ? AND source_type = 'rest_order' AND source_id = ? AND invoice_type = 1 AND environment = ?`,
      [T, order.refund_of, environment])).rows[0];
    if (!origSub || (origSub.status !== "accepted" && origSub.status !== "legacy")) problems.push("Waiting for PRA to accept the original invoice before its credit note is sent.");
    refFiscal = (origSub?.fiscal_invoice_no as string | null | undefined) ?? null;
    // Every credit of this original (this one included) stays within the original's quantity, value and tax.
    if (original) {
      const credits = (await sql.execute(`SELECT id FROM rest_orders WHERE refund_of = ? AND tenant_id = ? AND deleted_at IS NULL`, [order.refund_of, T])).rows.map((r) => String(r.id));
      if (credits.length > 1) cases.push("multiple_partial_credits");
      const origItems = await lineRows(String(original.id));
      let q = 0, v = 0, t = 0;
      for (const id of credits) for (const i of id === order.id ? items : await lineRows(id)) { q += Number(i.qty) || 0; v += paise(Number(i.line_total)) - paise(Number(i.line_discount ?? 0)); t += paise(Number(i.line_tax ?? 0)); }
      const oq = origItems.reduce((s, i) => s + (Number(i.qty) || 0), 0);
      const ov = origItems.reduce((s, i) => s + paise(Number(i.line_total)) - paise(Number(i.line_discount ?? 0)), 0);
      const ot = origItems.reduce((s, i) => s + paise(Number(i.line_tax ?? 0)), 0);
      if (q > oq + 1e-9 || v > ov || t > ot) problems.push(`Credits for invoice ${refUsin} would exceed the original (quantity ${q}/${oq}, value ${rupees(v)}/${rupees(ov)}, tax ${rupees(t)}/${rupees(ot)}).`);
    }
  }

  // Payment: every component kept as taken; PaymentMode and rate class per the documented / confirmed mapping.
  const components = componentsOf(order.payments);
  const own = checkPayment(components, states);
  // A credit note takes its original's rate (the tax charged then), not how the refund was paid out.
  const rated = original ? checkPayment(componentsOf(original.payments), states) : own;
  problems.push(...new Set([...own.problems, ...rated.problems]));
  for (const k of [...own.cases, ...rated.cases]) if (!cases.includes(k)) cases.push(k);
  for (const k of cases) { const b = caseBlock(k, states, environment); if (b) problems.push(b); }
  if (rule) {
    const want = expectedRate(rule, rated.taxClass);
    if (rule.rate_type !== "percent") problems.push("A fixed-amount rule can't price a restaurant bill.");
    else if (want == null) problems.push("The rule's rate for this payment is pending (see PRA cases).");
    else if (Math.abs(Number(order.tax_rate) - want) > 1e-9) problems.push(`The bill charged ${order.tax_rate} % sales tax; the approved rule (${rule.rule_key} v${rule.version}) requires ${want} % for this payment. Correct the restaurant's tax settings; the bill is not sent.`);
  }

  const pct = pctCodeOf(rule?.classification_code);
  if (rule && !pct) problems.push("The rule has no 8-digit classification code.");
  const lines: PraSourceLine[] = items.map((i) => ({
    code: String(i.code || String(i.id).slice(0, 12)), name: String(i.name), qty: Number(i.qty) || 0,
    grossPaisa: paise(Number(i.line_total)), discountPaisa: paise(Number(i.line_discount ?? 0)), taxPaisa: paise(Number(i.line_tax ?? 0)),
    taxRate: Number(i.tax_exempt) ? 0 : Number(order.tax_rate),
  }));
  if (Number(order.service_charge) > 0) {
    const lineTax = lines.reduce((s, l) => s + l.taxPaisa, 0);
    const svcTax = paise(order.tax) - lineTax;
    lines.push({ code: "SERVICE", name: "Service Charges", qty: 1, grossPaisa: paise(order.service_charge), discountPaisa: 0, taxPaisa: svcTax, taxRate: svcTax > 0 ? Number(order.tax_rate) : 0 });
  }
  if (!lines.length) problems.push("The bill has no lines.");
  const usin = order.invoice_no != null ? String(order.invoice_no) : "";
  if (!usin) problems.push("The bill has no invoice number.");
  let payload: string | null = null;
  const sale = lines.reduce((s, l) => s + l.grossPaisa - l.discountPaisa, 0);
  const tax = lines.reduce((s, l) => s + l.taxPaisa, 0);
  if (pct && usin && posId && lines.length) {
    const inv = buildPraInvoice({
      posId, usin, refUsin, invoiceType, at: new Date(order.invoiced_at ?? order.created_at), pctCode: pct, methods: own.methods,
      buyerName: order.customer_name, buyerPhone: order.customer_phone, lines,
    });
    // PaymentMode from the documented / confirmed mapping (the actual components stay in payment_components).
    if (own.praMode != null) inv.PaymentMode = own.praMode;
    problems.push(...validatePraInvoice(inv));
    if (Math.abs(inv.TotalBillAmount - Number(order.total)) > 0.011) problems.push(`The PRA total (${inv.TotalBillAmount}) differs from the bill's total (${order.total}).`);
    payload = JSON.stringify(inv);
  }
  return {
    pos, environment, posId, usin, refUsin, refFiscal, invoiceType, rule, payload, methods: own.methods, components, praMode: own.praMode, cases, problems: [...new Set(problems)],
    sale: rupees(sale), tax: rupees(tax), total: Number(order.total), qty: lines.reduce((s, l) => s + l.qty, 0),
  };
}

const json = <T,>(v: unknown, fallback: T): T => { try { return v == null ? fallback : (JSON.parse(String(v)) as T); } catch { return fallback; } };
const SAFE = (r: Record<string, unknown>) => ({
  id: String(r.id), sourceType: String(r.source_type), sourceId: String(r.source_id), branchId: (r.branch_id as string | null) ?? null,
  posId: String(r.pos_id), environment: String(r.environment), usin: String(r.usin), refUsin: (r.ref_usin as string | null) ?? null, refFiscalInvoiceNo: (r.ref_fiscal_invoice_no as string | null) ?? null,
  invoiceType: Number(r.invoice_type), status: String(r.status) as SubStatus, attempts: Number(r.attempts), fiscalInvoiceNo: (r.fiscal_invoice_no as string | null) ?? null,
  responseCode: (r.response_code as string | null) ?? null, responseText: (r.response_text as string | null) ?? null, blockedReason: (r.blocked_reason as string | null) ?? null,
  saleValue: Number(r.sale_value), salesTax: Number(r.sales_tax), praWithholding: Number(r.pra_withholding), incomeTaxWithholding: Number(r.income_tax_withholding), total: Number(r.total), quantity: Number(r.total_quantity ?? 0),
  paymentMethods: json<string[]>(r.payment_methods, []), paymentComponents: json<PaymentComponent[]>(r.payment_components, []), praPaymentMode: r.pra_payment_mode == null ? null : Number(r.pra_payment_mode),
  cases: json<PraCaseKey[]>(r.case_keys, []),
  rule: (() => { const s = json<Record<string, unknown> | null>(r.rule_snapshot, null); return s ? { ruleKey: String(s.rule_key), version: Number(s.version), classification: (s.classification_code as string | null) ?? null } : null; })(),
  sentAt: (r.sent_at as string | null) ?? null, acceptedAt: (r.accepted_at as string | null) ?? null, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});

async function subRow(sql: Sql, where: string, args: unknown[]) {
  return ((await sql.execute(`SELECT * FROM pra_submissions WHERE ${where}`, args)).rows[0] as Record<string, unknown> | undefined) ?? null;
}

/** The bill's own PRA status (what the receipt and the order lists show). */
// ── Service invoices (contractors and other non-restaurant sectors) ──────────

type SourceKind = "rest_order" | "invoice";
interface InvoiceRow { id: string; tenant_id: string; branch_id: string | null; invoice_no: number | null; date: string; created_at: string; inv_on: string | null; invoice_type: string | null; is_return: number | null; is_memorized: number | null; is_quotation: number | null; original_invoice_id: string | null; total: number; discount_rs: number; charges: number; payable: number; customer_name: string | null; customer_phone: string | null }

/** Sectors whose bills are restaurant orders; every other sector bills through the shared invoice. */
const RESTAURANT_SECTORS = ["restaurant", "hotel"];

/** The owner's switch (PRA e-Invoicing page): off holds PRA invoices, on sends them. Nothing is lost while it is off. */
const SENDING_OFF = "PRA sending is switched off for this business. This invoice is sent when it is switched on again.";
async function sendingOn(sql: Sql, T: string): Promise<boolean> {
  return (await sql.execute(`SELECT value FROM settings WHERE key = ?`, [`${T}::pra_sending`])).rows[0]?.value !== "off";
}

/** The owner (or Super Admin) switches sending PRA invoices on or off. */
export async function setSending(sql: Sql, c: Caller, input: { tenantId?: unknown; enabled?: unknown }, deps: PraDeps = {}) {
  const T = tenantFor(c, input);
  ownerOrSuper(c, T);
  if (typeof input.enabled !== "boolean") throw new HttpError(400, "Say whether PRA sending is on or off.");
  if ((await account(sql, T))?.status !== "enabled") throw new HttpError(409, "PRA is not enabled for this business.");
  const now = iso(nowOf(deps));
  await sql.execute(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [`${T}::pra_sending`, input.enabled ? "on" : "off", now]);
  await audit(sql, T, c, input.enabled ? "sending.on" : "sending.off", null, deps);
  return { sending: input.enabled };
}

/** Everything needed to send one service invoice (contractor and others), or why it can't be sent. Nothing is written. */
async function prepareInvoice(sql: Sql, T: string, inv: InvoiceRow, deps: PraDeps): Promise<Prepared | { skip: string }> {
  if (Number(inv.is_quotation) === 1 || Number(inv.is_memorized) === 1) return { skip: "Quotations and drafts are not fiscal invoices." };
  if (inv.invoice_no == null) return { skip: "The invoice has no number yet." };
  // Goods supplied under a contract (medicine) are not a Punjab service: they are not reported to PRA.
  if (String(inv.invoice_type ?? "").toLowerCase() === "medicine") return { skip: "Goods supply (Medicine invoice) is not a PRA service invoice." };
  const a = await account(sql, T);
  if (!a || a.status !== "enabled") return { skip: "PRA is not enabled for this business." };
  const branchId = inv.branch_id ?? (await mainBranch(sql, T));
  const pos = (await counters(sql, T)).find((p) => p.branch_id === branchId && p.status === "approved");
  if (!pos) return { skip: "No approved PRA counter for this branch." };
  if (RESTAURANT_SECTORS.includes(pos.sector)) return { skip: "This counter fiscalises restaurant bills." };
  // A contractor chooses per invoice: PRA Invoice goes to PRA; General and Medicine are FBR's.
  if (PRA_INVOICE_SECTORS.includes(pos.sector) && !isPraInvoice(inv.invoice_type)) return { skip: "Only a PRA Invoice is reported to PRA." };
  const at = inv.created_at;
  if (pos.active_from && at < pos.active_from) return { skip: "Issued before PRA was switched on for this counter." };
  const environment: PraEnvironment = pos.environment === "production" ? "production" : "sandbox";
  const states = await caseStates(sql);
  const problems: string[] = [];
  const cases: PraCaseKey[] = [];
  if (!(await sendingOn(sql, T))) problems.push(SENDING_OFF);
  if (environment === "production") {
    if (!a.live_approved_at) problems.push("Going live has not been approved by the Super Admin.");
    if (process.env.PRA_PRODUCTION_ENABLED !== "1" && deps.env?.PRA_PRODUCTION_ENABLED !== "1") problems.push("Live PRA submission is switched off on this server (PRA_PRODUCTION_ENABLED).");
    if (!a.pntn) problems.push("No PNTN recorded.");
    if (pos.whitelist_status !== "approved") problems.push(`PRA has not whitelisted the server IP for PNTN ${a.pntn ?? "?"} / POS ID ${pos.production_pos_id ?? "?"}.`);
  }
  const posId = (environment === "production" ? pos.production_pos_id : pos.sandbox_pos_id) ?? "";
  if (!posId) problems.push(`No ${environment} POS ID for counter "${pos.counter}".`);
  if (!(environment === "production" ? pos.production_token_enc : pos.sandbox_token_enc)) problems.push(`No ${environment} token for counter "${pos.counter}".`);
  if (pos.sector === "marriage_hall" || pos.sector === "catering") cases.push("advance_payments");

  const day = (inv.date || at).slice(0, 10);
  const assigned = (await sql.execute(`SELECT rule_key FROM pra_rule_assignments WHERE tenant_id = ? AND status = 'active' AND (branch_id = ? OR branch_id IS NULL) ORDER BY (branch_id IS NULL)`, [T, branchId])).rows;
  const rules = await allRules(sql);
  // Every approved rule assigned to this branch: a service is matched to the rule of its PCT code.
  const inForce: PraRule[] = [];
  for (const x of assigned) {
    const r = ruleOn(rules, String(x.rule_key), day);
    if (r && r.sector === pos.sector && !inForce.some((y) => y.id === r.id)) inForce.push(r);
  }
  const defaultRule = inForce[0] ?? null;
  if (!defaultRule) problems.push(`No approved PRA tax rule for sector "${pos.sector}" is assigned to this branch for ${day}.`);

  // A bill discount or extra charges come after tax on MAVIN's invoice: how PRA wants them reported is not settled.
  if (Math.abs(Number(inv.discount_rs) || 0) > 0.004) problems.push("The invoice has a bill discount (after tax); how PRA wants it reported is pending. Put discounts on the lines.");
  if (Math.abs(Number(inv.charges) || 0) > 0.004) problems.push("The invoice has extra charges; how PRA wants them reported is pending.");

  const lineRows = async (id: string) => (await sql.execute(
    `SELECT i.*, p.name AS product_name, p.barcode AS product_code, p.pct_code AS product_pct FROM invoice_items i LEFT JOIN products p ON p.id = i.product_id
     WHERE i.invoice_id = ? AND i.deleted_at IS NULL ORDER BY i.created_at, i.id`, [id])).rows;
  const isReturn = Number(inv.is_return) === 1;
  const saved = await lineRows(inv.id);
  // A return is saved without tax or discount on its lines; its PRA credit note takes them from the
  // original invoice's matching line, in proportion to the quantity returned, so the tax charged is reversed.
  const origLines = isReturn && inv.original_invoice_id ? await lineRows(inv.original_invoice_id) : [];
  const items = !isReturn ? saved : saved.map((i) => {
    const o = origLines.find((x) => x.product_id === i.product_id && (x.batch_no ?? null) === (i.batch_no ?? null) && Math.abs(Number(x.sale_price) - Number(i.sale_price)) < 0.005)
      ?? origLines.find((x) => x.product_id === i.product_id);
    if (!o || !(Number(o.qty) > 0)) { problems.push(`Returned line ${String(i.product_name ?? i.product_id)} has no matching line on the original invoice.`); return i; }
    const ratio = (Number(i.qty) || 0) / Number(o.qty);
    return { ...i, sale_price: o.sale_price, tax_pct: o.tax_pct, discount_rs: Number(o.discount_rs ?? 0) * ratio, tax_rs: Number(o.tax_rs ?? 0) * ratio };
  });
  // Each line under an approved rule: a service by its own PCT code and rate, any other item under the branch's rule.
  const ruleOfLine = (i: Record<string, unknown>): PraRule | null => {
    if (!i.product_pct) return defaultRule;
    const code = pctCodeOf(String(i.product_pct));
    const same = inForce.filter((r) => code && pctCodeOf(r.classification_code) === code);
    return same.find((r) => Math.abs(Number(r.rate) - (Number(i.tax_pct) || 0)) <= 1e-9) ?? same[0] ?? null;
  };
  const used = new Map<string, { rule: PraRule; off: number }>();
  for (const i of items) {
    const r = ruleOfLine(i);
    if (!r) {
      if (i.product_pct) problems.push(`Service "${String(i.product_name ?? i.product_id)}": PCT code ${String(i.product_pct)} has no approved PRA tax rule assigned to this business.`);
      continue;
    }
    const u = used.get(r.id) ?? { rule: r, off: 0 };
    if (r.rate_type === "percent" && Math.abs((Number(i.tax_pct) || 0) - Number(r.rate)) > 1e-9) u.off += 1;
    used.set(r.id, u);
  }
  for (const { rule: r, off } of used.values()) {
    if (r.eims_applicable !== "yes") problems.push(`eIMS reporting for "${r.service}" is not confirmed (approve a rule version with eIMS = yes once PRA enrolled this business).`);
    if (r.rate_type !== "percent") problems.push("A fixed-amount rule can't price this invoice yet.");
    if (!pctCodeOf(r.classification_code)) problems.push("The rule has no 8-digit classification code.");
    if (off) problems.push(`${off} line(s) charge a sales tax rate other than the approved rule's ${r.rate} % (${r.rule_key} v${r.version}). Correct the lines; the invoice is not sent.`);
  }
  const rule = [...used.values()][0]?.rule ?? defaultRule;
  const pct = pctCodeOf(rule?.classification_code);
  const lines: PraSourceLine[] = items.map((i) => {
    const gross = paise((Number(i.qty) || 0) * (Number(i.sale_price) || 0));
    return {
      code: String(i.product_code || String(i.product_id).slice(0, 12)), name: String(i.product_name ?? "Service"), qty: Number(i.qty) || 0,
      grossPaisa: gross, discountPaisa: paise(Number(i.discount_rs ?? 0)), taxPaisa: paise(Number(i.tax_rs ?? 0)), taxRate: Number(i.tax_pct) || 0,
      pctCode: pctCodeOf(ruleOfLine(i)?.classification_code),
    };
  });
  if (!lines.length) problems.push("The invoice has no lines.");

  const invoiceType: 1 | 3 = isReturn ? 3 : 1;
  let refUsin: string | null = null;
  let refFiscal: string | null = null;
  if (isReturn) {
    const original = inv.original_invoice_id ? (await sql.execute(`SELECT id, invoice_no FROM invoices WHERE id = ? AND tenant_id = ?`, [inv.original_invoice_id, T])).rows[0] : undefined;
    refUsin = original?.invoice_no != null ? String(original.invoice_no) : null;
    if (!refUsin) problems.push("The original invoice of this return was not found.");
    const origSub = original ? (await sql.execute(`SELECT status, fiscal_invoice_no FROM pra_submissions WHERE tenant_id = ? AND source_type = 'invoice' AND source_id = ? AND invoice_type = 1 AND environment = ?`, [T, original.id, environment])).rows[0] : undefined;
    if (!origSub || origSub.status !== "accepted") problems.push("Waiting for PRA to accept the original invoice before its credit note is sent.");
    refFiscal = (origSub?.fiscal_invoice_no as string | null | undefined) ?? null;
    if (original) {
      const credits = (await sql.execute(`SELECT id FROM invoices WHERE original_invoice_id = ? AND tenant_id = ? AND is_return = 1 AND deleted_at IS NULL`, [original.id, T])).rows.map((r) => String(r.id));
      if (credits.length > 1) cases.push("multiple_partial_credits");
      // Quantities returned (all returns of the original) against the original's; value and tax follow the quantity.
      let cq = 0;
      for (const id of credits) for (const i of id === inv.id ? saved : await lineRows(id)) cq += Number(i.qty) || 0;
      const oq = origLines.reduce((s, i) => s + (Number(i.qty) || 0), 0);
      const ov = origLines.reduce((s, i) => s + paise((Number(i.qty) || 0) * (Number(i.sale_price) || 0)) - paise(Number(i.discount_rs ?? 0)), 0);
      const ot = origLines.reduce((s, i) => s + paise(Number(i.tax_rs ?? 0)), 0);
      const share = oq > 0 ? cq / oq : 0;
      const c = { q: cq, v: Math.round(ov * share), t: Math.round(ot * share) };
      const o = { q: oq, v: ov, t: ot };
      if (c.q > o.q + 1e-9) problems.push(`Returns of invoice ${refUsin} would exceed the original (quantity ${c.q}/${o.q}, value ${rupees(c.v)}/${rupees(o.v)}, tax ${rupees(c.t)}/${rupees(o.t)}).`);
    }
  }

  // Payment: cash, or on credit (paid later). The rule decides the rate; PaymentMode from the documented / confirmed mapping.
  const credit = String(inv.inv_on ?? "cash").toLowerCase() === "credit";
  const components: PaymentComponent[] = [{ method: credit ? "credit" : "cash", amount: Number(inv.payable) || 0 }];
  const pay = checkPayment(components, states);
  problems.push(...pay.problems);
  for (const k of pay.cases) if (!cases.includes(k)) cases.push(k);
  for (const k of cases) { const b = caseBlock(k, states, environment); if (b) problems.push(b); }

  const usin = String(inv.invoice_no);
  let payload: string | null = null;
  const sale = lines.reduce((s, l) => s + l.grossPaisa - l.discountPaisa, 0);
  const tax = lines.reduce((s, l) => s + l.taxPaisa, 0);
  if (pct && posId && lines.length) {
    const built = buildPraInvoice({
      posId, usin, refUsin, invoiceType, at: new Date(at), pctCode: pct, methods: pay.methods,
      buyerName: inv.customer_name, buyerPhone: inv.customer_phone, lines,
    });
    if (pay.praMode != null) built.PaymentMode = pay.praMode;
    problems.push(...validatePraInvoice(built));
    if (!isReturn && !problems.some((p) => /bill discount|extra charges/.test(p)) && Math.abs(built.TotalBillAmount - Number(inv.payable)) > 0.011 * Math.max(1, lines.length))
      problems.push(`The PRA total (${built.TotalBillAmount}) differs from the invoice's payable (${inv.payable}).`);
    payload = JSON.stringify(built);
  }
  return {
    pos, environment, posId, usin, refUsin, refFiscal, invoiceType, rule, payload, methods: pay.methods, components, praMode: pay.praMode, cases, problems: [...new Set(problems)],
    sale: rupees(sale), tax: rupees(tax), total: isReturn ? rupees(sale + tax) : Number(inv.payable) || 0, qty: lines.reduce((s, l) => s + l.qty, 0),
  };
}

/** The bill a submission is for: loaded, checked, prepared. */
async function prepareSource(sql: Sql, T: string, kind: SourceKind, id: string, deps: PraDeps): Promise<Prepared | { skip: string }> {
  if (kind === "invoice") {
    const inv = (await sql.execute(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [id, T])).rows[0] as unknown as InvoiceRow | undefined;
    if (!inv) throw new HttpError(404, "Invoice not found.");
    return prepareInvoice(sql, T, inv, deps);
  }
  const order = (await sql.execute(`SELECT * FROM rest_orders WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [id, T])).rows[0] as unknown as OrderRow | undefined;
  if (!order) throw new HttpError(404, "Bill not found.");
  if (order.status !== "paid" && order.status !== "refunded") throw new HttpError(409, "Only a paid bill is fiscalised.");
  return prepareRestaurant(sql, T, order, deps);
}

async function markOrder(sql: Sql, T: string, orderId: string, status: string, fiscalNo: string | null, now: string, kind: string = "rest_order") {
  if (kind !== "rest_order") return;
  const orderStatus = status === "accepted" ? "accepted" : status === "blocked" ? "blocked" : status === "rejected" ? "rejected" : status === "needs_reconciliation" ? "manual_review" : "pending";
  await sql.execute(`UPDATE rest_orders SET pra_status = ?, pra_invoice_no = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [orderStatus, status === "accepted" ? fiscalNo : null, now, orderId, T]);
}

/** Sends (or re-checks) one restaurant bill. Safe to call any number of times, from any counter. */
export function fiscalizeOrder(sql: Sql, T: string, orderId: string, actor: Caller | null, deps: PraDeps = {}) {
  return fiscalizeSource(sql, T, "rest_order", orderId, actor, deps);
}

/** Sends (or re-checks) one bill: a restaurant order or a service invoice (contractors). Safe to call any number of times. */
export async function fiscalizeSource(sql: Sql, T: string, kind: SourceKind, orderId: string, actor: Caller | null, deps: PraDeps = {}): Promise<ReturnType<typeof SAFE> | { status: "not_required"; reason: string }> {
  // Sent by the old desktop sender already (Restaurant > PRA on the Tauri app): never a second fiscal invoice.
  const legacy = kind === "rest_order" ? (await sql.execute(`SELECT status, pra_invoice_no FROM rest_pra_submissions WHERE order_id = ? AND tenant_id = ? AND status IN ('accepted', 'submitting', 'manual_review')`, [orderId, T]).catch(() => ({ rows: [] }))).rows[0] : undefined;
  const prep = await prepareSource(sql, T, kind, orderId, deps);
  if ("skip" in prep) return { status: "not_required", reason: prep.skip };
  const now = iso(nowOf(deps));
  const existing = await subRow(sql, "tenant_id = ? AND source_type = ? AND source_id = ? AND invoice_type = ? AND environment = ?", [T, kind, orderId, prep.invoiceType, prep.environment]);

  if (!existing) {
    const status: SubStatus = legacy ? "legacy" : prep.problems.length ? "blocked" : "sending";
    const snapshot = prep.rule ? JSON.stringify({ ...prep.rule, summary: undefined, applied_at: now }) : null;
    try {
      await sql.execute(
        `INSERT INTO pra_submissions (id, tenant_id, branch_id, pos_row_id, pos_id, environment, source_type, source_id, usin, ref_usin, invoice_type, status, attempts, fiscal_invoice_no, payload, payload_hash,
           payment_methods, pra_payment_mode, rule_snapshot, sale_value, sales_tax, total, blocked_reason, lock_until, created_at, updated_at, payment_components, ref_fiscal_invoice_no, case_keys, total_quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), T, prep.pos.branch_id, prep.pos.id, prep.posId || "-", prep.environment, kind, orderId, prep.usin || `-${orderId}`, prep.refUsin, prep.invoiceType, status,
          status === "sending" ? 1 : 0, (legacy?.pra_invoice_no as string | null | undefined) ?? null, prep.payload, prep.payload ? sha(prep.payload) : null, JSON.stringify(prep.methods), prep.praMode, snapshot,
          prep.sale, prep.tax, prep.total, status === "blocked" ? prep.problems.join(" ") : status === "legacy" ? "Sent by the desktop PRA sender (Restaurant > PRA)." : null,
          status === "sending" ? iso(new Date(nowOf(deps).getTime() + SEND_LOCK_MS)) : null, now, now, JSON.stringify(prep.components), prep.refFiscal, JSON.stringify(prep.cases), prep.qty]);
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      // Another counter / request recorded it first: theirs stands.
      const other = await subRow(sql, "tenant_id = ? AND source_type = ? AND source_id = ? AND invoice_type = ? AND environment = ?", [T, kind, orderId, prep.invoiceType, prep.environment]);
      if (other) return SAFE(other);
      throw new HttpError(409, "This invoice number is already recorded with PRA for this counter.");
    }
    const row = (await subRow(sql, "tenant_id = ? AND source_type = ? AND source_id = ? AND invoice_type = ? AND environment = ?", [T, kind, orderId, prep.invoiceType, prep.environment]))!;
    await markOrder(sql, T, orderId, status === "legacy" ? (legacy?.status === "accepted" ? "accepted" : "needs_reconciliation") : status, (legacy?.pra_invoice_no as string | null | undefined) ?? null, now, kind);
    if (status !== "sending") {
      await audit(sql, T, actor, `submission.${status}`, { id: row.id, usin: prep.usin, problems: prep.problems }, deps);
      return SAFE(row);
    }
    return send(sql, T, row, prep, actor, deps);
  }

  const st = String(existing.status) as SubStatus;
  // Blocked: never sent, so it may be checked again once the setup is fixed.
  if (st === "blocked") {
    if (prep.problems.length) {
      await sql.execute(`UPDATE pra_submissions SET blocked_reason = ?, updated_at = ? WHERE id = ? AND status = 'blocked'`, [prep.problems.join(" "), now, existing.id]);
      return SAFE((await subRow(sql, "id = ?", [existing.id]))!);
    }
    const claimed = await sql.execute(
      `UPDATE pra_submissions SET status = 'sending', attempts = attempts + 1, pos_row_id = ?, pos_id = ?, usin = ?, ref_usin = ?, payload = ?, payload_hash = ?, payment_methods = ?, pra_payment_mode = ?, rule_snapshot = ?,
         sale_value = ?, sales_tax = ?, total = ?, blocked_reason = NULL, lock_until = ?, updated_at = ?, payment_components = ?, ref_fiscal_invoice_no = ?, case_keys = ?, total_quantity = ? WHERE id = ? AND status = 'blocked'`,
      [prep.pos.id, prep.posId, prep.usin, prep.refUsin, prep.payload, sha(prep.payload!), JSON.stringify(prep.methods), prep.praMode, JSON.stringify({ ...prep.rule, applied_at: now }),
        prep.sale, prep.tax, prep.total, iso(new Date(nowOf(deps).getTime() + SEND_LOCK_MS)), now, JSON.stringify(prep.components), prep.refFiscal, JSON.stringify(prep.cases), prep.qty, existing.id]);
    if (!claimed.rowsAffected) return SAFE((await subRow(sql, "id = ?", [existing.id]))!);
    return send(sql, T, (await subRow(sql, "id = ?", [existing.id]))!, prep, actor, deps);
  }
  // Queued (never reached PRA): send the stored payload again, exactly as recorded (held while the owner has sending off).
  if (st === "queued") {
    if (prep.problems.includes(SENDING_OFF)) return SAFE(existing);
    const claimed = await sql.execute(`UPDATE pra_submissions SET status = 'sending', attempts = attempts + 1, lock_until = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
      [iso(new Date(nowOf(deps).getTime() + SEND_LOCK_MS)), now, existing.id]);
    if (!claimed.rowsAffected) return SAFE((await subRow(sql, "id = ?", [existing.id]))!);
    return send(sql, T, (await subRow(sql, "id = ?", [existing.id]))!, prep, actor, deps);
  }
  // A send that lost its sender (server stopped mid-request): it may have reached PRA.
  if (st === "sending" && String(existing.lock_until ?? "") < now) {
    await sql.execute(`UPDATE pra_submissions SET status = 'needs_reconciliation', response_text = ?, lock_until = NULL, updated_at = ? WHERE id = ? AND status = 'sending' AND lock_until < ?`,
      ["The send was interrupted; it may have reached PRA. Check the IRIS IMS Fiscal Report.", now, existing.id, now]);
    await markOrder(sql, T, orderId, "needs_reconciliation", null, now, kind);
  }
  return SAFE((await subRow(sql, "id = ?", [existing.id]))!);
}

/** The one network call, then the outcome recorded. */
async function send(sql: Sql, T: string, row: Record<string, unknown>, prep: Prepared, actor: Caller | null, deps: PraDeps) {
  const env = prep.environment;
  const tokenEnc = env === "production" ? prep.pos.production_token_enc : prep.pos.sandbox_token_enc;
  const token = openPra(tokenEnc);
  const payload = String(row.payload);
  const res = token ? await postToPra(env, token, payload, T, deps) : { outcome: "not_sent" as const, error: "No token." };
  const now = iso(nowOf(deps));
  let status: SubStatus, fiscal: string | null = null, code: string | null = null, text: string;
  if (res.outcome === "not_sent") {
    status = "queued";
    text = res.error;
  } else if (res.outcome === "uncertain") {
    status = "needs_reconciliation";
    text = `${res.error} It may have reached PRA: check the IRIS IMS Fiscal Report before sending again.`;
  } else {
    const o = mapPraResponse({ httpStatus: res.status, body: res.body });
    code = o.code;
    if (o.status === "accepted") { status = "accepted"; fiscal = o.praInvoiceNo; text = o.message; }
    else if (o.status === "rejected" && res.status < 500) { status = "rejected"; text = o.message; }
    else { status = "needs_reconciliation"; text = `${o.message} (HTTP ${res.status}). Check the IRIS IMS Fiscal Report.`; }
  }
  // Only the fields of PRA's answer we need, never the request (buyer details).
  await sql.execute(
    `UPDATE pra_submissions SET status = ?, fiscal_invoice_no = ?, response_code = ?, response_text = ?, sent_at = ?, accepted_at = ?, lock_until = NULL, updated_at = ? WHERE id = ? AND status = 'sending'`,
    [status, fiscal, code, text.slice(0, 500), now, status === "accepted" ? now : null, now, row.id]);
  await markOrder(sql, T, String(row.source_id), status, fiscal, now, String(row.source_type));
  await audit(sql, T, actor, `submission.${status}`, { id: row.id, usin: row.usin, environment: env, code }, deps);
  return SAFE((await subRow(sql, "id = ?", [row.id]))!);
}

/** Checkout: a counter asks for its bill to be fiscalised (staff of that branch, the owner). */
export async function submit(sql: Sql, c: Caller, input: { orderId?: unknown; invoiceId?: unknown }, scope: BranchScope | undefined, deps: PraDeps = {}) {
  if (isSuper(c) || !c.tenantId) throw new HttpError(403, "Bills are fiscalised from the business's own login.");
  const T = c.tenantId;
  const kind: SourceKind = input.invoiceId ? "invoice" : "rest_order";
  const id = str(kind === "invoice" ? input.invoiceId : input.orderId, 80);
  const o = (await sql.execute(`SELECT branch_id FROM ${kind === "invoice" ? "invoices" : "rest_orders"} WHERE id = ? AND tenant_id = ?`, [id, T])).rows[0];
  if (!o) throw new HttpError(404, kind === "invoice" ? "Invoice not found." : "Bill not found.");
  const branch = (o.branch_id as string | null) ?? (await mainBranch(sql, T));
  if (scope && c.role === "staff" && branch && !scope.accessible.includes(branch)) throw new HttpError(403, "This bill belongs to another branch.");
  return fiscalizeSource(sql, T, kind, id, c, deps);
}

/** A bill's PRA record (invoice view and print): status and fiscal number, never the payload. */
export async function forSource(sql: Sql, c: Caller, input: { sourceType?: unknown; sourceId?: unknown }) {
  if (isSuper(c) || !c.tenantId) throw new HttpError(403, "Not allowed.");
  const kind = input.sourceType === "invoice" ? "invoice" : "rest_order";
  const r = await subRow(sql, "tenant_id = ? AND source_type = ? AND source_id = ? ORDER BY (environment = 'production') DESC, created_at DESC LIMIT 1", [c.tenantId, kind, str(input.sourceId, 80)]);
  return r ? SAFE(r) : null;
}

/** Bills that were never handed to PRA (a closed tab, an outage), and sends that never left. Cron, and the restaurant screen every minute. */
export async function sweep(sql: Sql, deps: PraDeps = {}, onlyTenant?: string) {
  const now = nowOf(deps);
  const since = iso(new Date(now.getTime() - SWEEP_DAYS * 864e5));
  const accounts = (await sql.execute(`SELECT tenant_id FROM pra_accounts WHERE status = 'enabled'${onlyTenant ? " AND tenant_id = ?" : ""}`, onlyTenant ? [onlyTenant] : [])).rows;
  const counts: Record<string, number> = {};
  for (const a of accounts) {
    const T = String(a.tenant_id);
    const pos = (await counters(sql, T)).filter((p) => p.status === "approved");
    if (!pos.length) continue;
    const from = pos.map((p) => p.active_from ?? since).sort()[0];
    const due = (await sql.execute(
      `SELECT o.id FROM rest_orders o WHERE o.tenant_id = ? AND o.status IN ('paid', 'refunded') AND o.invoice_no IS NOT NULL AND o.deleted_at IS NULL
         AND COALESCE(o.invoiced_at, o.created_at) >= ? AND COALESCE(o.invoiced_at, o.created_at) >= ?
         AND NOT EXISTS (SELECT 1 FROM pra_submissions s WHERE s.tenant_id = o.tenant_id AND s.source_type = 'rest_order' AND s.source_id = o.id AND s.status NOT IN ('queued', 'blocked'))
       ORDER BY (o.refund_of IS NOT NULL), COALESCE(o.invoiced_at, o.created_at) LIMIT 50`, [T, since, from])).rows;
    for (const o of due) {
      try {
        const r = await fiscalizeOrder(sql, T, String(o.id), null, deps);
        counts[r.status] = (counts[r.status] ?? 0) + 1;
      } catch { counts.error = (counts.error ?? 0) + 1; }
    }
    const invoiceCounters = pos.filter((p) => !RESTAURANT_SECTORS.includes(p.sector));
    if (invoiceCounters.length && (await sendingOn(sql, T))) {
      // Contractors: only PRA invoices are due, so their General and Medicine invoices never fill the batch.
      const onlyPra = invoiceCounters.every((p) => PRA_INVOICE_SECTORS.includes(p.sector));
      const invs = (await sql.execute(
        `SELECT i.id FROM invoices i WHERE i.tenant_id = ? AND i.invoice_no IS NOT NULL AND i.deleted_at IS NULL AND COALESCE(i.is_quotation, 0) = 0 AND COALESCE(i.is_memorized, 0) = 0
           AND i.created_at >= ? AND i.created_at >= ?${onlyPra ? ` AND LOWER(COALESCE(i.invoice_type, '')) = '${PRA_INVOICE_TYPE}'` : ""}
           AND NOT EXISTS (SELECT 1 FROM pra_submissions s WHERE s.tenant_id = i.tenant_id AND s.source_type = 'invoice' AND s.source_id = i.id AND s.status NOT IN ('queued', 'blocked'))
         ORDER BY COALESCE(i.is_return, 0), i.created_at LIMIT 50`, [T, since, from])).rows;
      for (const o of invs) {
        try {
          const r = await fiscalizeSource(sql, T, "invoice", String(o.id), null, deps);
          counts[r.status] = (counts[r.status] ?? 0) + 1;
        } catch { counts.error = (counts.error ?? 0) + 1; }
      }
    }
    // Sends that lost their sender: may have reached PRA.
    const stale = (await sql.execute(`SELECT id, source_id, source_type FROM pra_submissions WHERE tenant_id = ? AND status = 'sending' AND lock_until < ?`, [T, iso(now)])).rows;
    for (const s of stale) {
      await sql.execute(`UPDATE pra_submissions SET status = 'needs_reconciliation', response_text = ?, lock_until = NULL, updated_at = ? WHERE id = ? AND status = 'sending'`,
        ["The send was interrupted; it may have reached PRA. Check the IRIS IMS Fiscal Report.", iso(now), s.id]);
      await markOrder(sql, T, String(s.source_id), "needs_reconciliation", null, iso(now), String(s.source_type));
      counts.needs_reconciliation = (counts.needs_reconciliation ?? 0) + 1;
    }
  }
  return counts;
}

/** After checking PRA's IRIS IMS Fiscal Report: record the fiscal number PRA shows, or that PRA has no record (then it is sent again). Owner or Super Admin. */
export async function reconcile(sql: Sql, c: Caller, input: { tenantId?: unknown; id?: unknown; found?: unknown; fiscalNo?: unknown; note?: unknown }, deps: PraDeps = {}) {
  const T = tenantFor(c, input);
  ownerOrSuper(c, T);
  const r = await subRow(sql, "id = ? AND tenant_id = ?", [str(input.id, 80), T]);
  if (!r) throw new HttpError(404, "Submission not found.");
  const st = String(r.status);
  const note = str(input.note, 300);
  const now = iso(nowOf(deps));
  if (input.found === true) {
    if (st !== "needs_reconciliation" && st !== "legacy") throw new HttpError(409, "Only a submission waiting for a portal check can be recorded.");
    const no = str(input.fiscalNo, 64);
    if (!isFiscalNumber(no)) throw new HttpError(400, "Enter the PRA fiscal invoice number exactly as the portal shows it (one token, no spaces).");
    await sql.execute(`UPDATE pra_submissions SET status = 'accepted', fiscal_invoice_no = ?, response_text = ?, accepted_at = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
      [no, `Recorded from the IRIS IMS Fiscal Report${note ? `: ${note}` : ""}`, now, c.userId, now, now, r.id]);
    await markOrder(sql, T, String(r.source_id), "accepted", no, now, String(r.source_type));
  } else if (input.found === false) {
    // Not on PRA's report: it never arrived, so it may be sent (the same record and payload).
    if (st !== "needs_reconciliation" && st !== "rejected") throw new HttpError(409, "Only a submission waiting for a portal check (or one PRA rejected) can be sent again.");
    if (st === "needs_reconciliation") {
      // A missing report entry right after the request proves nothing: wait, and say how it was checked.
      const waitH = Number((await sql.execute(`SELECT value FROM pra_platform WHERE key = 'reconcile_wait_hours'`)).rows[0]?.value) || RECONCILE_WAIT_HOURS;
      const sent = Date.parse(String(r.sent_at ?? r.updated_at));
      if (nowOf(deps).getTime() - sent < waitH * 3_600_000) throw new HttpError(409, `Wait at least ${waitH} hours after the request before deciding PRA has no record of it (sent ${String(r.sent_at ?? "").slice(0, 16).replace("T", " ")} UTC).`);
      if (!note) throw new HttpError(400, "Say how it was checked (IRIS IMS Fiscal Report by POS ID, USIN and time, or PRA support reference).");
    }
    await sql.execute(`UPDATE pra_submissions SET status = 'queued', resolved_by = ?, resolved_at = ?, response_text = ?, updated_at = ? WHERE id = ?`, [c.userId, now, `Not on the IRIS report${note ? `: ${note}` : ""}; queued again`, now, r.id]);
    await markOrder(sql, T, String(r.source_id), "queued", null, now, String(r.source_type));
  } else throw new HttpError(400, "Say whether PRA's report shows the invoice.");
  await audit(sql, T, c, input.found === true ? "reconcile.found" : "reconcile.not_found", { id: r.id, usin: r.usin, note }, deps);
  return SAFE((await subRow(sql, "id = ?", [r.id]))!);
}

/** Submissions of a business, branch-scoped (staff: their branches; owner: all; Super Admin: any business). Never the payload or buyer details. */
export async function list(sql: Sql, c: Caller, input: { tenantId?: unknown; status?: unknown; branchId?: unknown; limit?: unknown }, scope: BranchScope | undefined) {
  const T = tenantFor(c, input);
  if (!isSuper(c) && c.role === "staff" && !scope) throw new HttpError(403, "No branch.");
  const where = ["tenant_id = ?"];
  const args: unknown[] = [T];
  const status = str(input.status, 30);
  if (status) { where.push("status = ?"); args.push(status); }
  const branch = str(input.branchId, 80);
  if (branch) { where.push("branch_id = ?"); args.push(branch); }
  if (!isSuper(c) && c.role === "staff" && scope) { where.push(`branch_id IN (${scope.accessible.map(() => "?").join(",") || "''"})`); args.push(...scope.accessible); }
  const limit = Math.min(500, Math.max(1, Number(input.limit) || 200));
  return (await sql.execute(`SELECT * FROM pra_submissions WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`, args)).rows.map((r) => SAFE(r));
}

/** For the restaurant screens: is this business fiscalised by MAVIN's server (and so the old desktop sender stands down)? */
export async function status(sql: Sql, c: Caller, scope?: BranchScope) {
  if (isSuper(c) || !c.tenantId) return { managed: false, state: "disabled" as AccountState, receipt: null };
  const a = await account(sql, c.tenantId);
  const pos = a ? await counters(sql, c.tenantId) : [];
  const branchId = scope?.active ?? (await mainBranch(sql, c.tenantId));
  const br = branchId ? (await sql.execute(`SELECT name, address FROM branches WHERE id = ? AND tenant_id = ?`, [branchId, c.tenantId])).rows[0] : undefined;
  const cases = await caseStates(sql);
  const confirmedText = (k: PraCaseKey) => (cases[k]?.confirmedAt && cases[k]?.text ? cases[k]!.text! : null);
  return {
    managed: a?.status === "enabled", state: accountState(a, pos), sending: await sendingOn(sql, c.tenantId),
    // What an accepted receipt prints (PRA findings): PNTN, branch address, the verification link format.
    receipt: a?.status === "enabled" ? {
      pntn: a.pntn, registeredName: a.registered_name, branchName: (br?.name as string | undefined) ?? null, branchAddress: (br?.address as string | null | undefined) ?? null,
      qrTemplate: confirmedText("qr_verifier"),
      /** Customer-facing text while PRA can't be reached: only once PRA approved it (otherwise nothing is printed). */
      outageText: confirmedText("outage_receipt"),
    } : null,
  };
}
