"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { UserFormModal } from "./UserFormModal";
import { listUsersForTenant, usersRepo } from "@/lib/repo/users";
import { tenantsRepo } from "@/lib/repo/tenants";
import { changePassword } from "@/lib/auth";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import type { Tenant, UserAccount } from "@/lib/types2";

/** Lists login accounts. `scope: "all"` (Super Admin, at /admin/users) shows
 * every tenant's logins with a Tenant column and can create owner/staff for
 * any tenant. `scope: "own"` (a tenant owner, at /settings/logins) is
 * pre-scoped to their own tenant and can only add staff seats, capped by
 * their plan's max_staff_logins. */
export function UserLoginsPage({ scope }: { scope: "all" | "own" }) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const currentTenant = useAuthStore((s) => s.currentTenant);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [resetting, setResetting] = useState<UserAccount | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function reload() {
    if (!isTauri()) return;
    const tenantId = scope === "own" ? currentTenant?.id ?? null : null;
    const [u, t] = await Promise.all([listUsersForTenant(tenantId), scope === "all" ? tenantsRepo.list() : Promise.resolve([])]);
    setUsers(u);
    setTenants(t);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTenant?.id]);

  const tenantName = (id: string | null) =>
    id === null ? "— (Super Admin)" : tenants.find((t) => t.id === id)?.name ?? "—";

  async function toggleActive(u: UserAccount) {
    await usersRepo.update(u.id, { is_active: u.is_active ? 0 : 1 });
    void reload();
  }

  const columns: Column<UserAccount>[] = [
    { header: "Username", render: (u) => <span className="font-medium">{u.username}</span> },
    { header: "Name", render: (u) => u.display_name ?? "—" },
    { header: "Role", render: (u) => u.role },
    ...(scope === "all" ? [{ header: "Tenant", render: (u: UserAccount) => tenantName(u.tenant_id) }] : []),
    {
      header: "Status",
      render: (u) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-600"
          }`}
        >
          {u.is_active ? "Active" : "Deactivated"}
        </span>
      ),
    },
    {
      header: "Actions",
      render: (u) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setResetting(u)} className="text-amber-600 hover:underline">
            Reset Password
          </button>
          {u.id !== currentUser?.id && (
            <button type="button" onClick={() => void toggleActive(u)} className="text-rose-600 hover:underline">
              {u.is_active ? "Deactivate" : "Activate"}
            </button>
          )}
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();
  const staffCount = users.filter((u) => u.role === "staff" && u.is_active).length;
  const capReached = scope === "own" && currentTenant ? staffCount >= currentTenant.maxStaffLogins : false;

  return (
    <div>
      <PageHeader
        title={scope === "all" ? "Users" : "User Logins"}
        actions={
          <>
            <Button variant="primary" onClick={() => setModalOpen(true)} disabled={capReached}>
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {capReached && (
        <p className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your plan allows up to {currentTenant?.maxStaffLogins} staff login(s) — that limit has been reached.
        </p>
      )}

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage logins.
        </p>
      ) : (
        <DataTable columns={columns} rows={users} />
      )}

      {modalOpen && (
        <UserFormModal
          scope={scope}
          tenants={tenants}
          fixedTenantId={scope === "own" ? currentTenant?.id : undefined}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void reload();
          }}
        />
      )}

      {resetting && (
        <Modal title={`-:Reset Password — ${resetting.username}:-`} onClose={() => setResetting(null)} width="max-w-sm">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (newPassword.length < 4) return;
              await changePassword(resetting.id, newPassword);
              setResetting(null);
              setNewPassword("");
            }}
          >
            <Field label="New Password" required>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoFocus />
            </Field>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setResetting(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
