"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { listSalesmanPerformance, saveSalesman, type SalesmanPerformance } from "@/lib/repo/salesmen";
import { listUsersForTenant } from "@/lib/repo/users";
import { useAuthStore } from "@/store/authStore";
import type { UserAccount } from "@/lib/types2";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** This month's net sales against the target, as a bar. */
function Progress({ value, target }: { value: number; target: number }) {
  if (!(target > 0)) return <span className="text-neutral-400">No target</span>;
  const pct = Math.max(0, (value / target) * 100);
  const tone = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="min-w-[140px]">
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="mt-0.5 text-xs tabular-nums text-neutral-600">{pct.toFixed(0)}% of {money(target)}</div>
    </div>
  );
}

export default function SalesmanPage() {
  const [rows, setRows] = useState<SalesmanPerformance[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [editing, setEditing] = useState<SalesmanPerformance | "new" | null>(null);
  const tenantId = useAuthStore((s) => s.currentTenant?.id ?? null);
  const myId = useAuthStore((s) => s.currentUser?.id ?? null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listSalesmanPerformance());
    if (tenantId) setUsers(await listUsersForTenant(tenantId).catch(() => []));
  }

  useEffect(() => {
    void reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = (id: string | null) => {
    const u = users.find((x) => x.id === id);
    return u ? (u.display_name || u.username) : null;
  };
  const totalAmount = rows.reduce((s, r) => s + r.net_sale, 0);
  const me = rows.find((r) => r.user_id && r.user_id === myId);

  const columns: Column<SalesmanPerformance>[] = [
    { header: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Phone", render: (r) => r.phone ?? "—" },
    { header: "Login", render: (r) => login(r.user_id) ?? <span className="text-neutral-400">Not linked</span> },
    { header: "This Month", render: (r) => <span className="tabular-nums">{money(r.month_sale)}</span> },
    { header: "Target Progress", render: (r) => <Progress value={r.month_sale} target={r.monthly_target} /> },
    { header: "No. of Invoices", render: (r) => r.invoice_count },
    { header: "Sale", render: (r) => money(r.sale) },
    { header: "Sale Return", render: (r) => money(r.sale_return) },
    { header: "Net Sale", render: (r) => money(r.net_sale) },
    {
      header: "",
      render: (r) => (
        <button
          type="button"
          title={`Edit ${r.name}`}
          aria-label={`Edit ${r.name}`}
          onClick={(e) => { e.stopPropagation(); setEditing(r); }}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-amber-700"
        >
          <Pencil size={15} />
        </button>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Salesman Record"
        actions={
          <>
            <Button variant="primary" onClick={() => setEditing("new")}>Add Salesman</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {me && (
        <div className="mb-4 rounded-2xl bg-white px-5 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Your progress this month</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <p className="text-2xl font-bold tabular-nums text-neutral-900">Rs {money(me.month_sale)}</p>
            <Progress value={me.month_sale} target={me.monthly_target} />
          </div>
        </div>
      )}

      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} onRowClick={(r) => setEditing(r)} emptyMessage="No salesmen yet. Add one to put invoices on them." />
          <div className="mt-3 flex justify-end rounded-2xl bg-white px-5 py-2.5 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
            <span className="font-medium text-neutral-700">Total Amount: {money(totalAmount)}</span>
          </div>
        </>
      )}

      {editing && (
        <SalesmanForm
          salesman={editing === "new" ? null : editing}
          users={users}
          linkedIds={new Set(rows.filter((r) => r.user_id && (editing === "new" || r.id !== editing.id)).map((r) => r.user_id!))}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}
    </div>
  );
}

function SalesmanForm({ salesman: s, users, linkedIds, onClose, onSaved }: {
  salesman: SalesmanPerformance | null;
  users: UserAccount[];
  linkedIds: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(s?.name ?? "");
  const [phone, setPhone] = useState(s?.phone ?? "");
  const [userId, setUserId] = useState(s?.user_id ?? "");
  const [target, setTarget] = useState(s?.monthly_target ? String(s.monthly_target) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = users.filter((u) => u.is_active && !linkedIds.has(u.id));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveSalesman(s?.id ?? null, { name, phone, userId: userId || null, monthlyTarget: target === "" ? 0 : Number(target) });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={s ? `Edit ${s.name}` : "Add Salesman"} onClose={onClose} width="max-w-lg">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><Field label="Name" required><Input id="sm-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field></div>
        <Field label="Phone"><Input id="sm-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" /></Field>
        <Field label="Monthly target (Rs)"><Input id="sm-target" type="number" min="0" step="any" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0 = no target" /></Field>
        <div className="md:col-span-2">
          <Field label="Login (user)">
            <Select id="sm-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">— Not linked —</option>
              {choices.map((u) => <option key={u.id} value={u.id}>{u.display_name ? `${u.display_name} (${u.username})` : u.username}</option>)}
            </Select>
          </Field>
          <p className="mt-1 text-xs text-neutral-500">Invoices this login creates are put on this salesman, so his sales and progress count automatically.</p>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </Modal>
  );
}
