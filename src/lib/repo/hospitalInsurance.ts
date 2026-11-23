/** Hospital insurance (v100): an insured patient's company, policy, valid
 * till and insured amount. The insurance covers each bill up to what is left
 * of the insured amount (bills in date order); the rest is the patient's.
 * Finance claims each episode's cover from the company: Not claimed, Sent for
 * claim, In process, Paid or Unpaid (an unpaid claim gives the amount back to
 * the policy). */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId, type TenantRow } from "./base";
import { currentActor, roleAllowed } from "./medicalRecord";
import { localDate } from "../localDate";
import { FINANCE_ROLES } from "../../config/hospitalStaff";
import type { ClaimStatus } from "./insurance";

export interface HospitalClaim extends TenantRow {
  episode_id: string; patient_id: string; company_id: string | null; claim_amount: number; status: Exclude<ClaimStatus, "not_claimed">;
  paid_amount: number; claim_ref: string | null; sent_on: string | null; settled_on: string | null; updated_by_name: string | null;
}
export const hospitalClaimsRepo = createTenantRepo<HospitalClaim>("hospital_insurance_claims");

const round = (n: number) => Math.round(n * 100) / 100;

export interface InsuredEpisode {
  episodeId: string; episodeNo: string; date: string; type: string; patientId: string; patientName: string; mrNo: string | null;
  policyNo: string | null; validTill: string | null; insuredAmount: number; companyId: string | null; companyName: string;
  total: number; cover: number; patientShare: number; status: ClaimStatus; claimId: string | null; claimRef: string | null; settledOn: string | null;
}

/** Every bill of insured patients (within the policy's validity, or already claimed), with the insurance's cover and the patient's share. */
export async function insuredEpisodes(f: { companyId?: string | null; patientId?: string | null; from?: string; to?: string; status?: ClaimStatus | "" ; search?: string } = {}): Promise<InsuredEpisode[]> {
  const T = requireCurrentTenantId();
  const rows = await dbSelect<Record<string, unknown>>(
    `SELECT e.id AS episode_id, e.episode_no, e.date, e.type, p.id AS patient_id, p.name AS patient_name, p.mr_no, p.insurance_no AS policy_no,
            NULLIF(p.insurance_valid_till, '') AS valid_till, COALESCE(p.insured_amount, 0) AS insured_amount,
            COALESCE(cl.company_id, p.insurance_company_id) AS company_id, ic.name AS company_name,
            COALESCE((SELECT SUM(amount) FROM hospital_charges c WHERE c.episode_id = e.id AND c.tenant_id = e.tenant_id AND c.deleted_at IS NULL), 0) AS total,
            cl.id AS claim_id, cl.claim_amount, cl.status, cl.claim_ref, cl.settled_on
     FROM hospital_episodes e
     JOIN hospital_patients p ON p.id = e.patient_id AND p.tenant_id = e.tenant_id
     LEFT JOIN hospital_insurance_claims cl ON cl.episode_id = e.id AND cl.tenant_id = ? AND cl.deleted_at IS NULL
     LEFT JOIN insurance_companies ic ON ic.id = COALESCE(cl.company_id, p.insurance_company_id) AND ic.tenant_id = ?
     WHERE e.tenant_id = ? AND e.deleted_at IS NULL AND e.status != 'cancelled'
       AND (cl.id IS NOT NULL OR (COALESCE(p.insured, 0) = 1 AND COALESCE(p.insurance_company_id, '') <> ''
            AND (COALESCE(p.insurance_valid_till, '') = '' OR e.date <= p.insurance_valid_till)))
     ORDER BY p.id, e.date, e.created_at`,
    [T, T, T]
  );
  // The insured amount is used up by the patient's bills in date order.
  const used = new Map<string, number>();
  const out: InsuredEpisode[] = [];
  for (const r of rows) {
    const pid = String(r.patient_id);
    const total = round(Number(r.total) || 0);
    const status = (r.status ? String(r.status) : "not_claimed") as ClaimStatus;
    const insured = Number(r.insured_amount) || 0;
    const left = insured > 0 ? Math.max(0, insured - (used.get(pid) ?? 0)) : total;
    const cover = r.claim_id ? round(Number(r.claim_amount) || 0) : round(Math.min(total, left));
    if (status !== "unpaid") used.set(pid, (used.get(pid) ?? 0) + cover);
    out.push({
      episodeId: String(r.episode_id), episodeNo: String(r.episode_no), date: String(r.date), type: String(r.type), patientId: pid,
      patientName: String(r.patient_name ?? ""), mrNo: r.mr_no == null ? null : String(r.mr_no), policyNo: r.policy_no == null ? null : String(r.policy_no),
      validTill: r.valid_till == null ? null : String(r.valid_till), insuredAmount: insured, companyId: r.company_id == null ? null : String(r.company_id),
      companyName: r.company_name == null ? "Unknown company" : String(r.company_name), total, cover, patientShare: round(total - cover),
      status, claimId: r.claim_id == null ? null : String(r.claim_id), claimRef: r.claim_ref == null ? null : String(r.claim_ref), settledOn: r.settled_on == null ? null : String(r.settled_on),
    });
  }
  const q = f.search?.trim().toLowerCase();
  return out.filter((r) =>
    (!f.companyId || r.companyId === f.companyId) && (!f.patientId || r.patientId === f.patientId)
    && (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) && (!f.status || r.status === f.status)
    && (!q || `${r.patientName} ${r.mrNo ?? ""} ${r.policyNo ?? ""} ${r.episodeNo}`.toLowerCase().includes(q))
  ).sort((a, b) => b.date.localeCompare(a.date));
}

/** One episode's split: what the insurance covers and what the patient pays (null when not insured). */
export async function episodeInsuranceSplit(episodeId: string): Promise<InsuredEpisode | null> {
  return (await insuredEpisodes()).find((e) => e.episodeId === episodeId) ?? null;
}

/** Sets the claim of episodes: "not_claimed" withdraws it; otherwise it is sent (for the cover then) or moved on. */
export async function setHospitalClaim(episodeIds: string[], status: ClaimStatus, ref?: string | null): Promise<number> {
  const a = await currentActor();
  if (!roleAllowed(FINANCE_ROLES, a)) throw new Error("Insurance claims are handled by Finance (the accountant or an administrator).");
  const by = a.designation ? `${a.name}, ${a.designation}` : a.name;
  const today = localDate();
  const all = await insuredEpisodes();
  let changed = 0;
  for (const id of [...new Set(episodeIds)]) {
    const e = all.find((x) => x.episodeId === id);
    if (!e) throw new Error("This episode is not an insured patient's.");
    const settled = status === "paid" || status === "unpaid" ? today : null;
    if (status === "not_claimed") {
      if (e.claimId) { await hospitalClaimsRepo.remove(e.claimId); changed++; }
      continue;
    }
    if (e.claimId) {
      if (e.status === status && (ref === undefined || ref === e.claimRef)) continue;
      await hospitalClaimsRepo.update(e.claimId, {
        status, settled_on: settled, updated_by_name: by, paid_amount: status === "paid" ? e.cover : 0, ...(ref === undefined ? {} : { claim_ref: ref?.trim() || null }),
      });
    } else {
      if (!(e.cover > 0)) throw new Error(`Nothing of ${e.episodeNo} is covered by the insurance.`);
      await hospitalClaimsRepo.create({
        episode_id: id, patient_id: e.patientId, company_id: e.companyId, claim_amount: e.cover, status, paid_amount: status === "paid" ? e.cover : 0,
        claim_ref: ref?.trim() || null, sent_on: today, settled_on: settled, updated_by_name: by,
      });
    }
    changed++;
  }
  return changed;
}

export interface CompanyOverview { cases: number; totalClaim: number; claimedCases: number; claimedTotal: number; paid: number; pending: number }

/** A company's cases: entertained, claimed, paid and still pending. */
export function companyOverview(rows: InsuredEpisode[]): CompanyOverview {
  const claimed = rows.filter((r) => r.status !== "not_claimed");
  return {
    cases: rows.length,
    totalClaim: round(rows.reduce((a, r) => a + r.cover, 0)),
    claimedCases: claimed.length,
    claimedTotal: round(claimed.reduce((a, r) => a + r.cover, 0)),
    paid: round(rows.filter((r) => r.status === "paid").reduce((a, r) => a + r.cover, 0)),
    pending: round(claimed.filter((r) => r.status === "sent" || r.status === "in_process").reduce((a, r) => a + r.cover, 0)),
  };
}
