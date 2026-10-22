"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { createUser, login, AuthError } from "@/lib/auth";
import { useAuthStore } from "@/store/authStore";

/** Shown exactly once, right after migration v9 runs on a device that
 * already has pre-multi-tenant data \u2014 that data was backfilled onto a
 * "tenant-default" / "My Pharmacy" tenant (see schema_sql_v9 in
 * src-tauri/src/lib.rs), so this screen creates real login credentials for
 * both: the Super Admin (for managing tenants/subscriptions going forward)
 * and the owner login for that existing pharmacy, so nothing is lost. */
export function SetupSuperAdmin({ onDone }: { onDone: () => void }) {
  const setSession = useAuthStore((s) => s.setSession);
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [ownerUsername, setOwnerUsername] = useState("owner");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerDisplayName, setOwnerDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (adminPassword.length < 4 || ownerPassword.length < 4) {
      setError("Passwords must be at least 4 characters.");
      return;
    }
    setSaving(true);
    try {
      await createUser({ username: adminUsername, password: adminPassword, role: "super_admin", tenantId: null });
      await createUser({
        username: ownerUsername,
        password: ownerPassword,
        role: "owner",
        tenantId: "tenant-default",
        displayName: ownerDisplayName || null,
      });
      const { user, tenant } = await login(ownerUsername, ownerPassword);
      setSession(user, tenant);
      onDone();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-8">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5">
        <div className="mb-5 text-center">
          <h1 className="font-serif text-2xl text-neutral-800">Welcome to Billora</h1>
          <p className="mt-1 text-sm text-neutral-500">
            First-time setup \u2014 create the administrator account and your pharmacy&apos;s login. Any
            existing data on this device is kept and assigned to the pharmacy account below.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="rounded-xl border border-neutral-200 p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">Super Admin account</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username" required>
                <Input value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} required />
              </Field>
              <Field label="Password" required>
                <Input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required />
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">Your pharmacy&apos;s login (My Pharmacy)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username" required>
                <Input value={ownerUsername} onChange={(e) => setOwnerUsername(e.target.value)} required />
              </Field>
              <Field label="Password" required>
                <Input type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} required />
              </Field>
              <Field label="Your Name">
                <Input value={ownerDisplayName} onChange={(e) => setOwnerDisplayName(e.target.value)} />
              </Field>
            </div>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" variant="primary" disabled={saving} className="justify-center">
            {saving ? "Setting up..." : "Create Accounts & Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
