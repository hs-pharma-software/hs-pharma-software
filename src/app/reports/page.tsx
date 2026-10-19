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
            className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 hover:border-amber-400 hover:text-amber-700"
          >
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
