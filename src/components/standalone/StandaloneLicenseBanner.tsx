"use client";

/** Mavin Pharmacy Offline: the license state above every screen when it needs
 * attention (trial, expiring, expired). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { LICENSE_CHANGED, localBridge, type LicenseInfo } from "@/lib/edition";

export function StandaloneLicenseBanner() {
  const [info, setInfo] = useState<LicenseInfo & { canTransact?: boolean } | null>(null);
  useEffect(() => {
    const local = localBridge();
    if (!local) return;
    const load = () => void local.license().then((r) => { if (r.ok) setInfo(r.value); });
    load();
    const t = setInterval(load, 10 * 60_000);
    window.addEventListener(LICENSE_CHANGED, load);
    return () => { clearInterval(t); window.removeEventListener(LICENSE_CHANGED, load); };
  }, []);
  if (!info) return null;
  const blocked = info.canTransact === false;
  const soon = info.status === "active" && info.daysLeft !== null && info.daysLeft <= 14;
  if (!blocked && info.status === "active" && !soon) return null;
  return (
    <div role="status" className={`mb-3 rounded-xl border px-4 py-2 text-sm ${blocked ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
      {soon ? `The license expires in ${info.daysLeft} day(s), on ${new Date(info.expiresAt!).toDateString()}. ` : `${info.message} `}
      <Link href="/settings/" className="font-semibold underline">Settings › Mavin Pharmacy Offline</Link>
    </div>
  );
}
