/** Mavin Pharmacy Offline: the installation's license.
 *
 * A license is issued by MAVIN.pk (Super Admin, or scripts/issue-license.cjs
 * with the private key, which is never in this app) and checked here with the
 * bundled public key, offline:
 *
 *   MAVIN-LICENSE-1.<payload base64url>.<Ed25519 signature base64url>
 *   payload = { v:1, licenseId, installationId, licensee, kind, issuedAt, expiresAt }
 *
 * - Bound to this installation (installationId); a file for another is refused.
 * - A tampered file fails the signature check.
 * - An older file cannot replace a newer one (issuedAt), so an old renewal
 *   cannot be replayed to undo a newer one.
 * - Before the first activation: a trial of TRIAL_DAYS from setup.
 * - After expiry: GRACE_DAYS of warning (MAVIN's default), then no new
 *   transactions until renewed; records, reports and backups stay available.
 * - Moving the computer's date back past the latest date seen counts as expired.
 * The recovery key plays no part here. */
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import type { LocalDb } from "./localdb";

export const TRIAL_DAYS = 3;   // src/lib/subscription.ts TRIAL_DAYS
export const GRACE_DAYS = 7;   // src/lib/subscription.ts DEFAULT_GRACE_DAYS
const PREFIX = "MAVIN-LICENSE-1";
const DAY = 86_400_000;
const CLOCK_SLACK = DAY;

export interface LicensePayload {
  v: 1;
  licenseId: string;
  installationId: string;
  licensee: string;
  kind: "activation" | "renewal";
  issuedAt: string;
  expiresAt: string;
}

export interface LicenseInfo {
  installationId: string;
  status: "trial" | "active" | "expired" | "invalid";
  expiresAt: string | null;
  daysLeft: number | null;
  licensee: string | null;
  licenseId: string | null;
  kind: "trial" | "activation" | "renewal" | null;
  message: string;
  /** New transactions allowed (active, trial, or within the grace days). */
  canTransact: boolean;
}

export class LicenseError extends Error {}

export function parseLicense(text: string, publicKey: KeyObject): LicensePayload {
  const t = String(text ?? "").trim().replace(/\s+/g, "");
  const parts = t.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new LicenseError("This is not a Mavin Pharmacy license file.");
  const body = Buffer.from(parts[1], "base64url");
  const sig = Buffer.from(parts[2], "base64url");
  if (!verify(null, body, publicKey, sig)) throw new LicenseError("This license file has been changed or was not issued by MAVIN.pk.");
  let p: LicensePayload;
  try { p = JSON.parse(body.toString("utf8")) as LicensePayload; } catch { throw new LicenseError("The license file cannot be read."); }
  if (p.v !== 1 || !p.licenseId || !p.installationId || !Date.parse(p.expiresAt) || !Date.parse(p.issuedAt)) throw new LicenseError("The license file is incomplete.");
  if (p.kind !== "activation" && p.kind !== "renewal") throw new LicenseError("Unknown license kind.");
  return p;
}

export class License {
  readonly publicKey: KeyObject;
  private db: LocalDb;
  private now: () => Date;
  constructor(db: LocalDb, publicKeyPem: string, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
    this.publicKey = createPublicKey(publicKeyPem);
  }

  get installationId(): string { return this.db.meta("installation_id")!; }

  /** The date can only move forward (within a day's slack). */
  private clock(): { now: number; rolledBack: boolean } {
    const now = this.now().getTime();
    const high = Number(this.db.meta("clock_high_water") ?? "0");
    if (now > high) this.db.setMeta("clock_high_water", String(now));
    return { now, rolledBack: high > 0 && now < high - CLOCK_SLACK };
  }

  current(): LicensePayload | null {
    const text = this.db.meta("license");
    if (!text) return null;
    try {
      const p = parseLicense(text, this.publicKey);
      return p.installationId === this.installationId ? p : null;
    } catch { return null; }
  }

  info(): LicenseInfo {
    const { now, rolledBack } = this.clock();
    const base = { installationId: this.installationId };
    const stored = this.db.meta("license");
    const lic = this.current();
    if (stored && !lic) {
      return { ...base, status: "invalid", expiresAt: null, daysLeft: null, licensee: null, licenseId: null, kind: null, canTransact: false, message: "The saved license does not verify for this installation. Import a valid license from MAVIN.pk." };
    }
    const trialStart = Date.parse(this.db.meta("trial_started_at") ?? "");
    const expires = lic ? Date.parse(lic.expiresAt) : Number.isFinite(trialStart) ? trialStart + TRIAL_DAYS * DAY : NaN;
    const kind: LicenseInfo["kind"] = lic ? lic.kind : Number.isFinite(trialStart) ? "trial" : null;
    const daysLeft = Number.isFinite(expires) ? Math.ceil((expires - now) / DAY) : null;
    const common = { ...base, expiresAt: Number.isFinite(expires) ? new Date(expires).toISOString() : null, daysLeft, licensee: lic?.licensee ?? null, licenseId: lic?.licenseId ?? null, kind };
    if (rolledBack) return { ...common, status: "expired", canTransact: false, message: "The computer's date is earlier than a date this app has already seen. Correct the date and time in Windows." };
    if (!Number.isFinite(expires)) return { ...common, status: "invalid", canTransact: false, message: "No license yet." };
    if (now <= expires) {
      return { ...common, status: lic ? "active" : "trial", canTransact: true, message: lic ? `Licensed to ${lic.licensee} until ${new Date(expires).toDateString()}.` : `Trial: ${daysLeft} day(s) left. Activate with a license from MAVIN.pk.` };
    }
    const graceEnd = expires + GRACE_DAYS * DAY;
    if (lic && now <= graceEnd) {
      return { ...common, status: "expired", canTransact: true, message: `The license expired on ${new Date(expires).toDateString()}. New transactions stop after ${new Date(graceEnd).toDateString()}: renew now.` };
    }
    return { ...common, status: "expired", canTransact: false, message: `The ${lic ? "license" : "trial"} expired on ${new Date(expires).toDateString()}. Records, reports and backups stay available; import a renewal from MAVIN.pk to enter new transactions.` };
  }

  /** Imports an activation or renewal (offline). */
  import(text: string, actor: string): LicenseInfo {
    const p = parseLicense(text, this.publicKey);
    if (p.installationId !== this.installationId) throw new LicenseError(`This license is for another installation (${p.installationId.slice(0, 8)}…). This installation is ${this.installationId.slice(0, 8)}….`);
    const cur = this.current();
    if (cur && Date.parse(p.issuedAt) < Date.parse(cur.issuedAt)) throw new LicenseError("This license is older than the one already installed.");
    if (cur && p.licenseId === cur.licenseId && p.expiresAt === cur.expiresAt) throw new LicenseError("This license is already installed.");
    this.db.setMeta("license", String(text).trim().replace(/\s+/g, ""));
    this.db.audit(actor, "license_imported", { licenseId: p.licenseId, kind: p.kind, expiresAt: p.expiresAt });
    return this.info();
  }

  /** What the pharmacy sends to MAVIN.pk to get a license (no secret in it). */
  requestCode(pharmacyName: string, appVersion: string): string {
    const body = JSON.stringify({ v: 1, installationId: this.installationId, pharmacy: pharmacyName, appVersion, at: this.now().toISOString() });
    return `MAVIN-REQUEST-1.${Buffer.from(body).toString("base64url")}`;
  }
}
