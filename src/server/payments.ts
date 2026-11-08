/** Online payments: one service for the platform's own subscription payments
 * (tenant_id NULL merchant, owned by MAVIN.pk) and each business's customer
 * payments (that business's own merchant account; its money never passes
 * through MAVIN.pk).
 *
 * Readiness of a merchant connection:
 *   allowed by the Super Admin  ->  setup (credentials saved)  ->  testing (sandbox test passed)
 *   ->  active (live credentials, live test passed, adapter written from the
 *   provider's kit). Only active + enabled connections are offered at checkout.
 *
 * A payment is credited only from a provider response whose signature the
 * adapter verified (callback) or from the provider's own status inquiry; the
 * browser's return is never proof. Attempts are unique by reference; a paid
 * attempt is never overwritten; a second paid attempt for the same order goes
 * to staff review (possible double charge). Disabling a connection stops new
 * attempts only: callbacks, inquiries and refunds of earlier attempts go on. */
import { randomBytes, randomUUID } from "node:crypto";
import type { Sql } from "./subSupers";
import { callerCan, type Caller } from "./sqlPolicy";
import { HttpError } from "./db";
import { tenantAllows } from "@/lib/tenantFeatures";
import {
  PROVIDERS, METHOD_LABEL, decryptSecrets, encryptSecrets, isProvider, maskSecret,
  type PayMethod, type ProviderId, type ProviderResult,
} from "./paymentProviders";

export type Env = "sandbox" | "live";
export type MerchantStatus = "setup" | "testing" | "active" | "suspended";
export type Purpose = "web_order" | "subscription";

const iso = () => new Date().toISOString();
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const jsonList = (raw: unknown): string[] => { try { const v = raw ? JSON.parse(String(raw)) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const FINAL = ["paid", "failed", "cancelled", "expired", "review"];

// ── Who may do what ───────────────────────────────────────────────────────

/** The business's payment switches (Super Admin, per business). */
export async function paymentFlags(sql: Sql, tenantId: string) {
  const r = (await sql.execute(`SELECT denied_actions FROM tenants WHERE id = ?`, [tenantId])).rows[0];
  const list = jsonList(r?.denied_actions);
  const on = (k: string) => tenantAllows(list, k);
  return {
    online: on("payments.online"), jazzcash: on("payments.jazzcash"), easypaisa: on("payments.easypaisa"),
    card: on("payments.card"), customMerchant: on("payments.custom_merchant"), refund: on("payments.refund"),
  };
}
type Flags = Awaited<ReturnType<typeof paymentFlags>>;
const providerAllowed = (f: Flags, p: ProviderId) => (p === "jazzcash" ? f.jazzcash : f.easypaisa);

/** The merchant owner the caller may manage: the platform (Super Admin) or their own business (owner). */
function ownerFor(caller: Caller, tenantId: string | null): string | null {
  if (tenantId === null) {
    if (caller.role !== "super_admin") throw new HttpError(403, "Only the Super Admin manages MAVIN.pk's own payment account.");
    return null;
  }
  if (caller.role === "super_admin") return tenantId;
  if (caller.role !== "owner" || caller.tenantId !== tenantId) throw new HttpError(403, "Only the business owner manages its payment settings.");
  return tenantId;
}

async function audit(sql: Sql, tenantId: string | null, caller: Caller | null, action: string, detail: unknown) {
  await sql.execute(
    `INSERT INTO payment_audit (id, tenant_id, actor_user_id, actor_role, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), tenantId, caller?.userId ?? null, caller?.role ?? "system", action, detail == null ? null : JSON.stringify(detail), iso()],
  ).catch(() => undefined);
}

// ── Merchant connections ──────────────────────────────────────────────────

export interface MerchantView {
  id: string; provider: ProviderId; providerLabel: string; environment: Env; status: MerchantStatus; enabled: boolean;
  methods: PayMethod[]; approvedDomains: string[]; hints: Record<string, string>; fieldsSet: string[];
  lastTestAt: string | null; lastTestOk: boolean | null; lastTestNote: string | null;
  /** The adapter for this provider is written and can be used. */
  integrationReady: boolean;
}

function view(r: Record<string, unknown>): MerchantView {
  const provider = String(r.provider) as ProviderId;
  const hints = r.credential_hints ? (JSON.parse(String(r.credential_hints)) as Record<string, string>) : {};
  return {
    id: String(r.id), provider, providerLabel: PROVIDERS[provider]?.label ?? provider, environment: String(r.environment) as Env,
    status: String(r.status) as MerchantStatus, enabled: Number(r.enabled) === 1,
    methods: jsonList(r.methods).filter((m): m is PayMethod => m === "wallet" || m === "card"),
    approvedDomains: jsonList(r.approved_domains), hints, fieldsSet: Object.keys(hints),
    lastTestAt: (r.last_test_at as string | null) ?? null, lastTestOk: r.last_test_ok == null ? null : Number(r.last_test_ok) === 1,
    lastTestNote: (r.last_test_note as string | null) ?? null, integrationReady: Boolean(PROVIDERS[provider]?.adapter),
  };
}

const ownerWhere = (owner: string | null) => (owner === null ? `tenant_id IS NULL` : `tenant_id = ?`);
const ownerArgs = (owner: string | null) => (owner === null ? [] : [owner]);

/** Connections of the platform (null) or a business: never secret values. */
export async function listMerchants(sql: Sql, caller: Caller, tenantId: string | null) {
  const owner = ownerFor(caller, tenantId);
  const rows = (await sql.execute(`SELECT * FROM payment_merchants WHERE ${ownerWhere(owner)} ORDER BY provider, environment`, ownerArgs(owner))).rows.map(view);
  const flags = owner === null ? null : await paymentFlags(sql, owner);
  const providers = Object.values(PROVIDERS).map((p) => ({
    id: p.id, label: p.label, methods: p.methods.map((m) => ({ id: m, label: METHOD_LABEL[m] })), fields: p.fields, onboarding: p.onboarding,
    integrationReady: Boolean(p.adapter),
    allowed: flags === null ? true : flags.online && flags.customMerchant && providerAllowed(flags, p.id),
  }));
  return { merchants: rows, providers, flags, callbackUrl: platformUrl("/api/payments/callback/"), secretsReady: Boolean(process.env.PAYMENTS_SECRET_KEY?.trim()) };
}

export const platformUrl = (path: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://app.mavin.pk").replace(/\/+$/, "")}${path}`;

/** Saves a connection's settings. Secret fields are replaced only when a new
 * value is given; empty keeps the saved one. Saving never activates it. */
export async function saveMerchant(sql: Sql, caller: Caller, tenantId: string | null, input: Record<string, unknown>): Promise<MerchantView> {
  const owner = ownerFor(caller, tenantId);
  const provider = input.provider;
  if (!isProvider(provider)) throw new HttpError(400, "Choose JazzCash or Easypaisa.");
  const env: Env = input.environment === "live" ? "live" : "sandbox";
  const def = PROVIDERS[provider];
  if (owner !== null) {
    const f = await paymentFlags(sql, owner);
    if (!f.online || !providerAllowed(f, provider)) throw new HttpError(403, `${def.label} is not enabled for this business. Request it from MAVIN.pk.`);
    if (!f.customMerchant) throw new HttpError(403, "Connecting your own merchant account is not enabled for this business. Request it from MAVIN.pk.");
  }
  const methods = (Array.isArray(input.methods) ? input.methods : []).filter((m): m is PayMethod => def.methods.includes(m as PayMethod));
  if (owner !== null && methods.includes("card") && !(await paymentFlags(sql, owner)).card) throw new HttpError(403, "Card payments are not enabled for this business.");
  const domains = (Array.isArray(input.approvedDomains) ? input.approvedDomains : []).map((d) => str(d, 120).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 10);
  const cur = (await sql.execute(`SELECT * FROM payment_merchants WHERE ${ownerWhere(owner)} AND provider = ? AND environment = ?`, [...ownerArgs(owner), provider, env])).rows[0];
  const given = (input.credentials ?? {}) as Record<string, unknown>;
  const changed: string[] = [];
  let secretsBlob = (cur?.credential_hints && cur?.credentials_enc) ? String(cur.credentials_enc) : null;
  let hints = cur?.credential_hints ? (JSON.parse(String(cur.credential_hints)) as Record<string, string>) : {};
  const updates: Record<string, string> = {};
  for (const fdef of def.fields) {
    const v = str(given[fdef.key], 400);
    if (v) { updates[fdef.key] = v; changed.push(fdef.key); }
  }
  if (changed.length) {
    const all = { ...(secretsBlob ? decryptSecrets(secretsBlob) : {}), ...updates };
    secretsBlob = encryptSecrets(all);
    hints = Object.fromEntries(def.fields.filter((fd) => all[fd.key]).map((fd) => [fd.key, fd.secret ? maskSecret(all[fd.key]) : all[fd.key]]));
  }
  const now = iso();
  // New credentials must be tested again; the connection falls back to setup.
  const status: MerchantStatus = changed.length ? "setup" : ((cur?.status as MerchantStatus) ?? "setup");
  if (cur) {
    await sql.execute(
      `UPDATE payment_merchants SET methods = ?, approved_domains = ?, credentials_enc = ?, credential_hints = ?, status = ?, enabled = CASE WHEN ? = 'setup' THEN 0 ELSE enabled END,
         last_test_ok = CASE WHEN ? THEN NULL ELSE last_test_ok END, updated_at = ? WHERE id = ?`,
      [JSON.stringify(methods), JSON.stringify(domains), secretsBlob, JSON.stringify(hints), status, status, changed.length ? 1 : 0, now, cur.id],
    );
  } else {
    await sql.execute(
      `INSERT INTO payment_merchants (id, tenant_id, provider, environment, status, enabled, methods, approved_domains, credentials_enc, credential_hints, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'setup', 0, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), owner, provider, env, JSON.stringify(methods), JSON.stringify(domains), secretsBlob, JSON.stringify(hints), now, now],
    );
  }
  await audit(sql, owner, caller, "merchant.saved", { provider, environment: env, methods, domains, secretsReplaced: changed.filter((k) => def.fields.find((f) => f.key === k)?.secret) });
  const row = (await sql.execute(`SELECT * FROM payment_merchants WHERE ${ownerWhere(owner)} AND provider = ? AND environment = ?`, [...ownerArgs(owner), provider, env])).rows[0];
  return view(row);
}

async function merchantRow(sql: Sql, id: string) {
  const r = (await sql.execute(`SELECT * FROM payment_merchants WHERE id = ?`, [id])).rows[0];
  if (!r) throw new HttpError(404, "Payment connection not found.");
  return r;
}

/** Credentials check with the provider (sandbox or live). Without a written adapter it says so. */
export async function testMerchant(sql: Sql, caller: Caller, id: string) {
  const r = await merchantRow(sql, id);
  const owner = ownerFor(caller, (r.tenant_id as string | null) ?? null);
  const def = PROVIDERS[String(r.provider) as ProviderId];
  let ok = false;
  let note: string;
  if (!def.adapter) note = `The ${def.label} connection is not built yet: it needs ${def.label}'s official merchant integration kit. Nothing was sent.`;
  else if (!r.credentials_enc) note = "Enter the credentials first.";
  else {
    try {
      const res = await def.adapter.test(decryptSecrets(String(r.credentials_enc)), String(r.environment) as Env);
      ok = res.ok;
      note = res.note;
    } catch {
      note = `${def.label} could not be reached. Try again.`;
    }
  }
  const status = ok ? (String(r.environment) === "sandbox" ? "testing" : String(r.status) === "active" ? "active" : "testing") : String(r.status) === "active" ? "active" : "setup";
  await sql.execute(`UPDATE payment_merchants SET last_test_at = ?, last_test_ok = ?, last_test_note = ?, status = ?, updated_at = ? WHERE id = ?`, [iso(), ok ? 1 : 0, note, status, iso(), id]);
  await audit(sql, owner, caller, "merchant.tested", { provider: def.id, environment: r.environment, ok });
  return { ok, note };
}

/** Turns a connection on (active) or off. On needs: live credentials, a passed live test,
 * a written adapter, the business's switches, and (business) an approved website address. */
export async function setMerchantEnabled(sql: Sql, caller: Caller, id: string, enabled: boolean) {
  const r = await merchantRow(sql, id);
  const owner = ownerFor(caller, (r.tenant_id as string | null) ?? null);
  const def = PROVIDERS[String(r.provider) as ProviderId];
  if (enabled) {
    if (!def.adapter) throw new HttpError(409, `${def.label} cannot be turned on yet: its connection needs the provider's integration kit.`);
    if (String(r.environment) !== "live") throw new HttpError(409, "Only live credentials take real payments. Sandbox is for testing.");
    if (Number(r.last_test_ok) !== 1) throw new HttpError(409, "Run a successful live test first.");
    if (owner !== null) {
      const f = await paymentFlags(sql, owner);
      if (!f.online || !providerAllowed(f, def.id)) throw new HttpError(403, `${def.label} is not enabled for this business.`);
      if (!jsonList(r.approved_domains).length) throw new HttpError(409, "Add the website address approved on the merchant account.");
    }
    if (!jsonList(r.methods).length) throw new HttpError(409, "Choose at least one payment method approved on the merchant account.");
  }
  await sql.execute(`UPDATE payment_merchants SET enabled = ?, status = ?, updated_at = ? WHERE id = ?`, [enabled ? 1 : 0, enabled ? "active" : String(r.status) === "active" ? "suspended" : String(r.status), iso(), id]);
  await audit(sql, owner, caller, enabled ? "merchant.activated" : "merchant.deactivated", { provider: def.id, environment: r.environment });
  return { ok: true };
}

// ── What a checkout may offer ─────────────────────────────────────────────

export interface OfferedMethod { merchantId: string; provider: ProviderId; method: PayMethod; label: string }

/** Methods allowed by the Super Admin, enabled by the business, approved on an
 * active live connection with a written adapter (platform: tenantId null). */
export async function offeredMethods(sql: Sql, tenantId: string | null, host?: string): Promise<OfferedMethod[]> {
  let flags: Flags | null = null;
  if (tenantId !== null) {
    flags = await paymentFlags(sql, tenantId);
    if (!flags.online) return [];
  }
  const rows = (await sql.execute(
    `SELECT * FROM payment_merchants WHERE ${ownerWhere(tenantId)} AND environment = 'live' AND status = 'active' AND enabled = 1`, ownerArgs(tenantId),
  )).rows;
  const out: OfferedMethod[] = [];
  for (const r of rows) {
    const def = PROVIDERS[String(r.provider) as ProviderId];
    if (!def?.adapter) continue;
    if (flags && !providerAllowed(flags, def.id)) continue;
    // A business's connection serves only the website addresses approved on it.
    if (tenantId !== null && host && !jsonList(r.approved_domains).includes(host.toLowerCase().split(":")[0])) continue;
    for (const m of jsonList(r.methods) as PayMethod[]) {
      if (!def.methods.includes(m)) continue;
      if (m === "card" && flags && !flags.card) continue;
      out.push({ merchantId: String(r.id), provider: def.id, method: m, label: `${def.label} · ${METHOD_LABEL[m]}` });
    }
  }
  return out;
}

// ── Attempts ──────────────────────────────────────────────────────────────

/** Unique, alphanumeric, short (provider reference limits): MV + time + random. */
export const newReference = () => `MV${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 20);

/** Money from the stored decimal total to paisa (integer), once, server side. */
export const toMinor = (rupees: number) => Math.round(Number(rupees) * 100);

interface StartInput {
  tenantId: string | null; purpose: Purpose; refId: string; branchId: string | null; amountMinor: number;
  provider: ProviderId; method: PayMethod; idempotencyKey: string | null; returnUrl: string; description: string;
  customerPhone?: string | null; customerEmail?: string | null; host?: string;
}

/** A new attempt (or the same one again for a repeated request) and the provider's hosted-page form. */
export async function startAttempt(sql: Sql, input: StartInput) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new HttpError(400, "Nothing to pay.");
  const offer = (await offeredMethods(sql, input.tenantId, input.host)).find((o) => o.provider === input.provider && o.method === input.method);
  if (!offer) throw new HttpError(409, "This way of paying is not available.");
  // Already paid (another attempt): nothing more to start.
  const paid = (await sql.execute(`SELECT id FROM payment_attempts WHERE purpose = ? AND ref_id = ? AND status = 'paid'`, [input.purpose, input.refId])).rows[0];
  if (paid) throw new HttpError(409, "This has already been paid.");
  if (input.idempotencyKey) {
    const prev = (await sql.execute(`SELECT * FROM payment_attempts WHERE purpose = ? AND ref_id = ? AND idempotency_key = ?`, [input.purpose, input.refId, input.idempotencyKey])).rows[0];
    if (prev && !FINAL.includes(String(prev.status))) return { attemptId: String(prev.id), reference: String(prev.reference), form: await formFor(sql, prev, input) };
  }
  const now = iso();
  const id = randomUUID();
  const reference = newReference();
  await sql.execute(
    `INSERT INTO payment_attempts (id, tenant_id, branch_id, purpose, ref_id, merchant_id, provider, method, environment, amount_minor, currency, reference, idempotency_key, status, return_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, 'PKR', ?, ?, 'created', ?, ?, ?)`,
    [id, input.tenantId, input.branchId, input.purpose, input.refId, offer.merchantId, input.provider, input.method, input.amountMinor, reference, input.idempotencyKey, input.returnUrl, now, now],
  );
  const row = (await sql.execute(`SELECT * FROM payment_attempts WHERE id = ?`, [id])).rows[0];
  const form = await formFor(sql, row, input);
  await sql.execute(`UPDATE payment_attempts SET status = 'redirected', updated_at = ? WHERE id = ? AND status = 'created'`, [iso(), id]);
  await event(sql, id, input.tenantId, "initiate", null, true, `${input.provider}/${input.method}`);
  return { attemptId: id, reference, form };
}

async function formFor(sql: Sql, attempt: Record<string, unknown>, input: StartInput) {
  const m = await merchantRow(sql, String(attempt.merchant_id));
  const def = PROVIDERS[String(m.provider) as ProviderId];
  if (!def.adapter) throw new HttpError(409, "This way of paying is not available.");
  return def.adapter.initiate(decryptSecrets(String(m.credentials_enc)), String(m.environment) as Env, {
    reference: String(attempt.reference), amountMinor: Number(attempt.amount_minor), currency: String(attempt.currency), method: String(attempt.method) as PayMethod,
    description: input.description.slice(0, 100), callbackUrl: platformUrl(`/api/payments/callback/?p=${def.id}`), returnUrl: platformUrl(`/api/payments/return/?ref=${attempt.reference}`),
    customerPhone: input.customerPhone ?? null, customerEmail: input.customerEmail ?? null,
  });
}

async function event(sql: Sql, attemptId: string | null, tenantId: string | null, kind: string, providerStatus: string | null, verified: boolean, note: string | null) {
  await sql.execute(
    `INSERT INTO payment_events (id, attempt_id, tenant_id, kind, provider_status, verified, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), attemptId, tenantId, kind, providerStatus, verified ? 1 : 0, note?.slice(0, 300) ?? null, iso()],
  );
}

/** A provider callback (no login): only a signature-verified result for a known
 * reference, with the right amount and currency, changes anything. */
export async function handleCallback(sql: Sql, provider: unknown, params: Record<string, string>) {
  if (!isProvider(provider)) throw new HttpError(404, "Unknown provider.");
  const def = PROVIDERS[provider];
  if (!def.adapter) { await event(sql, null, null, "callback", null, false, `${provider}: no adapter`); throw new HttpError(404, "Not available."); }
  const ref = def.adapter.referenceOf(params);
  const attempt = ref ? (await sql.execute(`SELECT * FROM payment_attempts WHERE reference = ? AND provider = ?`, [ref, provider])).rows[0] : undefined;
  if (!attempt) { await event(sql, null, null, "callback", null, false, `${provider}: unknown reference`); throw new HttpError(404, "Unknown payment."); }
  const m = await merchantRow(sql, String(attempt.merchant_id));
  const result = def.adapter.verifyCallback(decryptSecrets(String(m.credentials_enc)), params);
  if (!result || result.reference !== ref) {
    await event(sql, String(attempt.id), (attempt.tenant_id as string | null) ?? null, "callback", null, false, "signature did not verify");
    throw new HttpError(400, "Invalid callback.");
  }
  return applyResult(sql, attempt, result, "callback");
}

/** Applies a verified provider result to its attempt, once. */
export async function applyResult(sql: Sql, attempt: Record<string, unknown>, r: ProviderResult, kind: string) {
  const id = String(attempt.id);
  const tenantId = (attempt.tenant_id as string | null) ?? null;
  const matches = r.amountMinor === Number(attempt.amount_minor) && r.currency === String(attempt.currency);
  await event(sql, id, tenantId, kind, r.providerStatus, true, matches ? r.status : `amount/currency mismatch: ${r.amountMinor} ${r.currency}`);
  if (r.status === "paid" && !matches) {
    await sql.execute(`UPDATE payment_attempts SET status = 'review', review_note = 'Paid amount or currency differs from the order', provider_status = ?, provider_txn_ref = ?, updated_at = ? WHERE id = ? AND status != 'paid'`,
      [r.providerStatus, r.providerTxnRef, iso(), id]);
    return { status: "review" };
  }
  if (r.status === "paid") {
    // Only the first verified success counts; a second paid attempt for the same order is a possible double charge.
    const other = (await sql.execute(`SELECT id FROM payment_attempts WHERE purpose = ? AND ref_id = ? AND status = 'paid' AND id != ?`, [attempt.purpose, attempt.ref_id, id])).rows[0];
    if (other) {
      await sql.execute(`UPDATE payment_attempts SET status = 'review', review_note = 'Second successful payment for the same order: refund or keep after checking', provider_status = ?, provider_txn_ref = ?, updated_at = ? WHERE id = ? AND status != 'paid'`,
        [r.providerStatus, r.providerTxnRef, iso(), id]);
      return { status: "review" };
    }
    const now = iso();
    const n = await sql.execute(`UPDATE payment_attempts SET status = 'paid', paid_at = ?, provider_status = ?, provider_txn_ref = ?, updated_at = ? WHERE id = ? AND status NOT IN ('paid', 'review')`,
      [now, r.providerStatus, r.providerTxnRef, now, id]);
    if (n.rowsAffected) await applyEffect(sql, id);
    return { status: "paid" };
  }
  if (r.status === "pending") {
    await sql.execute(`UPDATE payment_attempts SET status = 'pending', provider_status = ?, updated_at = ? WHERE id = ? AND status IN ('created', 'redirected', 'pending')`, [r.providerStatus, iso(), id]);
    return { status: "pending" };
  }
  // Failed / cancelled never overwrite a payment already confirmed.
  await sql.execute(`UPDATE payment_attempts SET status = ?, provider_status = ?, updated_at = ? WHERE id = ? AND status IN ('created', 'redirected', 'pending')`, [r.status, r.providerStatus, iso(), id]);
  return { status: r.status };
}

/** The paid attempt's effect, exactly once (applied_at): the order is marked
 * paid (not delivered), or the subscription is extended by one plan term. */
async function applyEffect(sql: Sql, attemptId: string) {
  const now = iso();
  const claim = await sql.execute(`UPDATE payment_attempts SET applied_at = ? WHERE id = ? AND applied_at IS NULL AND status = 'paid'`, [now, attemptId]);
  if (!claim.rowsAffected) return;
  const a = (await sql.execute(`SELECT * FROM payment_attempts WHERE id = ?`, [attemptId])).rows[0];
  if (a.purpose === "web_order") {
    // Paid only; fulfilment, the POS invoice, stock and FBR stay with staff as before.
    await sql.execute(`UPDATE web_orders SET payment_status = 'paid', updated_at = ? WHERE id = ? AND tenant_id = ?`, [now, a.ref_id, a.tenant_id]);
    const o = (await sql.execute(`SELECT status, reserved_until FROM web_orders WHERE id = ? AND tenant_id = ?`, [a.ref_id, a.tenant_id])).rows[0];
    // Paid after the stock hold ran out: staff check the order before fulfilling it.
    if (o && o.status === "pending" && String(o.reserved_until ?? "") <= now) {
      await sql.execute(`UPDATE payment_attempts SET review_note = 'Paid after the stock hold expired: check stock before fulfilling' WHERE id = ?`, [attemptId]);
    }
    await sql.execute(`INSERT INTO web_order_events (id, order_id, tenant_id, actor, action, note, created_at) VALUES (?, ?, ?, 'payment', 'paid_online', ?, ?)`,
      [randomUUID(), a.ref_id, a.tenant_id, `${a.provider} ${a.reference}`, now]).catch(() => undefined);
  } else if (a.purpose === "subscription") {
    const t = (await sql.execute(`SELECT t.subscription_expires_at, p.duration_days FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.subscription_plan_id WHERE t.id = ?`, [a.ref_id])).rows[0];
    const days = Number(t?.duration_days) || 30;
    const from = Math.max(Date.now(), t?.subscription_expires_at ? Date.parse(String(t.subscription_expires_at)) || 0 : 0);
    await sql.execute(`UPDATE tenants SET subscription_status = 'active', subscription_expires_at = ?, updated_at = ? WHERE id = ?`, [new Date(from + days * 86_400_000).toISOString(), now, a.ref_id]);
  }
  await audit(sql, (a.tenant_id as string | null) ?? null, null, "payment.applied", { attempt: attemptId, purpose: a.purpose, ref: a.ref_id });
}

/** Asks the provider (staff "Check again" or the reconciliation job). */
export async function recheckAttempt(sql: Sql, attemptId: string) {
  const a = (await sql.execute(`SELECT * FROM payment_attempts WHERE id = ?`, [attemptId])).rows[0];
  if (!a) throw new HttpError(404, "Payment not found.");
  const def = PROVIDERS[String(a.provider) as ProviderId];
  if (!def.adapter) throw new HttpError(409, `${def.label} status checks need the provider's integration kit.`);
  const m = await merchantRow(sql, String(a.merchant_id));
  const r = await def.adapter.inquire(decryptSecrets(String(m.credentials_enc)), String(m.environment) as Env, String(a.reference));
  if (!r) { await event(sql, attemptId, (a.tenant_id as string | null) ?? null, "inquiry", null, false, "no answer"); return { status: String(a.status) }; }
  return applyResult(sql, a, r, "inquiry");
}

/** Reconciliation job: uncertain attempts older than 10 minutes, asked once per run (bounded). */
export async function reconcilePending(sql: Sql, limit = 20) {
  const before = new Date(Date.now() - 10 * 60_000).toISOString();
  const rows = (await sql.execute(`SELECT id, provider FROM payment_attempts WHERE status IN ('redirected', 'pending') AND updated_at < ? ORDER BY updated_at LIMIT ?`, [before, limit])).rows;
  let checked = 0;
  for (const r of rows) {
    if (!PROVIDERS[String(r.provider) as ProviderId]?.adapter) continue;
    await recheckAttempt(sql, String(r.id)).catch(() => undefined);
    checked++;
  }
  return { candidates: rows.length, checked };
}

// ── Transactions, refunds ─────────────────────────────────────────────────

export async function listAttempts(sql: Sql, caller: Caller, tenantId: string | null, limit = 200) {
  const owner = ownerFor(caller.role === "staff" ? { ...caller, role: "owner" } : caller, tenantId);
  if (caller.role === "staff" && !callerCan(caller, "payments.refund")) throw new HttpError(403, "Online payments are for the owner (or staff allowed refunds).");
  const rows = (await sql.execute(
    `SELECT a.*, (SELECT COALESCE(SUM(amount_minor), 0) FROM payment_refunds f WHERE f.attempt_id = a.id AND f.status IN ('completed', 'manual_pending', 'requested')) AS refunded_minor
     FROM payment_attempts a WHERE ${owner === null ? "a.tenant_id IS NULL" : "a.tenant_id = ?"} ORDER BY a.created_at DESC LIMIT ?`,
    [...ownerArgs(owner), Math.min(500, limit)],
  )).rows;
  // Manual refunds still to be made in the merchant portal (then marked done here).
  const waiting = rows.length ? (await sql.execute(
    `SELECT f.id, f.attempt_id, f.amount_minor FROM payment_refunds f JOIN payment_attempts a ON a.id = f.attempt_id WHERE f.status = 'manual_pending' AND ${owner === null ? "a.tenant_id IS NULL" : "a.tenant_id = ?"}`,
    ownerArgs(owner),
  )).rows : [];
  return rows.map((r) => ({
    manualRefunds: waiting.filter((w) => w.attempt_id === r.id).map((w) => ({ id: String(w.id), amount: Number(w.amount_minor) / 100 })),
    id: String(r.id), purpose: String(r.purpose), refId: String(r.ref_id), branchId: (r.branch_id as string | null) ?? null, provider: String(r.provider),
    method: String(r.method), amount: Number(r.amount_minor) / 100, currency: String(r.currency), reference: String(r.reference), status: String(r.status),
    providerRef: (r.provider_txn_ref as string | null) ?? null, settlement: String(r.settlement_status), reviewNote: (r.review_note as string | null) ?? null,
    refunded: Number(r.refunded_minor) / 100, createdAt: String(r.created_at), paidAt: (r.paid_at as string | null) ?? null,
  }));
}

/** A refund: through the provider when its adapter supports it, otherwise
 * recorded as a manual refund (done outside the app) for staff to complete.
 * Separate from stock returns. */
export async function requestRefund(sql: Sql, caller: Caller, attemptId: string, input: Record<string, unknown>) {
  if (caller.role === "super_admin" || !caller.tenantId) throw new HttpError(403, "Refunds are made by the business.");
  if (!callerCan(caller, "payments.refund")) throw new HttpError(403, "Refunds are not enabled for your login or business.");
  const a = (await sql.execute(`SELECT * FROM payment_attempts WHERE id = ? AND tenant_id = ?`, [attemptId, caller.tenantId])).rows[0];
  if (!a) throw new HttpError(404, "Payment not found.");
  if (a.status !== "paid" && a.status !== "review") throw new HttpError(409, "Only a received payment can be refunded.");
  const amountMinor = toMinor(Number(input.amount));
  const done = Number((await sql.execute(`SELECT COALESCE(SUM(amount_minor), 0) AS n FROM payment_refunds WHERE attempt_id = ? AND status IN ('completed', 'manual_pending', 'requested')`, [attemptId])).rows[0]?.n ?? 0);
  if (!(amountMinor > 0) || amountMinor > Number(a.amount_minor) - done) throw new HttpError(400, `Refund up to Rs ${((Number(a.amount_minor) - done) / 100).toFixed(2)}.`);
  const key = str(input.idempotencyKey, 80) || randomUUID();
  const prev = (await sql.execute(`SELECT id, status FROM payment_refunds WHERE attempt_id = ? AND idempotency_key = ?`, [attemptId, key])).rows[0];
  if (prev) return { id: String(prev.id), status: String(prev.status), repeated: true };
  const def = PROVIDERS[String(a.provider) as ProviderId];
  const id = randomUUID();
  const now = iso();
  const reason = str(input.reason, 300) || null;
  if (def.adapter?.refund) {
    await sql.execute(`INSERT INTO payment_refunds (id, attempt_id, tenant_id, amount_minor, mode, status, reason, idempotency_key, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'provider', 'requested', ?, ?, ?, ?, ?)`,
      [id, attemptId, caller.tenantId, amountMinor, reason, key, caller.userId, now, now]);
    const m = await merchantRow(sql, String(a.merchant_id));
    const r = await def.adapter.refund(decryptSecrets(String(m.credentials_enc)), String(m.environment) as Env, String(a.reference), amountMinor, key).catch(() => ({ ok: false, providerRef: null, note: "No answer" }));
    await sql.execute(`UPDATE payment_refunds SET status = ?, provider_ref = ?, updated_at = ? WHERE id = ?`, [r.ok ? "completed" : "failed", r.providerRef, iso(), id]);
    await audit(sql, caller.tenantId, caller, "refund.provider", { attempt: attemptId, amountMinor, ok: r.ok });
    return { id, status: r.ok ? "completed" : "failed", note: r.note };
  }
  await sql.execute(`INSERT INTO payment_refunds (id, attempt_id, tenant_id, amount_minor, mode, status, reason, idempotency_key, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', 'manual_pending', ?, ?, ?, ?, ?)`,
    [id, attemptId, caller.tenantId, amountMinor, reason, key, caller.userId, now, now]);
  await audit(sql, caller.tenantId, caller, "refund.manual_recorded", { attempt: attemptId, amountMinor });
  return { id, status: "manual_pending", note: `${def.label} refunds are made from the merchant portal. Mark it done here once it is.` };
}

export async function completeManualRefund(sql: Sql, caller: Caller, refundId: string, providerRef: unknown) {
  if (!caller.tenantId || !callerCan(caller, "payments.refund")) throw new HttpError(403, "Refunds are not enabled for your login or business.");
  const n = await sql.execute(`UPDATE payment_refunds SET status = 'completed', provider_ref = ?, completed_by = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND status = 'manual_pending'`,
    [str(providerRef, 80) || null, caller.userId, iso(), refundId, caller.tenantId]);
  if (!n.rowsAffected) throw new HttpError(404, "No manual refund waiting.");
  await audit(sql, caller.tenantId, caller, "refund.manual_completed", { refund: refundId });
  return { ok: true };
}

// ── Access requests ───────────────────────────────────────────────────────

const REQUESTABLE = ["jazzcash", "easypaisa", "card", "custom_merchant", "refund"] as const;

export async function requestAccess(sql: Sql, caller: Caller, methods: unknown, note: unknown) {
  if (caller.role !== "owner" || !caller.tenantId) throw new HttpError(403, "The business owner requests online payments.");
  const list = (Array.isArray(methods) ? methods : []).map(String).filter((m) => (REQUESTABLE as readonly string[]).includes(m));
  if (!list.length) throw new HttpError(400, "Choose what you need.");
  if ((await sql.execute(`SELECT 1 FROM payment_access_requests WHERE tenant_id = ? AND status = 'pending'`, [caller.tenantId])).rows[0]) throw new HttpError(409, "A request is already waiting for MAVIN.pk.");
  const id = randomUUID();
  await sql.execute(`INSERT INTO payment_access_requests (id, tenant_id, methods, note, status, requested_by, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    [id, caller.tenantId, JSON.stringify(list), str(note, 500) || null, caller.userId, iso()]);
  // The Super Admin's inbox (Queries) shows it.
  const t = (await sql.execute(`SELECT name FROM tenants WHERE id = ?`, [caller.tenantId])).rows[0];
  await sql.execute(`INSERT INTO site_queries (id, submission_key, kind, name, business_name, message, topic, status, created_at) VALUES (?, ?, 'contact', ?, ?, ?, 'payments-request', 'unread', ?)`,
    [randomUUID(), `payments-${id}`, String(t?.name ?? ""), String(t?.name ?? ""), `Online payments requested: ${list.join(", ")}${note ? ` (${str(note, 300)})` : ""}. Decide in Super Admin > Payments.`, iso()]).catch(() => undefined);
  await audit(sql, caller.tenantId, caller, "access.requested", { methods: list });
  return { id };
}

export async function listRequests(sql: Sql, caller: Caller, tenantId: string | null) {
  if (caller.role === "super_admin") {
    const rows = (await sql.execute(
      `SELECT r.*, t.name AS tenant_name FROM payment_access_requests r JOIN tenants t ON t.id = r.tenant_id ${tenantId ? "WHERE r.tenant_id = ?" : ""} ORDER BY r.status = 'pending' DESC, r.created_at DESC LIMIT 100`,
      tenantId ? [tenantId] : [],
    )).rows;
    return rows.map(mapRequest);
  }
  if (!caller.tenantId) throw new HttpError(403, "Not available.");
  return (await sql.execute(`SELECT r.*, NULL AS tenant_name FROM payment_access_requests r WHERE r.tenant_id = ? ORDER BY r.created_at DESC LIMIT 20`, [caller.tenantId])).rows.map(mapRequest);
}

const mapRequest = (r: Record<string, unknown>) => ({
  id: String(r.id), tenantId: String(r.tenant_id), tenantName: (r.tenant_name as string | null) ?? null, methods: jsonList(r.methods), note: (r.note as string | null) ?? null,
  status: String(r.status), decisionNote: (r.decision_note as string | null) ?? null, createdAt: String(r.created_at), decidedAt: (r.decided_at as string | null) ?? null,
});

/** Approving switches the requested features on for the business (it does not connect any account). */
export async function decideRequest(sql: Sql, caller: Caller, id: string, approve: boolean, note: unknown) {
  if (caller.role !== "super_admin") throw new HttpError(403, "Only the Super Admin decides.");
  const r = (await sql.execute(`SELECT * FROM payment_access_requests WHERE id = ? AND status = 'pending'`, [id])).rows[0];
  if (!r) throw new HttpError(404, "No pending request.");
  const why = str(note, 300);
  if (!approve && !why) throw new HttpError(400, "Give a reason for rejecting.");
  const stmts: { sql: string; args: unknown[] }[] = [
    { sql: `UPDATE payment_access_requests SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ? AND status = 'pending'`, args: [approve ? "approved" : "rejected", caller.userId, why || null, iso(), id] },
  ];
  if (approve) {
    const t = (await sql.execute(`SELECT denied_actions FROM tenants WHERE id = ?`, [r.tenant_id])).rows[0];
    const list = new Set(jsonList(t?.denied_actions));
    for (const m of ["online", ...jsonList(r.methods)]) list.add(`+payments.${m}`);
    stmts.push({ sql: `UPDATE tenants SET denied_actions = ?, updated_at = ? WHERE id = ?`, args: [JSON.stringify([...list]), iso(), r.tenant_id] });
  }
  await sql.batch(stmts);
  await audit(sql, String(r.tenant_id), caller, approve ? "access.approved" : "access.rejected", { request: id, methods: jsonList(r.methods), note: why || null });
  return { ok: true };
}

/** Readiness per business for the Super Admin (no secrets). */
export async function platformOverview(sql: Sql, caller: Caller) {
  if (caller.role !== "super_admin") throw new HttpError(403, "Super Admin only.");
  const merchants = (await sql.execute(
    `SELECT m.tenant_id, t.name, m.provider, m.environment, m.status, m.enabled, m.last_test_ok, m.last_test_at FROM payment_merchants m LEFT JOIN tenants t ON t.id = m.tenant_id ORDER BY m.tenant_id IS NOT NULL, t.name`,
  )).rows.map((r) => ({
    tenantId: (r.tenant_id as string | null) ?? null, tenantName: (r.name as string | null) ?? "MAVIN.pk (subscriptions)", provider: String(r.provider), environment: String(r.environment),
    status: String(r.status), enabled: Number(r.enabled) === 1, lastTestOk: r.last_test_ok == null ? null : Number(r.last_test_ok) === 1, lastTestAt: (r.last_test_at as string | null) ?? null,
  }));
  const pending = Number((await sql.execute(`SELECT COUNT(*) AS n FROM payment_access_requests WHERE status = 'pending'`)).rows[0]?.n ?? 0);
  const review = Number((await sql.execute(`SELECT COUNT(*) AS n FROM payment_attempts WHERE status = 'review'`)).rows[0]?.n ?? 0);
  return { merchants, pendingRequests: pending, inReview: review, secretsReady: Boolean(process.env.PAYMENTS_SECRET_KEY?.trim()), providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, integrationReady: Boolean(p.adapter) })) };
}
