/** FBR sandbox scenario testing (Super Admin > FBR Integration > Scenario Testing).
 *
 * A session records the Business Nature and Sector chosen as on the FBR
 * portal and the scenarios the portal assigned (ticked by the Super Admin).
 * Each scenario's test invoice is built by MAVIN's own invoice builder from
 * one unit of a real product of the business (its HS code, UOM, sale type,
 * rate, SRO and price), so a passing test proves real invoices will pass.
 *
 * One attempt: build -> check locally -> FBR sandbox validate -> FBR sandbox
 * post -> record. Every attempt is kept. Sandbox only: the sandbox token, the
 * sandbox addresses, and nothing is written to invoices, stock or accounts.
 *
 * Safety: one attempt in flight per scenario (unique index), one per business
 * at a time; an unclear post is never repeated until a person resolves it;
 * an invoice FBR refused is not sent again unchanged. */
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "@/server/db";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";
import type { FbrInvoicePayload, FbrSettings } from "@/lib/fbr";
import { buildFbrPayload, type FbrItemRow } from "@/lib/fbrPayload";
import { interpretFbrSubmit, parseFbrJson, UNCERTAIN_MESSAGE } from "@/lib/fbrResponse";
import { isValidNtnOrCnic, normalizeNtn } from "@/lib/fbrData";
import {
  checkScenarioPayload, findScenario, FBR_BUSINESS_NATURES, FBR_SCENARIOS, FBR_SECTORS, interpretFbrValidate, maskId,
  SCENARIO_CATALOG_VERSION, SCENARIO_CODE_RE, SCENARIO_TEST_ITEMS, type FbrScenario, type ScenarioStatus, type ScenarioTestItem,
} from "@/lib/fbrScenarios";
import { gatewaySettings, tenantRef, viaGateway, type GatewayOutcome, type GatewaySettings } from "./gatewayClient";
import { STALE_PENDING_MS, tokensOf } from "./service";

export interface ScenarioDeps { now?: () => Date; gateway?: GatewaySettings | null; fetchImpl?: typeof fetch }

const iso = (d: Date) => d.toISOString();
const nowOf = (d: ScenarioDeps) => (d.now ?? (() => new Date()))();
const gw = (d: ScenarioDeps) => (d.gateway === undefined ? gatewaySettings() : d.gateway);
const EXCERPT = 4000;

function superAdmin(c: Caller) {
  if (c.role !== "super_admin") throw new HttpError(403, "Super Admin only.");
}
const str = (x: unknown) => (typeof x === "string" ? x : "");
const today = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

async function setting(sql: Sql, T: string, key: string): Promise<string | null> {
  const r = await sql.execute(`SELECT value FROM settings WHERE key = ?`, [`${T}::${key}`]);
  return (r.rows[0]?.value as string | null | undefined) ?? null;
}

async function sellerOf(sql: Sql, T: string): Promise<FbrSettings> {
  const [ntn, name, province, address, retailer] = await Promise.all(
    ["fbr_seller_ntn", "fbr_seller_name", "fbr_seller_province", "fbr_seller_address", "fbr_retailer"].map((k) => setting(sql, T, k)),
  );
  return {
    enabled: true, environment: "sandbox", sandboxToken: "", productionToken: "",
    sellerNtn: normalizeNtn(ntn), sellerName: name ?? "", sellerProvince: province || "Punjab", sellerAddress: address ?? "", retailer: retailer === "true",
  };
}

// ── Demo registered buyer (one for all businesses, set by the Super Admin) ──

/** "Registered buyer" scenarios need a real registered NTN; MAVIN cannot
 * invent one. Kept outside every business's settings. */
const DEMO_BUYER_KEY = "platform::fbr_demo_buyer";
interface DemoBuyer { name: string; ntnCnic: string; province: string; address: string }

async function demoBuyerOf(sql: Sql): Promise<DemoBuyer | null> {
  const r = await sql.execute(`SELECT value FROM settings WHERE key = ?`, [DEMO_BUYER_KEY]);
  try {
    const b = JSON.parse(String(r.rows[0]?.value ?? "")) as DemoBuyer;
    return b && b.ntnCnic ? b : null;
  } catch { return null; }
}
const demoBuyerView = (b: DemoBuyer | null) => (b ? { name: b.name, ntnMasked: maskId(b.ntnCnic), province: b.province, address: b.address } : null);

export async function getDemoBuyer(sql: Sql, caller: Caller) {
  superAdmin(caller);
  return demoBuyerView(await demoBuyerOf(sql));
}

export async function setDemoBuyer(sql: Sql, caller: Caller, input: { name?: unknown; ntnCnic?: unknown; province?: unknown; address?: unknown }, deps: ScenarioDeps = {}) {
  superAdmin(caller);
  const b: DemoBuyer = { name: str(input.name).trim().slice(0, 120), ntnCnic: normalizeNtn(str(input.ntnCnic)), province: str(input.province).trim().slice(0, 60), address: str(input.address).trim().slice(0, 200) };
  if (!b.name) throw new HttpError(400, "Enter the buyer's business name.");
  if (!isValidNtnOrCnic(b.ntnCnic)) throw new HttpError(400, "Enter a valid NTN (7 characters) or CNIC (13 digits).");
  if (!b.province) throw new HttpError(400, "Enter the buyer's province.");
  if (!b.address) throw new HttpError(400, "Enter the buyer's address.");
  await sql.execute(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`, [DEMO_BUYER_KEY, JSON.stringify(b), iso(nowOf(deps))]);
  return demoBuyerView(b);
}

// ── Catalog and preparation ──────────────────────────────────────────────

export function catalog(caller: Caller) {
  superAdmin(caller);
  return { version: SCENARIO_CATALOG_VERSION, natures: FBR_BUSINESS_NATURES, sectors: FBR_SECTORS, scenarios: FBR_SCENARIOS };
}

interface ProductOption { id: string; name: string; hs_code: string; fbr_uom: string; fbr_sale_type: string; fbr_sale_rate: number | null; sro_no: string | null; sro_item_serial_no: string | null; price: number }

/** The business's products usable for a sale type: complete FBR data and a sale price. */
async function productsFor(sql: Sql, T: string, saleType: string, productId?: string): Promise<(ProductOption & { fbr_qty_factor: number | null })[]> {
  const r = await sql.execute(
    `SELECT p.id, COALESCE(NULLIF(TRIM(p.fbr_article_name), ''), p.name) AS name, p.hs_code, p.fbr_uom, p.fbr_sale_type, p.fbr_sale_rate,
            p.sro_no, p.sro_item_serial_no, p.fbr_qty_factor, pl.sale_price AS price, MAX(pl.created_at) AS priced_at
     FROM price_list pl JOIN products p ON p.id = pl.product_id
     WHERE pl.tenant_id = ? AND pl.deleted_at IS NULL AND pl.sale_price > 0
       AND (p.tenant_id = ? OR p.tenant_id IS NULL) AND p.deleted_at IS NULL
       AND LOWER(p.fbr_sale_type) = LOWER(?) AND COALESCE(p.hs_code, '') <> '' AND COALESCE(p.fbr_uom, '') <> ''
       ${productId ? "AND p.id = ?" : ""}
     GROUP BY p.id
     ORDER BY (COALESCE(p.sro_no, '') <> '' AND COALESCE(p.sro_item_serial_no, '') <> '') DESC, p.name
     LIMIT 25`,
    productId ? [T, T, saleType, productId] : [T, T, saleType],
  );
  return r.rows.map((x) => ({
    id: String(x.id), name: String(x.name ?? ""), hs_code: String(x.hs_code), fbr_uom: String(x.fbr_uom), fbr_sale_type: String(x.fbr_sale_type),
    fbr_sale_rate: x.fbr_sale_rate == null ? null : Number(x.fbr_sale_rate), sro_no: (x.sro_no as string | null) ?? null,
    sro_item_serial_no: (x.sro_item_serial_no as string | null) ?? null, fbr_qty_factor: x.fbr_qty_factor == null ? null : Number(x.fbr_qty_factor), price: Number(x.price),
  }));
}

/** Everything the wizard's first steps need about one business. */
export async function prepare(sql: Sql, caller: Caller, input: { tenantId?: unknown }, deps: ScenarioDeps = {}) {
  superAdmin(caller);
  const T = str(input.tenantId);
  const t = (await sql.execute(`SELECT id, name, fbr_allowed FROM tenants WHERE id = ?`, [T])).rows[0];
  if (!t) throw new HttpError(404, "Business not found.");
  const seller = await sellerOf(sql, T);
  const tokens = await tokensOf(sql, T, deps);
  const problems: string[] = [];
  if (Number(t.fbr_allowed ?? 1) === 0) problems.push("FBR is switched off for this business (Tenants > business > FBR).");
  if (!tokens.sandbox) problems.push("No sandbox token saved (FBR setup).");
  if (!seller.sellerNtn) problems.push("Seller NTN is missing (FBR setup).");
  if (!seller.sellerName.trim()) problems.push("Seller business name is missing (FBR setup).");
  if (!seller.sellerAddress.trim()) problems.push("Seller address is missing (FBR setup).");

  const products: Record<string, ProductOption[]> = {};
  for (const saleType of new Set(FBR_SCENARIOS.filter((s) => s.saleType).map((s) => s.saleType!))) {
    products[saleType] = (await productsFor(sql, T, saleType)).map((p): ProductOption => ({ id: p.id, name: p.name, hs_code: p.hs_code, fbr_uom: p.fbr_uom, fbr_sale_type: p.fbr_sale_type, fbr_sale_rate: p.fbr_sale_rate, sro_no: p.sro_no, sro_item_serial_no: p.sro_item_serial_no, price: p.price }));
  }
  const buyers = (await sql.execute(
    `SELECT id, COALESCE(NULLIF(TRIM(business_name), ''), name) AS name, COALESCE(NULLIF(TRIM(ntn), ''), cnic_ntn) AS ntn, province, address
     FROM customers WHERE tenant_id = ? AND deleted_at IS NULL AND registration_type = 'Registered' AND COALESCE(NULLIF(TRIM(ntn), ''), cnic_ntn, '') <> ''
     ORDER BY name LIMIT 50`, [T],
  )).rows.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), ntnMasked: maskId(String(x.ntn ?? "")), province: (x.province as string | null) ?? null }));

  return {
    tenant: { id: T, name: String(t.name ?? ""), fbrAllowed: Number(t.fbr_allowed ?? 1) !== 0 },
    environment: (await setting(sql, T, "fbr_environment")) === "production" ? "production" : "sandbox",
    route: gw(deps) ? "gateway" : "direct",
    seller: { ntnMasked: maskId(seller.sellerNtn), name: seller.sellerName, province: seller.sellerProvince, address: seller.sellerAddress, retailer: seller.retailer },
    hasSandboxToken: !!tokens.sandbox, sandboxHint: tokens.sandboxHint, hasProductionToken: !!tokens.production,
    demoBuyer: demoBuyerView(await demoBuyerOf(sql)), testItems: SCENARIO_TEST_ITEMS,
    problems, products, buyers,
    sessions: await sessionsOf(sql, T),
  };
}

async function sessionsOf(sql: Sql, T: string) {
  return (await sql.execute(
    `SELECT s.id, s.status, s.business_natures, s.sectors, s.started_at, s.completed_at,
       (SELECT COUNT(*) FROM fbr_scenario_tests x WHERE x.session_id = s.id) AS total,
       (SELECT COUNT(*) FROM fbr_scenario_tests x WHERE x.session_id = s.id AND x.status IN ('submitted', 'portal_confirmed')) AS passed
     FROM fbr_test_sessions s WHERE s.tenant_id = ? ORDER BY s.started_at DESC LIMIT 20`, [T],
  )).rows.map((x) => ({ ...x, business_natures: JSON.parse(String(x.business_natures)), sectors: JSON.parse(String(x.sectors)) }));
}

// ── Sessions ─────────────────────────────────────────────────────────────

/** A scenario's inputs (stored in fbr_scenario_tests.buyer_json): the buyer,
 * and changes to its hidden test item. */
interface BuyerInput { registered?: boolean; customerId?: string; name?: string; ntnCnic?: string; province?: string; address?: string; item?: Partial<ScenarioTestItem> }

/** The hidden test item of a sale type with this scenario's changes. */
function testItemFor(saleType: string, b: BuyerInput | null): ScenarioTestItem | null {
  const base = SCENARIO_TEST_ITEMS[saleType];
  return base ? { ...base, ...(b?.item ?? {}) } : null;
}

function cleanItem(x: unknown): Partial<ScenarioTestItem> | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;
  const out: Partial<ScenarioTestItem> = {};
  const text = (k: "name" | "hs_code" | "fbr_uom" | "sro_no" | "sro_item_serial_no", n: number) => { if (typeof o[k] === "string") out[k] = (o[k] as string).trim().slice(0, n); };
  text("name", 80); text("hs_code", 12); text("fbr_uom", 40); text("sro_no", 80); text("sro_item_serial_no", 20);
  if (o.hs_code !== undefined && !/^\d{4}\.\d{4}$/.test(out.hs_code ?? "")) throw new HttpError(400, "HS code must look like 0000.0000.");
  if (o.fbr_sale_rate !== undefined) {
    const r = Number(o.fbr_sale_rate);
    if (!Number.isFinite(r) || r < 0 || r > 100) throw new HttpError(400, "Rate must be a percentage from 0 to 100.");
    out.fbr_sale_rate = r;
  }
  if (o.price !== undefined) {
    const p = Number(o.price);
    if (!Number.isFinite(p) || p <= 0 || p > 100_000_000) throw new HttpError(400, "Price must be more than 0.");
    out.price = p;
  }
  return out;
}

function pickList<T extends string>(raw: unknown, allowed: readonly T[], what: string): T[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, `Choose at least one ${what}.`);
  const out: T[] = [];
  for (const x of raw) {
    if (typeof x !== "string" || !allowed.includes(x as T)) throw new HttpError(400, `"${String(x)}" is not an FBR ${what} option.`);
    if (!out.includes(x as T)) out.push(x as T);
  }
  return out;
}

/** Starts a session: the Business Nature, Sector and the confirmed scenarios. */
export async function startSession(
  sql: Sql, caller: Caller,
  input: { tenantId?: unknown; natures?: unknown; sectors?: unknown; scenarios?: unknown }, deps: ScenarioDeps = {},
) {
  superAdmin(caller);
  const T = str(input.tenantId);
  if (!(await sql.execute(`SELECT 1 FROM tenants WHERE id = ?`, [T])).rows.length) throw new HttpError(404, "Business not found.");
  const natures = pickList(input.natures, FBR_BUSINESS_NATURES, "Business Nature");
  const sectors = pickList(input.sectors, FBR_SECTORS, "Sector");
  const raw = Array.isArray(input.scenarios) ? input.scenarios : [];
  const chosen: { code: string; productId: string | null; buyer: BuyerInput | null }[] = [];
  for (const x of raw as { code?: unknown; productId?: unknown; buyer?: unknown }[]) {
    const code = str(x?.code).toUpperCase();
    if (!SCENARIO_CODE_RE.test(code)) throw new HttpError(400, `"${code}" is not a scenario code (SN001 ...).`);
    if (chosen.some((c) => c.code === code)) continue;
    chosen.push({ code, productId: str(x.productId) || null, buyer: (x.buyer as BuyerInput) ?? null });
  }
  if (!chosen.length) throw new HttpError(400, "Confirm at least one scenario.");
  if (chosen.length > 40) throw new HttpError(400, "Too many scenarios.");

  const now = iso(nowOf(deps));
  const id = randomUUID();
  await sql.batch([
    {
      sql: `INSERT INTO fbr_test_sessions (id, tenant_id, initiated_by, business_natures, sectors, environment, status, started_at, updated_at) VALUES (?, ?, ?, ?, ?, 'sandbox', 'open', ?, ?)`,
      args: [id, T, caller.userId, JSON.stringify(natures), JSON.stringify(sectors), now, now],
    },
    ...chosen.map((c) => ({
      sql: `INSERT INTO fbr_scenario_tests (id, session_id, tenant_id, scenario_code, verified, product_id, buyer_json, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'not_started', 0, ?, ?)`,
      args: [randomUUID(), id, T, c.code, findScenario(c.code)?.verified ? 1 : 0, c.productId, c.buyer ? JSON.stringify(cleanBuyer(c.buyer)) : null, now, now],
    })),
  ]);
  return session(sql, caller, { sessionId: id });
}

function cleanBuyer(b: BuyerInput): BuyerInput {
  const s = (x: unknown, n: number) => (typeof x === "string" ? x.trim().slice(0, n) : undefined);
  return { registered: b.registered === true, customerId: s(b.customerId, 80), name: s(b.name, 120), ntnCnic: s(b.ntnCnic, 20), province: s(b.province, 60), address: s(b.address, 200), item: cleanItem(b.item) };
}

async function sessionRow(sql: Sql, sessionId: string) {
  const s = (await sql.execute(`SELECT * FROM fbr_test_sessions WHERE id = ?`, [sessionId])).rows[0];
  if (!s) throw new HttpError(404, "Testing session not found.");
  return s;
}

/** A session with its scenarios and every attempt (buyer NTN masked, never a token). */
export async function session(sql: Sql, caller: Caller, input: { sessionId?: unknown }, deps: ScenarioDeps = {}) {
  superAdmin(caller);
  const s = await sessionRow(sql, str(input.sessionId));
  await expireStale(sql, String(s.tenant_id), nowOf(deps));
  const tests = (await sql.execute(`SELECT * FROM fbr_scenario_tests WHERE session_id = ? ORDER BY scenario_code`, [s.id])).rows;
  const attempts = (await sql.execute(`SELECT * FROM fbr_scenario_attempts WHERE session_id = ? ORDER BY attempt_no`, [s.id])).rows;
  return {
    session: { ...(s as Record<string, unknown>), business_natures: JSON.parse(String(s.business_natures)) as string[], sectors: JSON.parse(String(s.sectors)) as string[] } as Record<string, unknown> & { business_natures: string[]; sectors: string[] },
    tests: tests.map((t): Record<string, unknown> & { attempts: Record<string, unknown>[] } => {
      const sc = findScenario(String(t.scenario_code));
      const buyer = t.buyer_json ? (JSON.parse(String(t.buyer_json)) as BuyerInput) : null;
      return {
        ...t, buyer_json: undefined,
        title: sc?.title ?? "Added for verification (not in MAVIN's catalog)",
        saleType: sc?.saleType ?? null, buyerKind: sc?.buyer ?? null,
        buyer: buyer ? { ...buyer, item: undefined, ntnCnic: maskId(buyer.ntnCnic) } : null,
        testItem: !t.product_id && sc?.saleType ? testItemFor(sc.saleType, buyer) : null,
        attempts: attempts.filter((a) => a.scenario_test_id === t.id).map((a) => ({ ...a, payload_json: sanitize(a.payload_json as string | null) })),
      };
    }),
  };
}

function sanitize(json: string | null): unknown {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as FbrInvoicePayload;
    return { ...p, buyerNTNCNIC: maskId(p.buyerNTNCNIC) };
  } catch { return null; }
}

/** Choose the product or buyer of a scenario, skip it, or take it back. */
export async function updateScenario(sql: Sql, caller: Caller, input: { scenarioTestId?: unknown; productId?: unknown; buyer?: unknown; item?: unknown; skip?: unknown }, deps: ScenarioDeps = {}) {
  superAdmin(caller);
  const t = await testRow(sql, str(input.scenarioTestId));
  if (passed(String(t.status))) throw new HttpError(409, "This scenario already passed.");
  const now = iso(nowOf(deps));
  if (input.skip === true || input.skip === false) {
    if (await liveAttempt(sql, String(t.id))) throw new HttpError(409, "This scenario has an attempt in progress or unclear.");
    await sql.execute(`UPDATE fbr_scenario_tests SET status = ?, updated_at = ? WHERE id = ?`, [input.skip ? "skipped" : "not_started", now, t.id]);
  }
  if (input.productId !== undefined) {
    const pid = str(input.productId) || null;
    if (pid && !(await sql.execute(`SELECT 1 FROM products WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`, [pid, t.tenant_id])).rows.length) {
      throw new HttpError(400, "That product is not this business's.");
    }
    await sql.execute(`UPDATE fbr_scenario_tests SET product_id = ?, updated_at = ? WHERE id = ?`, [pid, now, t.id]);
  }
  if (input.buyer !== undefined || input.item !== undefined) {
    const cur = t.buyer_json ? (JSON.parse(String(t.buyer_json)) as BuyerInput) : {};
    const buyer = input.buyer !== undefined ? cleanBuyer((input.buyer ?? {}) as BuyerInput) : cur;
    // Changes to the test item are kept per scenario; null goes back to the starting values.
    const item = input.item !== undefined ? (input.item === null ? undefined : { ...(cur.item ?? {}), ...cleanItem(input.item) }) : cur.item;
    await sql.execute(`UPDATE fbr_scenario_tests SET buyer_json = ?, updated_at = ? WHERE id = ?`, [JSON.stringify({ ...buyer, item }), now, t.id]);
  }
  return session(sql, caller, { sessionId: t.session_id }, deps);
}

/** Adds a code the FBR portal shows but MAVIN's catalog lacks: tracked, never sent automatically. */
export async function addScenario(sql: Sql, caller: Caller, input: { sessionId?: unknown; code?: unknown }, deps: ScenarioDeps = {}) {
  superAdmin(caller);
  const s = await sessionRow(sql, str(input.sessionId));
  const code = str(input.code).trim().toUpperCase();
  if (!SCENARIO_CODE_RE.test(code)) throw new HttpError(400, "Enter the code as the portal shows it, e.g. SN019.");
  const now = iso(nowOf(deps));
  await sql.execute(
    `INSERT OR IGNORE INTO fbr_scenario_tests (id, session_id, tenant_id, scenario_code, verified, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'not_started', 0, ?, ?)`,
    [randomUUID(), s.id, s.tenant_id, code, findScenario(code)?.verified ? 1 : 0, now, now],
  );
  return session(sql, caller, { sessionId: s.id }, deps);
}

export async function finishSession(sql: Sql, caller: Caller, input: { sessionId?: unknown }, deps: ScenarioDeps = {}) {
  superAdmin(caller);
  const s = await sessionRow(sql, str(input.sessionId));
  const now = iso(nowOf(deps));
  await sql.execute(`UPDATE fbr_test_sessions SET status = 'completed', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?`, [now, now, s.id]);
  return session(sql, caller, { sessionId: s.id }, deps);
}

/** The Super Admin saw the scenario completed in the FBR portal (or takes that back). */
export async function confirmPortal(sql: Sql, caller: Caller, input: { scenarioTestId?: unknown; confirmed?: unknown }, deps: ScenarioDeps = {}) {
  superAdmin(caller);
  const t = await testRow(sql, str(input.scenarioTestId));
  const now = iso(nowOf(deps));
  if (input.confirmed === true) {
    if (t.status !== "submitted") throw new HttpError(409, "Only a scenario whose sandbox submission passed can be confirmed.");
    await sql.execute(`UPDATE fbr_scenario_tests SET status = 'portal_confirmed', portal_confirmed_at = ?, portal_confirmed_by = ?, updated_at = ? WHERE id = ?`, [now, caller.userId, now, t.id]);
  } else {
    if (t.status !== "portal_confirmed") throw new HttpError(409, "This scenario is not confirmed.");
    await sql.execute(`UPDATE fbr_scenario_tests SET status = 'submitted', portal_confirmed_at = NULL, portal_confirmed_by = NULL, updated_at = ? WHERE id = ?`, [now, t.id]);
  }
  return session(sql, caller, { sessionId: t.session_id }, deps);
}

// ── Running one scenario ────────────────────────────────────────────────

const passed = (s: string) => s === "submitted" || s === "portal_confirmed";

async function testRow(sql: Sql, id: string) {
  const t = (await sql.execute(`SELECT * FROM fbr_scenario_tests WHERE id = ?`, [id])).rows[0];
  if (!t) throw new HttpError(404, "Scenario not found.");
  return t;
}
async function liveAttempt(sql: Sql, testId: string) {
  return (await sql.execute(`SELECT * FROM fbr_scenario_attempts WHERE scenario_test_id = ? AND state IN ('running', 'uncertain')`, [testId])).rows[0] ?? null;
}

/** An attempt whose sender stopped (page closed, server stopped): if it had
 * reached the post step FBR may have it (uncertain); otherwise nothing was posted. */
async function expireStale(sql: Sql, T: string, now: Date) {
  const cutoff = iso(new Date(now.getTime() - STALE_PENDING_MS));
  const r = await sql.execute(`SELECT id, scenario_test_id, stage FROM fbr_scenario_attempts WHERE tenant_id = ? AND state = 'running' AND updated_at < ?`, [T, cutoff]);
  for (const a of r.rows) {
    const post = a.stage === "post";
    const error = post ? `The sender stopped after posting began. ${UNCERTAIN_MESSAGE}` : "The sender stopped before posting; nothing was posted.";
    await sql.execute(`UPDATE fbr_scenario_attempts SET state = ?, error = ?, updated_at = ? WHERE id = ? AND state = 'running'`, [post ? "uncertain" : "error", error, iso(now), a.id]);
    await setTest(sql, String(a.scenario_test_id), { status: post ? "uncertain" : "error", last_error: error }, now);
  }
}

async function setTest(sql: Sql, id: string, f: Record<string, unknown>, now: Date) {
  const keys = Object.keys(f);
  await sql.execute(`UPDATE fbr_scenario_tests SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => f[k] ?? null), iso(now), id]);
}
async function setAttempt(sql: Sql, id: string, f: Record<string, unknown>, now: Date) {
  const keys = Object.keys(f);
  await sql.execute(`UPDATE fbr_scenario_attempts SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => f[k] ?? null), iso(now), id]);
}

/** The invoice to send, without its date (a new day must not make an unchanged invoice look new). */
function contentHash(p: FbrInvoicePayload): string {
  return createHash("sha256").update(JSON.stringify({ ...p, invoiceDate: "" })).digest("hex");
}

async function hsUoms(T: string, token: string, hs: string, g: GatewaySettings | null, deps: ScenarioDeps): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (!g) return m; // direct mode: the browser cannot be asked from here; FBR's validate step still checks the UOM
  const r = await viaGateway(g, { environment: "sandbox", operation: "reference", token, tenantRef: tenantRef(T, g.secret), referencePath: `/pdi/v2/HS_UOM?hs_code=${encodeURIComponent(hs)}&annexure_id=3` }, { fetchImpl: deps.fetchImpl });
  if (r.outcome === "response" && r.status === 200) {
    try {
      const rows = parseFbrJson<{ description?: string }[]>(r.body);
      if (Array.isArray(rows)) m.set(hs, rows.map((x) => String(x.description ?? "").trim()).filter(Boolean));
    } catch { /* unreadable list: leave it to FBR's validate step */ }
  }
  return m;
}

/** Builds the scenario's test invoice, or says what is missing.
 * Item: the scenario's hidden test item, or a product of the business when one was chosen.
 * Registered buyer: the one chosen for the scenario, else the Super Admin's demo buyer. */
async function buildFor(sql: Sql, T: string, t: Record<string, unknown>, sc: FbrScenario, token: string, g: GatewaySettings | null, deps: ScenarioDeps, now: Date):
  Promise<{ missing: string } | { payload: FbrInvoicePayload; problems: string[]; registered: boolean }> {
  const b = t.buyer_json ? (JSON.parse(String(t.buyer_json)) as BuyerInput) : {};
  let line: Omit<FbrItemRow, "qty" | "further_tax_pct" | "discount_rs" | "tax_pct">;
  if (t.product_id) {
    const p = (await productsFor(sql, T, sc.saleType!, String(t.product_id)))[0];
    if (!p) return { missing: `The chosen product no longer has complete FBR data ("${sc.saleType}", HS code, UOM) and a sale price. Choose another, or use the test item.` };
    line = { product_name: p.name, hs_code: p.hs_code, fbr_sale_type: p.fbr_sale_type, fbr_sale_rate: p.fbr_sale_rate, fbr_uom: p.fbr_uom, sro_no: p.sro_no, sro_item_serial_no: p.sro_item_serial_no, fbr_qty_factor: p.fbr_qty_factor, sale_price: p.price };
  } else {
    const it = testItemFor(sc.saleType!, b);
    if (!it) return { missing: `MAVIN has no test item for "${sc.saleType}".` };
    line = { product_name: it.name, hs_code: it.hs_code, fbr_sale_type: sc.saleType!, fbr_sale_rate: it.fbr_sale_rate, fbr_uom: it.fbr_uom, sro_no: it.sro_no || null, sro_item_serial_no: it.sro_item_serial_no || null, fbr_qty_factor: 1, sale_price: it.price };
  }
  const registered = sc.buyer === "registered" ? true : sc.buyer === "unregistered" ? false : b.registered === true;
  let buyer = { name: null as string | null, ntnCnic: null as string | null, province: null as string | null, address: null as string | null, registered };
  if (registered) {
    if (b.customerId) {
      const c = (await sql.execute(
        `SELECT COALESCE(NULLIF(TRIM(business_name), ''), name) AS name, COALESCE(NULLIF(TRIM(ntn), ''), cnic_ntn) AS ntn, province, address FROM customers WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [b.customerId, T],
      )).rows[0];
      if (!c) return { missing: "The chosen buyer is not a customer of this business." };
      buyer = { name: (c.name as string) ?? null, ntnCnic: (c.ntn as string) ?? null, province: (c.province as string) ?? null, address: (c.address as string) ?? null, registered };
    } else if (b.ntnCnic) {
      buyer = { name: b.name ?? null, ntnCnic: b.ntnCnic ?? null, province: b.province ?? null, address: b.address ?? null, registered };
    } else {
      const d = await demoBuyerOf(sql);
      if (!d) return { missing: `${sc.code} needs a registered buyer: set the demo registered buyer (a real registered NTN) in Scenario Testing, or choose one for this scenario.` };
      buyer = { name: d.name, ntnCnic: d.ntnCnic, province: d.province, address: d.address, registered };
    }
    if (!buyer.ntnCnic || !isValidNtnOrCnic(normalizeNtn(buyer.ntnCnic))) return { missing: `${sc.code} needs a registered buyer with a valid NTN/CNIC.` };
    if (!buyer.name?.trim()) return { missing: `${sc.code} needs the registered buyer's business name.` };
  }
  const seller = { ...(await sellerOf(sql, T)), retailer: sc.retailer === true };
  const item: FbrItemRow = { ...line, qty: 1, tax_pct: line.fbr_sale_rate ?? 0, further_tax_pct: 0, discount_rs: 0 };
  const built = buildFbrPayload(today(now), buyer, [item], seller, await hsUoms(T, token, line.hs_code!, g, deps));
  if ("error" in built) return { payload: null as unknown as FbrInvoicePayload, problems: built.error.split("\n").filter(Boolean), registered };
  return { payload: built.payload, problems: checkScenarioPayload(built.payload, sc, registered), registered };
}

export interface RunResult {
  scenarioTestId: string;
  status: ScenarioStatus;
  message: string | null;
  fbrInvoiceNo?: string | null;
  attemptId?: string;
  /** Direct mode: this browser sends to FBR (validate, then post) and reports each answer. */
  direct?: { step: "validate" | "post"; token: string; payload: FbrInvoicePayload; attemptId: string };
}

/** Runs one scenario once: build, check, FBR validate, FBR post, record. */
export async function run(sql: Sql, caller: Caller, input: { scenarioTestId?: unknown }, deps: ScenarioDeps = {}): Promise<RunResult> {
  superAdmin(caller);
  const now = nowOf(deps);
  const t = await testRow(sql, str(input.scenarioTestId));
  const T = String(t.tenant_id);
  const s = await sessionRow(sql, String(t.session_id));
  if (s.status !== "open") throw new HttpError(409, "This testing session is finished. Start a new session.");
  await expireStale(sql, T, now);
  const cur = await testRow(sql, String(t.id));
  const status = String(cur.status);
  const out = (st: ScenarioStatus, message: string | null, extra: Partial<RunResult> = {}): RunResult => ({ scenarioTestId: String(t.id), status: st, message, ...extra });

  if (passed(status)) return out(status as ScenarioStatus, "Already passed.", { fbrInvoiceNo: (cur.fbr_invoice_no as string) ?? null });
  if (status === "skipped") throw new HttpError(409, "This scenario is skipped. Take it back first.");
  if (status === "uncertain") throw new HttpError(409, `The last attempt has no clear outcome. ${UNCERTAIN_MESSAGE.replace("then resolve it in Settings > FBR.", "then resolve it here.")}`);
  const sc = findScenario(String(cur.scenario_code));
  if (!sc?.verified || !cur.verified) {
    throw new HttpError(409, `${cur.scenario_code} has no verified invoice set-up in MAVIN, so it is not sent automatically. Test it in the FBR portal and track it here.`);
  }
  if (Number((await sql.execute(`SELECT fbr_allowed FROM tenants WHERE id = ?`, [T])).rows[0]?.fbr_allowed ?? 1) === 0) {
    throw new HttpError(403, "FBR is switched off for this business.");
  }
  const token = (await tokensOf(sql, T, deps)).sandbox;
  if (!token) throw new HttpError(400, "Save this business's sandbox token first (FBR setup).");
  // One business at a time: scenarios run one after the other.
  const busy = (await sql.execute(`SELECT scenario_test_id FROM fbr_scenario_attempts WHERE tenant_id = ? AND state = 'running'`, [T])).rows[0];
  if (busy) throw new HttpError(429, busy.scenario_test_id === cur.id ? "This scenario is being tested right now." : "Another scenario of this business is being tested. They run one at a time.");

  const g = gw(deps);
  const built = await buildFor(sql, T, cur, sc, token, g, deps, now);
  if ("missing" in built) {
    await setTest(sql, String(t.id), { status: "needs_input", last_error: built.missing }, now);
    return out("needs_input", built.missing);
  }

  // Not the same refused invoice again: something must have changed.
  const hash = built.payload ? contentHash(built.payload) : null;
  const last = (await sql.execute(
    `SELECT state, payload_hash, error FROM fbr_scenario_attempts WHERE scenario_test_id = ? AND state IN ('fbr_invalid', 'rejected', 'passed', 'error', 'not_received', 'local_failed') ORDER BY attempt_no DESC LIMIT 1`, [t.id],
  )).rows[0];
  if (hash && last && (last.state === "fbr_invalid" || last.state === "rejected") && last.payload_hash === hash) {
    throw new HttpError(409, `This is the same invoice FBR refused last time:\n${String(last.error ?? "")}\nCorrect the product, buyer or seller data (or choose another product), then retry.`);
  }

  const n = Number((await sql.execute(`SELECT COALESCE(MAX(attempt_no), 0) AS n FROM fbr_scenario_attempts WHERE scenario_test_id = ?`, [t.id])).rows[0].n) + 1;
  const attemptId = randomUUID();
  const route = g ? "gateway" : "direct";
  try {
    await sql.execute(
      `INSERT INTO fbr_scenario_attempts (id, scenario_test_id, session_id, tenant_id, attempt_no, route, stage, state, payload_json, payload_hash, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'validate', 'running', ?, ?, ?, ?, ?)`,
      [attemptId, t.id, t.session_id, T, n, route, built.payload ? JSON.stringify(built.payload) : null, hash, caller.userId, iso(now), iso(now)],
    );
  } catch (e) {
    if (!/UNIQUE|constraint/i.test(String((e as Error)?.message))) throw e;
    // Two indexes refuse a second attempt: one per scenario, one running per business.
    const mine = (await sql.execute(`SELECT 1 FROM fbr_scenario_attempts WHERE scenario_test_id = ? AND state IN ('running', 'uncertain')`, [t.id])).rows.length;
    if (mine) throw new HttpError(409, "This scenario is being tested right now.");
    throw new HttpError(429, "Another scenario of this business is being tested. They run one at a time.");
  }
  await setTest(sql, String(t.id), { attempts: n, last_attempt_at: iso(now) }, now);

  if (built.problems.length) {
    const error = `Local validation failed:\n${built.problems.join("\n")}`;
    await setAttempt(sql, attemptId, { state: "local_failed", stage: "local", error }, now);
    await setTest(sql, String(t.id), { status: "local_failed", validation_status: "local_failed", last_error: error }, now);
    return out("local_failed", error, { attemptId });
  }
  await setTest(sql, String(t.id), { validation_status: "local_passed" }, now);

  if (!g) return out("not_started", null, { attemptId, direct: { step: "validate", token, payload: built.payload, attemptId } });

  const v = await viaGateway(g, { environment: "sandbox", operation: "validate", token, tenantRef: tenantRef(T, g.secret), payload: built.payload }, { fetchImpl: deps.fetchImpl });
  const after = await afterValidate(sql, attemptId, String(t.id), v, nowOf(deps));
  if (after) return out(after.status, after.message, { attemptId });
  const p = await viaGateway(g, { environment: "sandbox", operation: "post", token, tenantRef: tenantRef(T, g.secret), payload: built.payload }, { fetchImpl: deps.fetchImpl });
  return afterPost(sql, attemptId, String(t.id), p, nowOf(deps));
}

/** Records FBR's validate answer; null means valid (go on to post). */
async function afterValidate(sql: Sql, attemptId: string, testId: string, v: GatewayOutcome, now: Date): Promise<{ status: ScenarioStatus; message: string } | null> {
  if (v.outcome !== "response") {
    const error = `${v.error} Nothing was posted; retry when FBR answers.`;
    await setAttempt(sql, attemptId, { state: "error", error }, now);
    await setTest(sql, testId, { status: "error", last_error: error }, now);
    return { status: "error", message: error };
  }
  const i = interpretFbrValidate(v.status, v.body);
  await setAttempt(sql, attemptId, { validation_http: v.status, validation_excerpt: v.body.slice(0, EXCERPT) }, now);
  if (i.outcome === "valid") {
    await setAttempt(sql, attemptId, { stage: "post" }, now);
    await setTest(sql, testId, { validation_status: "fbr_passed" }, now);
    return null;
  }
  if (i.outcome === "unclear") {
    const error = `${i.error} Nothing was posted; retry later.`;
    await setAttempt(sql, attemptId, { state: "error", error }, now);
    await setTest(sql, testId, { status: "error", last_error: error }, now);
    return { status: "error", message: error };
  }
  const error = `FBR validation failed:\n${i.error}`;
  await setAttempt(sql, attemptId, { state: "fbr_invalid", error }, now);
  await setTest(sql, testId, { status: "fbr_invalid", validation_status: "fbr_failed", last_error: error }, now);
  return { status: "fbr_invalid", message: error };
}

async function afterPost(sql: Sql, attemptId: string, testId: string, p: GatewayOutcome, now: Date): Promise<RunResult> {
  if (p.outcome === "not_sent") {
    const error = `${p.error} Nothing reached FBR; retry.`;
    await setAttempt(sql, attemptId, { state: "not_received", error }, now);
    await setTest(sql, testId, { status: "error", submission_status: "not_received", last_error: error }, now);
    return { scenarioTestId: testId, status: "error", message: error, attemptId };
  }
  if (p.outcome === "uncertain") {
    const error = `${p.error} ${UNCERTAIN_MESSAGE}`;
    await setAttempt(sql, attemptId, { state: "uncertain", error }, now);
    await setTest(sql, testId, { status: "uncertain", submission_status: "uncertain", last_error: error }, now);
    return { scenarioTestId: testId, status: "uncertain", message: error, attemptId };
  }
  const i = interpretFbrSubmit(p.status, p.body);
  const base = { submission_http: p.status, response_excerpt: p.body.slice(0, EXCERPT) };
  if (i.outcome === "accepted") {
    await setAttempt(sql, attemptId, { ...base, state: "passed", fbr_invoice_no: i.fbrInvoiceNo, error: null }, now);
    await setTest(sql, testId, { status: "submitted", submission_status: "passed", fbr_invoice_no: i.fbrInvoiceNo, last_error: null }, now);
    return { scenarioTestId: testId, status: "submitted", message: null, fbrInvoiceNo: i.fbrInvoiceNo, attemptId };
  }
  if (i.outcome === "uncertain") {
    await setAttempt(sql, attemptId, { ...base, state: "uncertain", error: i.error }, now);
    await setTest(sql, testId, { status: "uncertain", submission_status: "uncertain", last_error: i.error }, now);
    return { scenarioTestId: testId, status: "uncertain", message: i.error, attemptId };
  }
  await setAttempt(sql, attemptId, { ...base, state: "rejected", error: i.error }, now);
  await setTest(sql, testId, { status: "rejected", submission_status: "rejected", last_error: i.error }, now);
  return { scenarioTestId: testId, status: "rejected", message: i.error, attemptId };
}

/** Direct mode: this browser reports FBR's answer to the validate or post step. */
export async function report(sql: Sql, caller: Caller, input: { attemptId?: unknown; step?: unknown; report?: unknown }, deps: ScenarioDeps = {}): Promise<RunResult> {
  superAdmin(caller);
  const now = nowOf(deps);
  const a = (await sql.execute(`SELECT * FROM fbr_scenario_attempts WHERE id = ?`, [str(input.attemptId)])).rows[0];
  if (!a) throw new HttpError(404, "Attempt not found.");
  if (a.route !== "direct") throw new HttpError(400, "This attempt was sent by MAVIN's server.");
  if (a.state !== "running") throw new HttpError(409, "This attempt is already finished.");
  const step = input.step === "post" ? "post" : input.step === "validate" ? "validate" : null;
  if (!step || step !== a.stage) throw new HttpError(409, `This attempt is at the ${String(a.stage)} step.`);
  const rep = input.report as { kind?: unknown; status?: unknown; text?: unknown; error?: unknown } | null;
  const answer: GatewayOutcome = rep?.kind === "response" && typeof rep.status === "number" && typeof rep.text === "string"
    ? { outcome: "response", status: rep.status, body: rep.text.slice(0, 200_000) }
    : { outcome: "uncertain", error: typeof rep?.error === "string" ? rep.error.slice(0, 300) : "No answer reached this computer." };
  const testId = String(a.scenario_test_id);
  if (step === "validate") {
    // A browser cannot tell "not sent" from "answer lost"; for validating that is harmless.
    const after = await afterValidate(sql, String(a.id), testId, answer, now);
    if (after) return { scenarioTestId: testId, status: after.status, message: after.message, attemptId: String(a.id) };
    const token = (await tokensOf(sql, String(a.tenant_id), deps)).sandbox;
    if (!token) throw new HttpError(400, "The sandbox token was removed.");
    return { scenarioTestId: testId, status: "not_started", message: null, attemptId: String(a.id), direct: { step: "post", token, payload: JSON.parse(String(a.payload_json)), attemptId: String(a.id) } };
  }
  return afterPost(sql, String(a.id), testId, answer, now);
}

/** A person checked the FBR portal about an unclear post. */
export async function resolve(sql: Sql, caller: Caller, input: { attemptId?: unknown; resolution?: unknown; fbrInvoiceNo?: unknown }, deps: ScenarioDeps = {}) {
  superAdmin(caller);
  const now = nowOf(deps);
  const a = (await sql.execute(`SELECT * FROM fbr_scenario_attempts WHERE id = ?`, [str(input.attemptId)])).rows[0];
  if (!a) throw new HttpError(404, "Attempt not found.");
  await expireStale(sql, String(a.tenant_id), now);
  const cur = (await sql.execute(`SELECT state FROM fbr_scenario_attempts WHERE id = ?`, [a.id])).rows[0];
  if (cur.state !== "uncertain") throw new HttpError(409, "Only an attempt without a clear outcome can be resolved.");
  const testId = String(a.scenario_test_id);
  if (input.resolution === "not_received") {
    await setAttempt(sql, String(a.id), { state: "not_received", resolved_by: caller.userId }, now);
    await setTest(sql, testId, { status: "error", submission_status: "not_received", last_error: "Checked: FBR does not have it. It can be retried." }, now);
  } else if (input.resolution === "accepted") {
    const no = str(input.fbrInvoiceNo).trim();
    if (!/^[A-Za-z0-9-]{6,80}$/.test(no)) throw new HttpError(400, "Enter the FBR invoice number exactly as the portal shows it.");
    await setAttempt(sql, String(a.id), { state: "passed", fbr_invoice_no: no, resolved_by: caller.userId }, now);
    await setTest(sql, testId, { status: "submitted", submission_status: "passed", fbr_invoice_no: no, last_error: null }, now);
  } else {
    throw new HttpError(400, "Choose: FBR does not have it, or enter the FBR invoice number.");
  }
  return session(sql, caller, { sessionId: a.session_id }, deps);
}
