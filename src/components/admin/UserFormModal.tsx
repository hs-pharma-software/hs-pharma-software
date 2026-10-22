"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { createUser, AuthError } from "@/lib/auth";
import { NAV } from "@/config/nav";
import type { Tenant, UserRole } from "@/lib/types2";

/** Creates a new login. Two modes:
 * - Super Admin (`scope: "all"`): picks any tenant and role (owner/staff).
 * - Tenant owner (`scope: "own"`): tenant and role are fixed (their own
 *   tenant, role "staff") \u2014 they can only add staff seats for themselves,
 *   capped by their plan's max_staff_logins (enforced in `createUser`). */
export function UserFormModal({
  scope,
  tenants,
  fixedTenantId,
  onClose,
  onSaved,
}: {
  scope: "all" | "own";
  tenants: Tenant[];
  fixedTenantId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [tenantId, setTenantId] = useState(fixedTenantId ?? tenants[0]?.id ?? "");
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const effectiveRole = scope === "own" ? "staff" : role;
  const showPermissions = effectiveRole === "staff";

  function toggleModule(key: string) {
    if (permissions === null) {
      setPermissions(NAV.map((n) => n.moduleKey).filter((k) => k !== key));
    } else if (permissions.includes(key)) {
      setPermissions(permissions.filter((k) => k !== key));
    } else {
      const updated = [...permissions, key];
      if (updated.length === NAV.length) setPermissions(null);
      else setPermissions(updated);
    }
  }

  function isChecked(key: string) {
    return permissions === null || permissions.includes(key);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || password.length < 4) {
      setError("Enter a username and a password of at least 4 characters.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await createUser({
        username,
        password,
        role: effectiveRole,
        tenantId: scope === "own" ? (fixedTenantId ?? null) : tenantId || null,
        displayName: displayName || null,
        permissions: showPermissions ? permissions : null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Login" onClose={onClose} width="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label="Username" required>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Display Name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        {scope === "all" && (
          <>
            <Field label="Tenant" required>
              <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)} required>
                <option value="">Select...</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role" required>
              <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} required>
                <option value="owner">Owner</option>
                <option value="staff">Staff</option>
              </Select>
            </Field>
          </>
        )}

        {showPermissions && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Module Access
              </span>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => setPermissions(null)} className="text-amber-600 hover:underline">
                  Allow All
                </button>
                <span className="text-neutral-300">|</span>
                <button type="button" onClick={() => setPermissions([])} className="text-rose-600 hover:underline">
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
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
          <Button type="button" onClick={onClose}>
            Reset
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
