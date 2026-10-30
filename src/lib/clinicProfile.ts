/** The clinic's own details, printed at the top of its slips (Settings >
 * Clinic Profile). Kept in the clinic's settings. */
import { getSetting, setSetting } from "./repo/settings";
import { useAuthStore } from "../store/authStore";

export const CLINIC_PROFILE_KEY = "clinic.profile";

export interface ClinicProfile {
  name: string;
  address: string;
  contact: string;
  phc_reg_no: string;
  ntn: string;
}

export const EMPTY_CLINIC_PROFILE: ClinicProfile = { name: "", address: "", contact: "", phc_reg_no: "", ntn: "" };

/** The saved profile; the clinic's account name until a name is saved. */
export async function loadClinicProfile(): Promise<ClinicProfile> {
  const fallback = { ...EMPTY_CLINIC_PROFILE, name: useAuthStore.getState().currentTenant?.name ?? "" };
  const raw = await getSetting(CLINIC_PROFILE_KEY);
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw) as Partial<ClinicProfile>;
    return { ...fallback, ...saved, name: saved.name?.trim() || fallback.name };
  } catch {
    return fallback;
  }
}

export async function saveClinicProfile(p: ClinicProfile): Promise<ClinicProfile> {
  const clean: ClinicProfile = {
    name: p.name.trim(), address: p.address.trim(), contact: p.contact.trim(), phc_reg_no: p.phc_reg_no.trim(), ntn: p.ntn.trim(),
  };
  if (!clean.name) throw new Error("Enter the clinic name.");
  await setSetting(CLINIC_PROFILE_KEY, JSON.stringify(clean));
  return clean;
}
