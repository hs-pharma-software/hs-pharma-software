"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { tenantsRepo } from "@/lib/repo/tenants";
import { subscriptionPlansRepo } from "@/lib/repo/subscriptionPlans";
import { listUsersForTenant } from "@/lib/repo/users";
import { isTauri, useIsTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";

interface Figures {
  tenants: number;
  active: number;
  expiringSoon: number;
  expired: number;
  plans: number;
  accounts: number;
  inactiveAccounts: number;
  at: Date;
}

const DAY = 86_400_000;

/** Super Admin overview. Every figure counts current records (not events) and
 * says what it counts; nothing is shown as 0 before it has loaded. */
export default function AdminOverviewPage() {
  const [figures, setFigures] = useState<Figures | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!isTauri()) return;
    setError(null);
    try {
      const [tenants, plans, users] = await Promise.all([tenantsRepo.list(), subscriptionPlansRepo.list(), listUsersForTenant(null)]);
      const today = localDate();
      const soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
      const active = tenants.filter((t) => t.subscription_status === "active");
      const expiry = (t: (typeof tenants)[number]) => (t.subscription_expires_at ?? "").slice(0, 10);
      setFigures({
        tenants: tenants.length,
        active: active.length,
        expiringSoon: active.filter((t) => expiry(t) && expiry(t) >= today && expiry(t) <= soon).length,
        expired: active.filter((t) => expiry(t) && expiry(t) < today).length,
        plans: plans.length,
        accounts: users.filter((u) => u.is_active).length,
        inactiveAccounts: users.filter((u) => !u.is_active).length,
        at: new Date(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const tauriReady = useIsTauri();
  const f = figures;
  const tiles: { label: string; value: number | undefined; note: string; href: string }[] = [
    { label: "Tenants", value: f?.tenants, note: "Businesses on the platform, any status.", href: "/admin/tenants" },
    {
      label: "Active Subscriptions",
      value: f?.active,
      note: f ? `Status Active. ${f.expiringSoon} expire within 30 days; ${f.expired} past their expiry date.` : "Status Active.",
      href: "/admin/tenants",
    },
    { label: "Subscription Plans", value: f?.plans, note: "Plans that can be assigned.", href: "/admin/plans" },
    {
      label: "Login Accounts",
      value: f?.accounts,
      note: f ? `Active accounts (not sign-in events), Super Admin included. ${f.inactiveAccounts} deactivated.` : "Active accounts, not sign-in events.",
      href: "/admin/users",
    },
  ];

  return (
    <div>
      <PageHeader title="Overview" />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view this overview.
        </p>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          The figures could not be loaded: {error}{" "}
          <button type="button" className="font-medium underline" onClick={() => void load()}>Try again</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {tiles.map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] transition hover:ring-[var(--accent)]"
              >
                <p className="text-xs text-neutral-500">{t.label}</p>
                {t.value === undefined ? (
                  <p className="mt-2 h-7 w-12 animate-pulse rounded bg-neutral-100" aria-label="Loading" />
                ) : (
                  <p className="mt-1 font-serif text-2xl tabular-nums text-neutral-800">{t.value}</p>
                )}
                <p className="mt-1 text-[11px] leading-snug text-neutral-400">{t.note}</p>
              </Link>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-neutral-400">
            {f ? `As of ${f.at.toLocaleString()}. ` : ""}Current records on this device&apos;s copy of the database.{" "}
            <button type="button" className="underline" onClick={() => void load()}>Refresh</button>
          </p>
        </>
      )}
    </div>
  );
}
