import { getSetting, setSetting } from "./repo/settings";

/** A registration number printed under the business address, e.g. PST, CDSL No. */
export interface RegNumber {
  label: string;
  value: string;
}

/** Settings > Company Profile: what prints at the top of every invoice. */
export interface CompanyProfile {
  ntn: string;
  stn: string;
  pra: string;
  contact: string;
  address: string;
  /** The business name line can be left off the invoice. */
  showName: boolean;
  /** Name printed instead of the account name (blank = account name). */
  printName: string;
  numbers: RegNumber[];
}

const KEYS = {
  ntn: "company_ntn",
  stn: "company_stn",
  pra: "company_pra",
  contact: "company_contact",
  address: "company_address",
  showName: "company_show_name",
  printName: "company_print_name",
  numbers: "company_numbers",
} as const;

function parseNumbers(raw: string | null): RegNumber[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as RegNumber[];
    return Array.isArray(list) ? list.filter((n) => n && typeof n.label === "string" && typeof n.value === "string") : [];
  } catch {
    return [];
  }
}

export async function loadCompanyProfile(tenantId?: string): Promise<CompanyProfile> {
  const [ntn, stn, pra, contact, address, showName, printName, numbers] = await Promise.all(
    Object.values(KEYS).map((k) => getSetting(k, tenantId))
  );
  return {
    ntn: ntn ?? "",
    stn: stn ?? "",
    pra: pra ?? "",
    contact: contact ?? "",
    address: address ?? "",
    showName: showName !== "false",
    printName: printName ?? "",
    numbers: parseNumbers(numbers),
  };
}

export async function saveCompanyProfile(p: CompanyProfile, tenantId?: string): Promise<void> {
  const numbers = p.numbers.map((n) => ({ label: n.label.trim(), value: n.value.trim() })).filter((n) => n.label && n.value);
  await Promise.all([
    setSetting(KEYS.ntn, p.ntn.trim(), tenantId),
    setSetting(KEYS.stn, p.stn.trim(), tenantId),
    setSetting(KEYS.pra, p.pra.trim(), tenantId),
    setSetting(KEYS.contact, p.contact.trim(), tenantId),
    setSetting(KEYS.address, p.address.trim(), tenantId),
    setSetting(KEYS.showName, p.showName ? "true" : "false", tenantId),
    setSetting(KEYS.printName, p.printName.trim(), tenantId),
    setSetting(KEYS.numbers, JSON.stringify(numbers), tenantId),
  ]);
}

/** The name line of the invoice header ("" = left off). */
export function printedBusinessName(p: Pick<CompanyProfile, "showName" | "printName">, accountName: string): string {
  return p.showName ? p.printName.trim() || accountName : "";
}

/** Medicine invoices (contractor): the drug-sale warranty printed instead of
 * the plain note. Placeholders are filled from the business. */
export const MEDICINE_WARRANTY_TEXT =
  "Under Section 23(i) of the Drugs Act 1976, I {owner} being a person resident in Pakistan carrying on business under the name of {business}, {address}, being an authorized dealer, do hereby give this warranty that the drugs hereunder described as sold in the bill of sale invoice referred.\n“I’ll not contravene in any way the provision of Section 23 of the Drugs Act 1976.”";

export function fillWarranty(text: string, v: { owner: string; business: string; address: string }): string {
  return text.replace(/\{owner\}/g, v.owner).replace(/\{business\}/g, v.business).replace(/\{address\}/g, v.address);
}
