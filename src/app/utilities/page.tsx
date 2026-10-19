import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { NAV } from "@/config/nav";

export default function UtilitiesIndexPage() {
  const utilities = NAV.find((n) => n.label === "Utilities")?.children ?? [];
  return (
    <div>
      <PageHeader title="Utilities" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {utilities.map((u) => (
          <Link
            key={u.href}
            href={u.href}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-700 hover:border-amber-400 hover:text-amber-700"
          >
            {u.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
