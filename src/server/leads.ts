/** Demo and contact requests from the public site. Checked here (fields,
 * a hidden honeypot field, a minimum fill time, a per-address rate limit),
 * then saved as a query for Super Admin > Queries (src/server/queries.ts).
 * Contents are never logged. */
import { createHash } from "node:crypto";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const LEAD_KINDS = ["demo", "contact"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

export interface Lead {
  kind: LeadKind;
  name: string;
  business: string;
  businessType: string;
  branches: string;
  phone: string;
  email: string;
  workflow: string;
  /** What the visitor came about (Contact page links: FBR setup, pricing). */
  topic: string;
  /** One per form: a double-click or a retry sends the same key and saves one query. */
  submissionKey: string;
}

export interface LeadInput extends Partial<Record<keyof Lead, unknown>> {
  /** The form's own id for this submission. */
  submissionId?: unknown;
  /** Honeypot: hidden from people, filled by bots. */
  website?: unknown;
  /** When the form was shown (ms since epoch). */
  shownAt?: unknown;
}

export class LeadError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const MIN_FILL_MS = 3_000;
const MAX_FORM_AGE_MS = 24 * 3600_000;
const LIMIT = 5;
const WINDOW_MS = 10 * 60_000;
const recent = new Map<string, number[]>();

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** Checks a submission. Returns the clean lead, or null for a bot (answered as if accepted). */
export function checkLead(input: LeadInput, ip: string | null, now = Date.now()): Lead | null {
  const key = ip ?? "?";
  const calls = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (calls.length >= LIMIT) throw new LeadError(429, "Too many requests from this connection. Try again in a few minutes.");
  calls.push(now);
  recent.set(key, calls);

  if (text(input.website, 200)) return null;
  const shownAt = Number(input.shownAt);
  if (!Number.isFinite(shownAt) || now - shownAt < MIN_FILL_MS || now - shownAt > MAX_FORM_AGE_MS) return null;

  const kind = LEAD_KINDS.includes(input.kind as LeadKind) ? (input.kind as LeadKind) : "contact";
  const lead: Lead = {
    kind,
    name: text(input.name, 100),
    business: text(input.business, 120),
    businessType: text(input.businessType, 60),
    branches: text(input.branches, 20),
    phone: text(input.phone, 30),
    email: text(input.email, 120).toLowerCase(),
    workflow: typeof input.workflow === "string" ? input.workflow.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "",
    topic: text(input.topic, 80),
    submissionKey: "",
  };
  // Without the form's key (an old page), the same content counts as the same submission.
  const sid = text(input.submissionId, 64);
  lead.submissionKey = /^[A-Za-z0-9-]{8,64}$/.test(sid)
    ? `form:${sid}`
    : `hash:${createHash("sha256").update(JSON.stringify([kind, lead.name, lead.business, lead.phone, lead.email, lead.workflow])).digest("hex")}`;
  const fields: Record<string, string> = {};
  if (lead.name.length < 2) fields.name = "Enter your name.";
  if (lead.business.length < 2) fields.business = "Enter your business name.";
  if (!lead.phone && !lead.email) fields.phone = "Enter a phone number or an email address.";
  if (lead.phone && !/^\+?[0-9][0-9 -]{6,18}$/.test(lead.phone)) fields.phone = "Enter a phone number with digits only, for example 0300 1234567.";
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) fields.email = "Enter a valid email address.";
  if (kind === "demo" && !lead.businessType) fields.businessType = "Choose your business type.";
  if (kind === "demo" && lead.branches && !/^[0-9]{1,4}$/.test(lead.branches)) fields.branches = "Enter the number of branches.";
  if (Object.keys(fields).length) throw new LeadError(400, "Please correct the highlighted fields.", fields);
  return lead;
}
