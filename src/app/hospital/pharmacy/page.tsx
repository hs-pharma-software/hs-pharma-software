"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkedPharmacyCard } from "@/components/clinic/LinkedPharmacyCard";
import { isTauri } from "@/lib/platform";
import { getPharmacyLink, listPharmacyTenants } from "@/lib/repo/clinic";
import { listSelectedBrands } from "@/lib/repo/brandSelections";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

/** Pharmacy Department > Linked Pharmacy: the hospital pharmacy that fills the
 * doctors' prescriptions, how it is linked, and the brands chosen from it. */
export default function LinkedPharmacyPage() {
  const [info, setInfo] = useState<{ name: string | null; verifiedAt: string | null; since: string | null; brands: number } | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      const [link, all, brands] = await Promise.all([getPharmacyLink().catch(() => null), listPharmacyTenants().catch(() => []), listSelectedBrands().catch(() => [])]);
      setInfo({
        name: link ? all.find((p) => p.id === link.pharmacy_tenant_id)?.name ?? "Hospital pharmacy" : null,
        verifiedAt: link?.verified_at ?? null, since: link?.created_at ?? null, brands: brands.length,
      });
    })();
  }, []);
  return (
    <div>
      <PageHeader title="Linked Pharmacy" />
      <div className={`${card} mb-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4`}>
        <div><p className="text-xs text-neutral-500">Pharmacy</p><p className="font-semibold">{info?.name ?? (info ? "Not linked yet" : "…")}</p></div>
        <div><p className="text-xs text-neutral-500">Link</p><p className={info?.verifiedAt ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>{info?.verifiedAt ? `Verified ${info.verifiedAt.slice(0, 10)}` : info?.name ? "Waiting for the pharmacy to verify" : "—"}</p></div>
        <div><p className="text-xs text-neutral-500">Linked since</p><p>{info?.since?.slice(0, 10) ?? "—"}</p></div>
        <div><p className="text-xs text-neutral-500">Selected brands</p><p><Link href="/hospital/pharmacy/brands" className="font-semibold text-sky-700 hover:underline">{info?.brands ?? 0} generics</Link></p></div>
      </div>
      <LinkedPharmacyCard />
      <p className="mt-3 text-xs text-neutral-500">Doctors prescribe by generic name; prescriptions from the Doctor Desk, admissions and emergency go to this pharmacy with the brand chosen in Selected Brands.</p>
    </div>
  );
}
