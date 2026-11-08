/** Payment providers, their adapters and secret encryption (server only).
 *
 * Visa and Mastercard are card networks, not gateways: cards are taken on the
 * provider's own hosted card page (JazzCash / Easypaisa merchant products that
 * include card acceptance), never by a card form on MAVIN.pk. Card numbers,
 * CVV, PINs and OTPs never reach this server.
 *
 * Adapters: the code that talks to a provider (start, verify, inquire, refund)
 * must follow that provider's official merchant integration kit, which JazzCash
 * and Easypaisa issue to approved merchants (not public). Until an adapter is
 * written from the kit and passes a sandbox test, `adapter` is null: the
 * provider can be configured but never activated, and no checkout offers it. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./db";

export type ProviderId = "jazzcash" | "easypaisa";
export type PayMethod = "wallet" | "card";
export const METHOD_LABEL: Record<PayMethod, string> = { wallet: "Mobile wallet", card: "Visa / Mastercard" };

/** What a provider says about one payment, after the adapter checked its signature. */
export interface ProviderResult {
  reference: string;
  status: "paid" | "failed" | "pending" | "cancelled";
  amountMinor: number;
  currency: string;
  providerTxnRef: string | null;
  providerStatus: string;
}
export interface InitiateResult { action: string; method: "POST" | "GET"; fields: Record<string, string> }
export interface AttemptForAdapter { reference: string; amountMinor: number; currency: string; method: PayMethod; description: string; callbackUrl: string; returnUrl: string; customerPhone: string | null; customerEmail: string | null }

export interface Adapter {
  /** Form or redirect that sends the customer to the provider's hosted page. */
  initiate(creds: Record<string, string>, env: "sandbox" | "live", a: AttemptForAdapter): Promise<InitiateResult>;
  /** The reference in a callback (to find the attempt and its merchant). */
  referenceOf(params: Record<string, string>): string | null;
  /** Checks the callback's signature with the merchant's secret; null when it does not verify. */
  verifyCallback(creds: Record<string, string>, params: Record<string, string>): ProviderResult | null;
  /** Asks the provider for the payment's status (reconciliation, uncertain payments). */
  inquire(creds: Record<string, string>, env: "sandbox" | "live", reference: string): Promise<ProviderResult | null>;
  /** Provider refund, when the merchant product supports it. */
  refund?: (creds: Record<string, string>, env: "sandbox" | "live", reference: string, amountMinor: number, idempotencyKey: string) => Promise<{ ok: boolean; providerRef: string | null; note: string }>;
  /** Credentials check against the sandbox or live service. */
  test(creds: Record<string, string>, env: "sandbox" | "live"): Promise<{ ok: boolean; note: string }>;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  methods: PayMethod[];
  /** Fields the merchant kit issues (confirm the names against the kit before going live). */
  fields: { key: string; label: string; secret: boolean }[];
  onboarding: string;
  adapter: Adapter | null;
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  jazzcash: {
    id: "jazzcash",
    label: "JazzCash",
    methods: ["wallet", "card"],
    fields: [
      { key: "merchantId", label: "Merchant ID", secret: false },
      { key: "password", label: "Password", secret: true },
      { key: "integritySalt", label: "Integrity Salt", secret: true },
    ],
    onboarding: "Apply for a JazzCash merchant account (online payment gateway) with your business documents and website address. JazzCash issues sandbox and live credentials and its integration document; card acceptance (Visa / Mastercard) must be approved on the merchant account.",
    adapter: null,
  },
  easypaisa: {
    id: "easypaisa",
    label: "Easypaisa",
    methods: ["wallet", "card"],
    fields: [
      { key: "storeId", label: "Store ID", secret: false },
      { key: "hashKey", label: "Hash Key", secret: true },
    ],
    onboarding: "Apply for an Easypaisa (Easypay) merchant account with your business documents and website address. Easypaisa issues the store credentials and its merchant integration kit; card payments must be enabled on the store by Easypaisa.",
    adapter: null,
  },
};

export const isProvider = (p: unknown): p is ProviderId => p === "jazzcash" || p === "easypaisa";

/** Tests only: install a mock adapter (never used by the app). */
export function setAdapterForTests(id: ProviderId, a: Adapter | null) { PROVIDERS[id].adapter = a; }

// ── Secrets at rest ───────────────────────────────────────────────────────

/** AES-256-GCM with PAYMENTS_SECRET_KEY (32 bytes, base64). Without the key, secrets cannot be saved or used. */
function key(): Buffer {
  const raw = process.env.PAYMENTS_SECRET_KEY?.trim();
  if (!raw) throw new HttpError(503, "Online payment secrets are not set up on the server yet (PAYMENTS_SECRET_KEY).");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new HttpError(503, "PAYMENTS_SECRET_KEY must be 32 bytes, base64.");
  return k;
}

export function encryptSecrets(values: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(values), "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
}

export function decryptSecrets(blob: string | null | undefined): Record<string, string> {
  if (!blob) return {};
  if (!blob.startsWith("v1:")) throw new HttpError(500, "Unknown secret format.");
  const raw = Buffer.from(blob.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8")) as Record<string, string>;
}

/** "••••4f2a" for display; never the value. */
export const maskSecret = (v: string) => (v.length <= 4 ? "••••" : `••••${v.slice(-4)}`);
