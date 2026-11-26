"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Hospital, Users, Activity, Bed, AlertCircle, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { CountUp } from "@/components/ui/CountUp";
import { BreakdownWheel, FlowChart, TrendBars } from "@/components/ui/charts";
import { isTauri } from "@/lib/platform";
import { getHospitalStats, listEpisodes, type HospitalStats, type EpisodeListRow } from "@/lib/repo/hospital";
import { getHospitalBreakdown, type HospitalBreakdown } from "@/lib/repo/dashboardCharts";
import { localDate } from "@/lib/localDate";
import { CloseDayModal } from "@/components/hospital/finance/CloseDay";

const TYPE_LABEL: Record<string, string> = { opd: "OPD", ipd: "IPD", emergency: "Emergency" };
const TYPE_COLOR: Record<string, string> = {
  opd: "bg-blue-100 text-blue-700",
  ipd: "bg-purple-100 text-purple-700",
  emergency: "bg-red-100 text-red-700",
};
const cap = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;
const dayLabel = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-PK", { weekday: "short" });

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rise-in rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5 ${className}`}>
      <h2 className="mb-4 text-sm font-semibold text-neutral-800">{title}</h2>
      {children}
    </section>
  );
}

export default function HospitalDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<HospitalStats | null>(null);
  const [todayEpisodes, setTodayEpisodes] = useState<EpisodeListRow[]>([]);
  const [breakdown, setBreakdown] = useState<HospitalBreakdown | null>(null);
  const [closingDay, setClosingDay] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const today = localDate();
    void getHospitalStats().then(setStats).catch((e) => console.error("Hospital dashboard: stats failed", e));
    void listEpisodes({ date: today, status: "open", limit: 20 }).then(setTodayEpisodes).catch(() => undefined);
    void getHospitalBreakdown(today).then(setBreakdown).catch((e) => console.error("Hospital dashboard: charts failed", e));
  }, []);

  const tiles = [
    { label: "Total Patients", value: stats?.totalPatients, icon: Users, color: "#2a78d6" },
    { label: "OPD Today", value: stats?.openOpdToday, icon: Hospital, color: "#6250d6" },
    { label: "Inpatients (IPD)", value: stats?.openIpd, icon: Bed, color: "#8b5cf6" },
    { label: "Emergency Open", value: stats?.openEmergency, icon: AlertCircle, color: "#e34948" },
    { label: "Today's Revenue", value: stats?.todayRevenue, icon: TrendingUp, color: "#008300", money: true },
  ];
  const flow = breakdown?.opdFlow;

  return (
    <div className="space-y-4 pb-6">
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
            <Button onClick={() => setClosingDay(true)}>Close day</Button>
          </>
        }
      />

      {closingDay && <CloseDayModal onClose={() => setClosingDay(false)} />}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(({ label, value, icon: Icon, color, money }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2 }}
            transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 28 }}
            className={`rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] transition-shadow hover:shadow-[0_6px_18px_rgba(0,0,0,0.08)] ${i === tiles.length - 1 ? "col-span-2 md:col-span-1" : ""}`}
          >
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${color}14`, color }}>
              <Icon size={18} />
            </span>
            <div className="text-2xl font-bold text-neutral-800 tabular-nums">
              {value === undefined ? "—" : <CountUp value={value} format={money ? rs : undefined} />}
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">{label}</div>
          </motion.div>
        ))}
      </div>

      {/* Today's OPD, step by step */}
      <Panel title="Today's OPD flow">
        <FlowChart
          steps={[
            { label: "Tokens issued", value: flow?.tokens ?? 0, hint: "Registered at reception" },
            { label: "Called in", value: flow?.called ?? 0, hint: "With or past the doctor" },
            { label: "Seen", value: flow?.seen ?? 0, hint: "Consultation finished" },
            { label: "Admitted", value: flow?.admitted ?? 0, hint: "Moved to IPD from a visit" },
          ]}
        />
      </Panel>

      {/* Breakdown wheels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Today's visits by type">
          <BreakdownWheel
            centerLabel="Visits"
            empty="No visits today"
            data={(breakdown?.byType ?? []).map((r) => ({ label: TYPE_LABEL[r.key] ?? cap(r.key), value: r.n }))}
          />
        </Panel>
        <Panel title="Today's visits by department">
          <BreakdownWheel
            centerLabel="Visits"
            empty="No visits today"
            data={(breakdown?.byDepartment ?? []).map((r) => ({ label: r.key, value: r.n }))}
          />
        </Panel>
        <Panel title="Money received today">
          <BreakdownWheel
            centerLabel="Received"
            empty="Nothing received today"
            format={rs}
            data={(breakdown?.byMethod ?? []).map((r) => ({ label: cap(r.key), value: r.n }))}
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Money received, last 7 days">
          <TrendBars format={rs} points={(breakdown?.revenueTrend ?? []).map((d) => ({ label: dayLabel(d.date), value: d.value }))} />
        </Panel>

        {/* Today's open episodes */}
        <section className="rise-in rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-neutral-800">Today&apos;s Open Episodes</h2>
            <Button variant="ghost" onClick={() => router.push("/hospital/episodes")}>
              <Activity size={14} className="mr-1" />
              All Episodes
            </Button>
          </div>

          {todayEpisodes.length === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-400">No open episodes today.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                    <th className="pb-2 pr-4 font-medium">Episode No</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Patient</th>
                    <th className="pb-2 pr-4 font-medium">MR No</th>
                    <th className="pb-2 pr-4 font-medium">Department</th>
                    <th className="pb-2 pr-4 text-right font-medium">Charges</th>
                    <th className="pb-2 pr-4 text-right font-medium">Paid</th>
                    <th className="pb-2 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {todayEpisodes.map((ep, i) => (
                    <tr
                      key={ep.id}
                      className="row-in row-clickable cursor-pointer border-b border-neutral-50"
                      style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                      onClick={() => router.push(`/hospital/episodes/view?id=${ep.id}`)}
                    >
                      <td className="py-2 pr-4 font-mono text-xs">{ep.episode_no}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLOR[ep.type] ?? ""}`}>
                          {TYPE_LABEL[ep.type] ?? ep.type}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-medium">{ep.patient_name}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-neutral-400">{ep.mr_no}</td>
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
        </section>
      </div>
    </div>
  );
}
