/** eProcurement vendor registration: the details a vendor fills in four steps
 * (company, owner and business type; address; bank; review) and the rules for
 * each field. Shared by the vendor portal's steps (checked as they type) and
 * the server (src/server/vendorRegistration.ts), which checks them again. */


export type VendorStatus = "draft" | "pending" | "changes" | "approved" | "rejected" | "suspended" | "blacklisted";
export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  draft: "Registration not submitted", pending: "Waiting for approval", changes: "Changes requested", approved: "Approved",
  rejected: "Rejected", suspended: "Suspended", blacklisted: "Blacklisted",
};
export type BusinessKind = "supplier" | "services" | "both";
export const BUSINESS_KIND_LABEL: Record<BusinessKind, string> = { supplier: "Supplier (goods)", services: "Services", both: "Supplier and services" };

export interface VendorProfile {
  company: { name: string; regNo: string; ntn: string; phone: string; email: string; website: string };
  owner: { name: string; designation: string; cnic: string; mobile: string; email: string };
  business: { kind: BusinessKind | ""; categories: string[]; description: string };
  address: { line1: string; area: string; city: string; province: string; postalCode: string; country: string };
  bank: { accountTitle: string; bank: string; iban: string; accountNo: string; branch: string; branchCode: string; city: string };
}
export type ProfileStep = "company" | "address" | "bank";

export interface EpCategory { id: string; kind: "supplier" | "services"; name: string; active: boolean; sort: number }

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
export function emptyProfile(): VendorProfile {
  return {
    company: { name: "", regNo: "", ntn: "", phone: "", email: "", website: "" },
    owner: { name: "", designation: "", cnic: "", mobile: "", email: "" },
    business: { kind: "", categories: [], description: "" },
    address: { line1: "", area: "", city: "", province: "", postalCode: "", country: "Pakistan" },
    bank: { accountTitle: "", bank: "", iban: "", accountNo: "", branch: "", branchCode: "", city: "" },
  };
}

/** Any stored or sent profile, cleaned to the known fields and lengths. */
export function cleanProfile(raw: unknown, base: VendorProfile = emptyProfile()): VendorProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown>>;
  const pick = <K extends keyof VendorProfile>(k: K, max: Record<string, number>): VendorProfile[K] => {
    const src = (r[k] && typeof r[k] === "object" ? r[k] : {}) as Record<string, unknown>;
    const out = { ...(base[k] as Record<string, unknown>) };
    for (const [f, m] of Object.entries(max)) if (f in src) out[f] = text(src[f], m);
    return out as VendorProfile[K];
  };
  const p: VendorProfile = {
    company: pick("company", { name: 200, regNo: 60, ntn: 30, phone: 30, email: 120, website: 200 }),
    owner: pick("owner", { name: 120, designation: 80, cnic: 20, mobile: 30, email: 120 }),
    business: { ...base.business },
    address: pick("address", { line1: 300, area: 120, city: 80, province: 80, postalCode: 12, country: 60 }),
    bank: pick("bank", { accountTitle: 160, bank: 120, iban: 40, accountNo: 40, branch: 120, branchCode: 20, city: 80 }),
  };
  const b = (r.business && typeof r.business === "object" ? r.business : null) as Record<string, unknown> | null;
  if (b) {
    if ("kind" in b) p.business.kind = (["supplier", "services", "both"].includes(String(b.kind)) ? String(b.kind) : "") as BusinessKind | "";
    if ("categories" in b) p.business.categories = Array.from(new Set((Array.isArray(b.categories) ? b.categories : []).map((c) => text(c, 80)).filter(Boolean))).slice(0, 30);
    if ("description" in b) p.business.description = typeof b.description === "string" ? b.description.trim().slice(0, 1000) : "";
  }
  p.bank.iban = p.bank.iban.replace(/[\s-]/g, "").toUpperCase();
  p.owner.cnic = p.owner.cnic.replace(/\s/g, "");
  return p;
}

export function parseProfile(json: unknown): VendorProfile {
  if (typeof json !== "string" || !json) return emptyProfile();
  try { return cleanProfile(JSON.parse(json)); } catch { return emptyProfile(); }
}

export const PHONE = /^\+?[0-9][0-9 -]{6,18}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** What is still missing or wrong in one step ({field: message}), empty when it is complete. */
export function stepProblems(p: VendorProfile, step: ProfileStep): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === "company") {
    if (p.company.name.length < 2) e["company.name"] = "Enter the company name";
    if (!PHONE.test(p.company.phone)) e["company.phone"] = "Enter the company phone number";
    if (!EMAIL.test(p.company.email)) e["company.email"] = "Enter the company email";
    if (p.company.website && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(p.company.website)) e["company.website"] = "Not a website address";
    if (p.owner.name.length < 2) e["owner.name"] = "Enter the owner's name";
    if (p.owner.cnic && !/^\d{5}-?\d{7}-?\d$/.test(p.owner.cnic)) e["owner.cnic"] = "CNIC: 13 digits (12345-1234567-1)";
    if (!PHONE.test(p.owner.mobile)) e["owner.mobile"] = "Enter the owner's mobile number";
    if (p.owner.email && !EMAIL.test(p.owner.email)) e["owner.email"] = "Not an email address";
    if (!p.business.kind) e["business.kind"] = "Choose supplier, services or both";
    if (!p.business.categories.length) e["business.categories"] = "Choose at least one kind of work";
  } else if (step === "address") {
    if (p.address.line1.length < 5) e["address.line1"] = "Enter the street address";
    if (p.address.city.length < 2) e["address.city"] = "Enter the city";
    if (p.address.province.length < 2) e["address.province"] = "Choose the province";
    if (p.address.country.length < 2) e["address.country"] = "Enter the country";
  } else {
    if (p.bank.accountTitle.length < 2) e["bank.accountTitle"] = "Enter the account title";
    if (p.bank.bank.length < 2) e["bank.bank"] = "Enter the bank";
    // A Pakistani IBAN: PK, 2 check digits, 4 letters (the bank) and 16 digits (24 characters).
    if (!/^PK\d{2}[A-Z]{4}[0-9A-Z]{16}$/.test(p.bank.iban)) e["bank.iban"] = "IBAN: 24 characters, starting with PK (PK36SCBL0000001123456702)";
    if (!/^[0-9-]{6,30}$/.test(p.bank.accountNo)) e["bank.accountNo"] = "Enter the account number (digits)";
    if (p.bank.branch.length < 2) e["bank.branch"] = "Enter the branch";
    if (p.bank.city.length < 2) e["bank.city"] = "Enter the branch city";
  }
  return e;
}

export const allProblems = (p: VendorProfile) => ({ ...stepProblems(p, "company"), ...stepProblems(p, "address"), ...stepProblems(p, "bank") });
export const profileComplete = (p: VendorProfile) => Object.keys(allProblems(p)).length === 0;
