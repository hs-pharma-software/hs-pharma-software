import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { NAV } from "@/config/nav";

export default function ReportsIndexPage() {
  const reports = NAV.find((n) => n.label === "Reports")?.children ?? [];
  return (
    <div>
      <PageHeader title="Reports" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="rounded-2xl bg-white px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] text-sm font-medium text-neutral-700 hover:border-amber-400 hover:text-amber-700"
          >
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

