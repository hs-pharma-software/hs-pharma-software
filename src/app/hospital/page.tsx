"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hospital, Users, Activity, Bed, AlertCircle, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/platform";
import { getHospitalStats, listEpisodes, type HospitalStats, type EpisodeListRow } from "@/lib/repo/hospital";
import { localDate } from "@/lib/localDate";

export default function HospitalDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<HospitalStats | null>(null);
  const [todayEpisodes, setTodayEpisodes] = useState<EpisodeListRow[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    const today = localDate();
    void getHospitalStats().then(setStats);
    void listEpisodes({ date: today, status: "open", limit: 20 }).then(setTodayEpisodes);
  }, []);

  const TYPE_LABEL: Record<string, string> = { opd: "OPD", ipd: "IPD", emergency: "Emergency" };
  const TYPE_COLOR: Record<string, string> = {
    opd: "bg-blue-100 text-blue-700",
    ipd: "bg-purple-100 text-purple-700",
    emergency: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <PageHeader
        title="Hospital Dashboard"
        actions={
          <>
            <Button variant="primary" onClick={() => router.push("/hospital/patients")}>
              Register Patient
            </Button>
            <Button onClick={() => router.push("/hospital/episodes")}>
              New Episode
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: "Total Patients", value: stats?.totalPatients ?? "—", icon: Users, color: "text-blue-600" },
          { label: "OPD Today", value: stats?.openOpdToday ?? "—", icon: Hospital, color: "text-indigo-600" },
          { label: "Inpatients (IPD)", value: stats?.openIpd ?? "—", icon: Bed, color: "text-purple-600" },
          { label: "Emergency Open", value: stats?.openEmergency ?? "—", icon: AlertCircle, color: "text-red-600" },
          { label: "Today's Revenue", value: stats ? `Rs ${stats.todayRevenue.toLocaleString()}` : "—", icon: TrendingUp, color: "text-emerald-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-4">
            <div className={`mb-2 ${color}`}>
              <Icon size={20} />
            </div>
            <div className="text-2xl font-bold text-neutral-800">{value}</div>
            <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Today's open episodes */}
      <div className="rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm text-neutral-700">Today&apos;s Open Episodes</h2>
          <Button variant="ghost" onClick={() => router.push("/hospital/episodes")}>
            <Activity size={14} className="mr-1" />
            All Episodes
          </Button>
        </div>

        {todayEpisodes.length === 0 ? (
          <p className="text-sm text-neutral-400 py-4 text-center">No open episodes today.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-neutral-500 text-left text-xs">
                  <th className="pb-2 pr-4 font-medium">Episode No</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Patient</th>
                  <th className="pb-2 pr-4 font-medium">MR No</th>
                  <th className="pb-2 pr-4 font-medium">Department</th>
                  <th className="pb-2 pr-4 font-medium text-right">Charges</th>
                  <th className="pb-2 pr-4 font-medium text-right">Paid</th>
                  <th className="pb-2 font-medium text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {todayEpisodes.map((ep) => (
                  <tr
                    key={ep.id}
                    className="border-b border-neutral-50 hover:bg-neutral-50 cursor-pointer"
                    onClick={() => router.push(`/hospital/episodes/view?id=${ep.id}`)}
                  >
                    <td className="py-2 pr-4 font-mono text-xs">{ep.episode_no}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLOR[ep.type] ?? ""}`}>
                        {TYPE_LABEL[ep.type] ?? ep.type}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-medium">{ep.patient_name}</td>
                    <td className="py-2 pr-4 text-neutral-400 font-mono text-xs">{ep.mr_no}</td>
                    <td className="py-2 pr-4 text-neutral-500">{ep.department ?? "—"}</td>
                    <td className="py-2 pr-4 text-right">{ep.total_charges.toFixed(0)}</td>
                    <td className="py-2 pr-4 text-right text-emerald-600">{ep.total_paid.toFixed(0)}</td>
                    <td className="py-2 text-right font-medium">
                      {(ep.total_charges - ep.total_paid).toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
