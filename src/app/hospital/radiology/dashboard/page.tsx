"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, FileText, LayoutTemplate, Monitor, ScanLine, Server, Settings2, TestTube2, Users } from "lucide-react";
import { isTauri } from "@/lib/platform";
import { hasModuleAccess } from "@/lib/moduleAccess";
import { useAuthStore } from "@/store/authStore";
import { radiologyStats, type RadiologyStats } from "@/lib/repo/radiologyPortal";
import { StatTile } from "@/components/hospital/radiology/common";

const TILES = [
  { href: "/hospital/radiology", key: "hospital_radiology_orders", title: "Reception", text: "Register orders, see queues and the day's figures", icon: Users, color: "bg-sky-600" },
  { href: "/hospital/radiology/technologist", key: "hospital_radiology_tech", title: "Technologist", text: "Worklist and the examination of each patient", icon: Activity, color: "bg-emerald-600" },
  { href: "/hospital/radiology/reporting", key: "hospital_radiology_reporting", title: "Reporting", text: "Review and report examined studies", icon: FileText, color: "bg-violet-600" },
  { href: "/hospital/radiology/studies", key: "hospital_radiology", title: "Tests", text: "Radiology tests and their fees", icon: TestTube2, color: "bg-orange-500" },
  { href: "/hospital/radiology/machines", key: "hospital_radiology", title: "Machines", text: "Imaging machines, technologists and DICOM keys", icon: Monitor, color: "bg-rose-600" },
  { href: "/hospital/radiology/modalities", key: "hospital_radiology", title: "Modalities", text: "X-Ray, Ultrasound, CT and the rest", icon: Settings2, color: "bg-indigo-600" },
  { href: "/hospital/radiology/templates", key: "hospital_radiology", title: "Templates", text: "Report templates for the radiologists", icon: LayoutTemplate, color: "bg-teal-600" },
  { href: "/hospital/radiology/pacs", key: "hospital_radiology", title: "PACS / Orthanc", text: "Image server and viewer", icon: Server, color: "bg-slate-600" },
];

/** Radiology dashboard: today's figures and the portal's sections the login may open. */
export default function RadiologyDashboardPage() {
  const name = useAuthStore((s) => s.currentUser?.displayName);
  const [s, setS] = useState<RadiologyStats | null>(null);
  const [tiles, setTiles] = useState(TILES);
  useEffect(() => {
    setTiles(TILES.filter((t) => hasModuleAccess(t.key)));
    if (isTauri()) void radiologyStats().then(setS).catch(() => setS(null));
  }, []);
  const v = (n: number | undefined) => (s ? n ?? 0 : "…");

  return (
    <div>
      <div className="mb-5 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-neutral-900"><ScanLine size={22} />Radiology Dashboard</h1>
        {name && <p className="text-neutral-600">Welcome back, {name}</p>}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Today's orders" value={v(s?.todaysOrders)} />
        <StatTile label="Waiting queue" value={v(s?.waitingQueue)} tone="info" />
        <StatTile label="In progress" value={v(s?.inProgress)} tone="warn" />
        <StatTile label="To report" value={v(s?.toReport)} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="group rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500">
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-white ${t.color}`}><t.icon size={20} /></span>
              <span className="text-lg font-semibold text-neutral-900 group-hover:underline">{t.title}</span>
            </div>
            <p className="mt-3 text-sm text-neutral-500">{t.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
