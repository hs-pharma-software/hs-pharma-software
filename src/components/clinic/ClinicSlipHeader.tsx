import type { ClinicProfile } from "@/lib/clinicProfile";

/** The clinic's name, address, contact, PHC registration and NTN at the top of a slip. */
export function ClinicSlipHeader({ profile, compact = false }: { profile: ClinicProfile; compact?: boolean }) {
  const ids = [profile.phc_reg_no && `PHC Reg No: ${profile.phc_reg_no}`, profile.ntn && `NTN: ${profile.ntn}`].filter(Boolean).join("  ·  ");
  return (
    <div className="border-b-2 border-neutral-800 pb-2 text-center">
      <p className={`font-bold leading-tight ${compact ? "text-base" : "text-xl"}`}>{profile.name || "Clinic"}</p>
      {profile.address && <p className="text-[0.85em] text-neutral-700">{profile.address}</p>}
      {profile.contact && <p className="text-[0.85em] text-neutral-700">Contact: {profile.contact}</p>}
      {ids && <p className="text-[0.8em] text-neutral-600">{ids}</p>}
    </div>
  );
}
