"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { restaurant } from "@/lib/restaurant";
import { Note, RestGuard, useLoad } from "@/components/restaurant/ui";

export default function AuditPage() {
  return (
    <RestGuard>
      <Audit />
    </RestGuard>
  );
}

/** Who did what and when: price changes, discounts, voids, refunds, table
 * moves, deal/offer changes, PRA submissions, setting changes. */
function Audit() {
  const log = useLoad(() => restaurant.audits(1000));
  const [q, setQ] = useState("");
  const rows = (log.data ?? []).filter((r) => !q || `${r.action} ${r.user_name} ${r.detail}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Audit Log" actions={<Button onClick={() => void log.reload()}>Refresh</Button>} />
      <div className="mb-3 max-w-sm"><Input placeholder="Filter (e.g. refund, price, pra)…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {log.error && <Note tone="rose">{log.error}</Note>}
      <DataTable
        rows={rows}
        columns={[
          { header: "When", render: (r) => new Date(r.created_at).toLocaleString("en-PK", { dateStyle: "short", timeStyle: "medium" }) },
          { header: "Who", render: (r) => r.user_name ?? "-" },
          { header: "Action", render: (r) => <span className="font-mono text-xs">{r.action}</span> },
          { header: "Record", render: (r) => (r.record_type ? `${r.record_type}` : "-") },
          { header: "Details", render: (r) => <span className="block max-w-xl truncate text-xs text-neutral-500" title={r.detail ?? ""}>{r.detail ?? ""}</span> },
        ]}
      />
    </div>
  );
}
