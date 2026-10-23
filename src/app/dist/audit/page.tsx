"use client";

import { dist } from "@/lib/dist";
import { DistGuard, Err, Note, PageTitle, downloadCsv, useLoad } from "@/components/dist/ui";
import { Button } from "@/components/ui/Button";

export default function AuditPage() {
  return <DistGuard>{(c) => (c.admin ? <Audit /> : <Note tone="amber">Only the distributor administrator can read the audit log.</Note>)}</DistGuard>;
}

function Audit() {
  const rows = useLoad(() => dist.audits(1000), []);
  return (
    <div className="space-y-3">
      <PageTitle title="Audit Log" sub="Customer, permission, price, tax, invoice, purchase, location and deletion actions." actions={<Button onClick={() => downloadCsv("dist-audit.csv", rows.data ?? [])}>Export CSV</Button>} />
      <Err error={rows.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr>
              <th className="px-2 py-2 text-start">When</th>
              <th className="px-2 py-2 text-start">User</th>
              <th className="px-2 py-2 text-start">Action</th>
              <th className="px-2 py-2 text-start">Record</th>
              <th className="px-2 py-2 text-start">Field</th>
              <th className="px-2 py-2 text-start">Old</th>
              <th className="px-2 py-2 text-start">New</th>
              <th className="px-2 py-2 text-start">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((a) => (
              <tr key={a.id} className="border-t border-neutral-100 align-top">
                <td className="whitespace-nowrap px-2 py-1">{a.created_at.slice(0, 19).replace("T", " ")}</td>
                <td className="px-2 py-1">{a.user_name}</td>
                <td className="px-2 py-1 font-medium">{a.action}</td>
                <td className="px-2 py-1">{a.record_type}</td>
                <td className="px-2 py-1">{a.field}</td>
                <td className="max-w-56 truncate px-2 py-1" title={a.old_value ?? ""}>{a.old_value}</td>
                <td className="max-w-56 truncate px-2 py-1" title={a.new_value ?? a.detail ?? ""}>{a.new_value ?? a.detail}</td>
                <td className="px-2 py-1">{a.reason}</td>
              </tr>
            ))}
            {!rows.data?.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{rows.loading ? "Loading…" : "No content in table"}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
