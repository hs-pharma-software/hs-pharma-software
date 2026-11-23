/** Hospital > Pharmacy Department > Selected Brands (v98): the brand of the
 * linked hospital pharmacy chosen for each generic the doctors prescribe.
 * Doctors (Doctor Desk, admissions, emergency) see and pick the generic, e.g.
 * "Omeprazole 20mg Cap"; the prescription keeps the brand (Omesec 20mg Cap of
 * Brookes Pharma), so the print and the pharmacy's order carry the brand. */
import { createTenantRepo } from "./base";
import { currentActor } from "./medicalRecord";
import { getPharmacyLink } from "./clinic";
import { serverJson } from "../serverMode";
import type { TenantRow } from "./base";

export interface BrandSelection extends TenantRow {
  generic_label: string;
  generic_name: string | null;
  product_id: string;
  product_name: string;
  company_name: string | null;
  pharmacy_tenant_id: string | null;
  selected_by_name: string | null;
}

export const brandSelectionsRepo = createTenantRepo<BrandSelection>("hospital_brand_selections");

export interface PharmacyGeneric { generic: string; brands: number }
export interface PharmacyBrand { id: string; name: string; company: string | null; generic: string; stock: number; price: number | null }

const FORMS: [RegExp, string][] = [
  [/\b(tab|tabs|tablet|tablets)\b/i, "Tab"], [/\b(cap|caps|capsule|capsules)\b/i, "Cap"], [/\b(syp|syrup)\b/i, "Syp"],
  [/\b(susp|suspension)\b/i, "Susp"], [/\b(inj|injection|vial|amp|ampoule)\b/i, "Inj"], [/\b(drop|drops)\b/i, "Drops"],
  [/\b(cream)\b/i, "Cream"], [/\b(oint|ointment)\b/i, "Oint"], [/\b(gel)\b/i, "Gel"], [/\b(inhaler)\b/i, "Inhaler"],
  [/\b(sachet|sachets)\b/i, "Sachet"], [/\b(spray)\b/i, "Spray"], [/\b(supp|suppository)\b/i, "Supp"], [/\b(infusion|ivf)\b/i, "Infusion"],
];

/** The generic as doctors see it: the generic name with the brand's strength and form ("Omeprazole" + "Risek 20mg Cap" = "Omeprazole 20mg Cap"). */
export function genericLabelFor(generic: string, brandName: string): string {
  const strength = /(\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|iu|%|units?)(?:\s*\/\s*\d*(?:\.\d+)?\s*(?:ml|g))?)/i.exec(brandName)?.[1]?.replace(/\s+/g, "") ?? "";
  const form = FORMS.find(([re]) => re.test(brandName))?.[1] ?? "";
  return [generic.trim().replace(/\s+/g, " "), strength, form].filter(Boolean).join(" ");
}

/** The chosen brands, by generic. */
export async function listSelectedBrands(search = ""): Promise<BrandSelection[]> {
  const q = search.trim();
  return brandSelectionsRepo.list({
    ...(q ? { where: "(generic_label LIKE ? OR product_name LIKE ? OR company_name LIKE ?)", params: [`%${q}%`, `%${q}%`, `%${q}%`] } : {}),
    orderBy: "generic_label COLLATE NOCASE ASC",
  });
}

async function assertAdministrator(): Promise<string> {
  const a = await currentActor();
  if (!a.full) throw new Error("Only the hospital administrator chooses the brands.");
  return a.name;
}

/** Chooses (or changes) the brand for a generic. */
export async function selectBrand(x: { genericLabel: string; genericName?: string | null; product: { id: string; name: string; company?: string | null } }): Promise<BrandSelection> {
  const by = await assertAdministrator();
  const label = x.genericLabel.trim().replace(/\s+/g, " ");
  if (!label) throw new Error("Enter the generic name doctors will see, e.g. Omeprazole 20mg Cap.");
  if (!x.product?.id) throw new Error("Choose the brand.");
  const link = await getPharmacyLink();
  const data = {
    generic_label: label, generic_name: x.genericName?.trim() || null, product_id: x.product.id, product_name: x.product.name,
    company_name: x.product.company ?? null, pharmacy_tenant_id: link?.pharmacy_tenant_id ?? null, selected_by_name: by,
  };
  const same = (await brandSelectionsRepo.list({ where: "LOWER(generic_label) = LOWER(?)", params: [label] }))[0];
  if (same) return (await brandSelectionsRepo.update(same.id, data))!;
  return brandSelectionsRepo.create(data);
}

export async function removeSelectedBrand(id: string): Promise<void> {
  await assertAdministrator();
  await brandSelectionsRepo.remove(id);
}

/** The linked pharmacy's stocked generics (server: only names and counts leave the pharmacy). */
export async function pharmacyGenerics(term: string): Promise<PharmacyGeneric[]> {
  return (await serverJson<{ result: PharmacyGeneric[] }>("/api/hospital/pharmacy-catalogue/", { action: "generics", term })).result;
}

/** The linked pharmacy's stocked brands of one generic. */
export async function pharmacyBrands(generic: string): Promise<PharmacyBrand[]> {
  return (await serverJson<{ result: PharmacyBrand[] }>("/api/hospital/pharmacy-catalogue/", { action: "brands", generic })).result;
}
