"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, LogOut, Pencil } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { tenantsRepo } from "@/lib/repo/tenants";
import { businessType } from "@/config/businessTypes";
import { updateOwnDisplayName } from "@/lib/auth";
import { isTauri } from "@/lib/platform";
import type { Tenant } from "@/lib/types2";

const ROLE: Record<string, string> = { super_admin: "Super Admin", owner: "Owner", staff: "Staff" };
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Account window (top bar): the business's profile, read-only, and the
 * signed-in person's own name, which they can change. */
export function ProfilePanel({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const user = useAuthStore((s) => s.currentUser);
  const tenant = useAuthStore((s) => s.currentTenant);
  const [row, setRow] = useState<Tenant | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.displayName || user?.username || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (tenant?.id && isTauri()) void tenantsRepo.get(tenant.id).then(setRow).catch(() => setRow(null));
  }, [tenant?.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = await updateOwnDisplayName(name);
      setName(saved);
      setEditing(false);
      setMessage({ ok: true, text: "Name saved." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  const shownName = user?.displayName || user?.username || "";
  const initials = shownName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const status = tenant?.subscriptionStatus;
  const role = user?.platformRole === "distributor" ? "Sub Super" : ROLE[user?.role ?? ""] ?? user?.role;
  const field = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex justify-between gap-3 py-1">
        <dt className="shrink-0 text-neutral-500">{label}</dt>
        <dd className="min-w-0 break-words text-right font-medium text-neutral-800">{value}</dd>
      </div>
    ) : null;

  return (
    <div className="w-[min(20rem,calc(100vw-2rem))] text-xs" role="dialog" aria-label="Your profile">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-white">{initials}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={save} className="flex items-center gap-1.5">
              <label htmlFor="profile-name" className="sr-only">Your name</label>
              <input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={60}
                className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
              />
              <button type="submit" disabled={saving} className="rounded-md bg-[var(--accent)] px-2 py-1 font-semibold text-white disabled:opacity-60">
                {saving ? "…" : "Save"}
              </button>
              <button type="button" onClick={() => { setEditing(false); setName(shownName); setMessage(null); }} className="rounded-md px-1.5 py-1 text-neutral-500 hover:bg-neutral-100">
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-neutral-900">{shownName}</p>
              <button type="button" onClick={() => { setEditing(true); setMessage(null); }} title="Edit your name" aria-label="Edit your name"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <Pencil size={12} />
              </button>
            </div>
          )}
          <p className="mt-0.5 text-neutral-500">{user?.username} · {role}</p>
        </div>
      </div>
      {message && <p className={`mt-2 rounded-md px-2 py-1 ${message.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`} role="status">{message.text}</p>}

      {tenant ? (
        <section className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 ring-1 ring-neutral-200">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Business</p>
          <dl className="mt-1 divide-y divide-neutral-200/70">
            {field("Name", tenant.name)}
            {field("Type", businessType(tenant.businessType).label)}
            {field("Subscription", status ? (
              <span className={status === "active" ? "text-emerald-700" : "text-rose-700"}>{status[0].toUpperCase() + status.slice(1)}</span>
            ) : null)}
            {field("Valid until", day(tenant.subscriptionExpiresAt))}
            {field("Staff logins", tenant.maxStaffLogins ? String(tenant.maxStaffLogins) : null)}
            {field("Owner", row?.owner_name)}
            {field("Phone", row?.phone)}
            {field("Email", row?.email)}
            {field("Address", row?.address)}
          </dl>
          <p className="mt-1 text-[10px] text-neutral-400">Business details are kept by the administrator.</p>
        </section>
      ) : (
        <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-neutral-500 ring-1 ring-neutral-200">
          {user?.role === "super_admin" ? "Platform administrator: no business attached." : "No business attached."}
        </p>
      )}

      {user?.role === "staff" && tenant?.businessType === "hospital" && (
        <Link href="/my-appraisals" onClick={onClose}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-medium text-neutral-700 hover:bg-neutral-50">
          <ClipboardCheck size={14} /> My appraisals
        </Link>
      )}
      <button type="button" onClick={onLogout}
        className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-medium text-rose-600 hover:bg-rose-50">
        <LogOut size={14} /> Logout
      </button>
    </div>
  );
}
