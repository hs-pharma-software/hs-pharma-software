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
import { changePassword, updateUserPermissions } from "@/lib/auth";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { NAV } from "@/config/nav";
import { ACTION_PERMISSIONS, parseDeniedActions } from "@/lib/actionPermissions";
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
  const [editingPerms, setEditingPerms] = useState<UserAccount | null>(null);
  const [permsState, setPermsState] = useState<string[] | null>(null);
  const [deniedState, setDeniedState] = useState<string[]>([]);
  const [permsSaving, setPermsSaving] = useState(false);

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
    id === null ? "\u2014 (Super Admin)" : tenants.find((t) => t.id === id)?.name ?? "\u2014";

  async function toggleActive(u: UserAccount) {
    await usersRepo.update(u.id, { is_active: u.is_active ? 0 : 1 });
    void reload();
  }

  function openPermissions(u: UserAccount) {
    let parsed: string[] | null = null;
    if (u.permissions != null) {
      try { parsed = JSON.parse(u.permissions) as string[]; } catch { parsed = null; }
    }
    setPermsState(parsed);
    setDeniedState(parseDeniedActions(u.denied_actions));
    setEditingPerms(u);
  }

  function toggleAction(key: string) {
    setDeniedState((d) => (d.includes(key) ? d.filter((k) => k !== key) : [...d, key]));
  }

  function toggleModule(key: string) {
    if (permsState === null) {
      setPermsState(NAV.map((n) => n.moduleKey).filter((k) => k !== key));
    } else if (permsState.includes(key)) {
      setPermsState(permsState.filter((k) => k !== key));
    } else {
      const updated = [...permsState, key];
      if (updated.length === NAV.length) setPermsState(null);
      else setPermsState(updated);
    }
  }

  function isChecked(key: string) {
    return permsState === null || permsState.includes(key);
  }

  async function savePermissions() {
    if (!editingPerms) return;
    setPermsSaving(true);
    try {
      await updateUserPermissions(editingPerms.id, permsState, deniedState);
      setEditingPerms(null);
      void reload();
    } finally {
      setPermsSaving(false);
    }
  }

  const columns: Column<UserAccount>[] = [
    { header: "Username", render: (u) => <span className="font-medium">{u.username}</span> },
    { header: "Name", render: (u) => u.display_name ?? "\u2014" },
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
          {u.role === "staff" && (
            <button type="button" onClick={() => openPermissions(u)} className="text-blue-600 hover:underline">
              Permissions
            </button>
          )}
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
          Your plan allows up to {currentTenant?.maxStaffLogins} staff login(s) {"\u2014"} that limit has been reached.
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
        <Modal title={`Reset Password \u2014 ${resetting.username}`} onClose={() => setResetting(null)} width="max-w-sm">
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

      {editingPerms && (
        <Modal
          title={`Permissions \u2014 ${editingPerms.username}`}
          onClose={() => setEditingPerms(null)}
          width="max-w-lg"
        >
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Module Access
                </span>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setPermsState(null)} className="text-amber-600 hover:underline">
                    Allow All
                  </button>
                  <span className="text-neutral-300">|</span>
                  <button type="button" onClick={() => setPermsState([])} className="text-rose-600 hover:underline">
                    Block All
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {NAV.map((item) => (
                  <label key={item.moduleKey} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 hover:bg-white">
                    <input
                      type="checkbox"
                      checked={isChecked(item.moduleKey)}
                      onChange={() => toggleModule(item.moduleKey)}
                      className="accent-amber-500"
                    />
                    <span className="text-xs text-neutral-700">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Actions</span>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setDeniedState([])} className="text-amber-600 hover:underline">
                    Allow All
                  </button>
                  <span className="text-neutral-300">|</span>
                  <button
                    type="button"
                    onClick={() => setDeniedState(ACTION_PERMISSIONS.map((a) => a.key))}
                    className="text-rose-600 hover:underline"
                  >
                    Block All
                  </button>
                </div>
              </div>
              {(["Invoices", "Purchases"] as const).map((group) => (
                <div key={group} className="mb-1.5 last:mb-0">
                  <p className="mb-1 text-[11px] font-medium text-neutral-500">{group}</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {ACTION_PERMISSIONS.filter((a) => a.group === group).map((a) => (
                      <label key={a.key} className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 hover:bg-white">
                        <input
                          type="checkbox"
                          checked={!deniedState.includes(a.key)}
                          onChange={() => toggleAction(a.key)}
                          className="accent-amber-500"
                        />
                        <span className="text-xs text-neutral-700">{a.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <p className="mt-2 text-[11px] text-neutral-400">
                Unticked actions are hidden for this login. Changes apply on their next screen change.
              </p>
            </div>
            <p className="text-xs text-neutral-400">
              {permsState === null
                ? "Full access \u2014 all modules are allowed."
                : permsState.length === 0
                ? "No access \u2014 all modules are blocked."
                : `${permsState.length} of ${NAV.length} modules allowed.`}
              {deniedState.length > 0 && ` ${deniedState.length} action(s) restricted.`}
            </p>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setEditingPerms(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void savePermissions()} disabled={permsSaving}>
                {permsSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
