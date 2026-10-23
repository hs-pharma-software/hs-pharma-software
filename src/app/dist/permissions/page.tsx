"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { dist, errorText } from "@/lib/dist";
import { CUSTOMER_FIELDS, DIST_PERMS, SALESMAN_PRESET } from "@/lib/dist/engine";
import { DistGuard, Err, Note, PageTitle, useLoad } from "@/components/dist/ui";

const GROUPS: { title: string; prefix: string }[] = [
  { title: "Customers", prefix: "customers." },
  { title: "Catalog & companies", prefix: "catalog." },
  { title: "Bookings", prefix: "bookings." },
  { title: "Invoices (each field separately)", prefix: "invoices." },
  { title: "Purchases (each field separately)", prefix: "purchases." },
  { title: "Other", prefix: "" },
];
const LABEL: Record<string, string> = {
  "customers.view": "View customers", "customers.add": "Add customers", "customers.edit": "Edit permitted customer fields", "customers.verify": "Record ATL / CDSL verification",
  "catalog.view": "View product catalogs", "catalog.manage": "Manage products & categories", "companies.manage": "Manage companies",
  "bookings.create": "Create bookings", "bookings.submit": "Submit bookings", "bookings.approve": "Approve / reject bookings", "bookings.view_all": "See all salesmen's bookings & customers",
  "invoices.view": "View invoices", "invoices.create": "Create invoices", "invoices.edit_lines": "Change lines when converting a booking", "invoices.edit_qty": "Change quantities", "invoices.edit_price": "Change product prices",
  "invoices.discount": "Apply discounts", "invoices.edit_description": "Invoice description", "invoices.edit_tax_base": "Change taxable base", "invoices.edit_wht_rate": "Change withholding rate",
  "invoices.edit_wht_amount": "Change withholding amount", "invoices.edit_customer": "Change customer on a transaction", "invoices.return": "Sales returns / credit notes",
  "purchases.view": "View purchases (and costs)", "purchases.create": "Create purchases", "purchases.edit_qty": "Purchase quantities", "purchases.edit_price": "Purchase prices (vs. product cost)",
  "purchases.discount": "Purchase discounts", "purchases.edit_tax": "Purchase tax fields", "purchases.return": "Purchase returns",
  "payments.receive": "Receive / make payments", "reports.view": "View reports", "locations.view": "View salesman locations", "targets.view": "View salesmen targets", "salesmen.view": "View salesmen",
};

export default function PermissionsPage() {
  return <DistGuard>{(c) => (c.admin ? <Permissions /> : <Note tone="amber">Only the distributor administrator manages permissions.</Note>)}</DistGuard>;
}

function Permissions() {
  const users = useLoad(() => dist.listUsers(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const staff = (users.data ?? []).filter((u) => u.role === "staff");

  useEffect(() => {
    if (!userId) return;
    void dist.getPerms(userId).then((p) => {
      setPerms(new Set(p.perms));
      setFields(new Set(p.fields));
    });
  }, [userId]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setter(n);
  };
  const grouped = (prefix: string) => DIST_PERMS.filter((p) => (prefix ? p.startsWith(prefix) || (prefix === "catalog." && p === "companies.manage") : !GROUPS.some((g) => g.prefix && (p.startsWith(g.prefix) || p === "companies.manage"))));

  return (
    <div className="space-y-4">
      <PageTitle title="User Permissions" sub="Sub-users get nothing until you grant it. Deleting customers, settings, targets and permissions stay with you." />
      <Note>
        Create logins under Settings → User Logins (give them the distributor sections they need, e.g. Field Panel and Bookings for salesmen). Then choose each action here. These rules are checked
        by the data layer on every request, not only by hiding buttons.
      </Note>
      <Err error={users.error} />
      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <ul className="divide-y divide-neutral-100 rounded-xl bg-white text-sm ring-1 ring-black/5">
          {staff.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => setUserId(u.id)} className={`w-full px-3 py-2 text-start ${userId === u.id ? "bg-amber-50 font-semibold" : "hover:bg-neutral-50"}`}>
                {u.display_name || u.username}
                <span className="block text-[11px] text-neutral-400">{u.username}</span>
              </button>
            </li>
          ))}
          {!staff.length && <li className="px-3 py-4 text-neutral-400">No sub-user logins yet.</li>}
        </ul>
        {userId ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPerms(new Set(SALESMAN_PRESET))}>Salesman preset</Button>
              <Button onClick={() => setPerms(new Set())}>Clear all</Button>
            </div>
            {GROUPS.map((g) => (
              <fieldset key={g.title} className="rounded-xl bg-white p-3 ring-1 ring-black/5">
                <legend className="px-1 text-xs font-semibold text-neutral-600">{g.title}</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {grouped(g.prefix).map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={perms.has(p)} onChange={() => toggle(perms, setPerms, p)} /> {LABEL[p] ?? p}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <fieldset className="rounded-xl bg-white p-3 ring-1 ring-black/5">
              <legend className="px-1 text-xs font-semibold text-neutral-600">Customer fields this user may edit (with &quot;Edit permitted customer fields&quot;)</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {CUSTOMER_FIELDS.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={fields.has(f)} onChange={() => toggle(fields, setFields, f)} /> {f.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </fieldset>
            {msg && (msg.ok ? <Note tone="emerald">{msg.text}</Note> : <Err error={msg.text} />)}
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await dist.setPerms(userId, [...perms], [...fields]);
                  setMsg({ ok: true, text: "Saved (audited). The user gets the new permissions on their next action." });
                } catch (e) {
                  setMsg({ ok: false, text: errorText(e) });
                }
              }}
            >
              Save permissions
            </Button>
          </div>
        ) : (
          <Note>Select a user.</Note>
        )}
      </div>
    </div>
  );
}
