"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, FileText, KeyRound, LogOut, Wallet } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { changeOwnPassword, errText, portalMe, type PortalMe } from "@/lib/vendorPortalClient";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { PageTransition } from "./PageTransition";

/** The vendor sets their own password (their account may serve several hospitals). */
function PasswordModal({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = pw.length < 6;
  const differ = pw !== again;
  async function save() {
    setTried(true);
    if (short) { document.getElementById("vp-pw")?.focus(); return; }
    if (differ) { document.getElementById("vp-pw2")?.focus(); return; }
    setBusy(true);
    setError(null);
    try { await changeOwnPassword(pw); notify("Your password was changed.", "success"); onClose(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Change password" onClose={onClose} width="max-w-sm">
      <div className="flex flex-col gap-3">
        <Field label="New password" required error={tried && short ? "At least 6 characters" : undefined}>
          <Input id="vp-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={(tried && short) || undefined} autoFocus />
        </Field>
        <Field label="Type it again" required error={tried && !short && differ ? "The two do not match" : undefined}>
          <Input id="vp-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={(tried && !short && differ) || undefined} />
        </Field>
      </div>
      <FormError message={error} className="mt-3" />
      <div className="form-actions mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}>Change password</Button>
      </div>
    </Modal>
  );
}

const TABS = [
  { href: "/vendor", label: "Quote Requests", icon: ClipboardList },
  { href: "/vendor/orders", label: "Purchase Orders", icon: FileText },
  { href: "/vendor/payments", label: "Payments", icon: Wallet },
];

const MeContext = createContext<PortalMe | null>(null);
/** The signed-in vendor and their hospital (null while loading). */
export const useVendorMe = () => useContext(MeContext);

/** Chrome for a hospital vendor's login: the vendor portal's three tabs only.
 * The server refuses this login everything but /api/vendor-portal. */
export function VendorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname().replace(/\/+$/, "") || "/";
  const logout = useAuthStore((s) => s.logout);
  const [me, setMe] = useState<PortalMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  useEffect(() => {
    portalMe().then(setMe).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const active = (href: string) => (href === "/vendor" ? pathname === "/vendor" : pathname.startsWith(href));

  return (
    <MeContext.Provider value={me}>
      <div className="app-h flex flex-col bg-neutral-100">
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] bg-white/80 px-3 backdrop-blur-xl sm:px-4 print:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <Image src="/mavin-mark.png" alt="MAVIN.pk" width={256} height={256} priority className="h-8 w-8 shrink-0 object-contain" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-neutral-900">{me?.vendorName ?? "Vendor portal"}{me?.vendorNo ? <span className="ml-1.5 font-mono text-xs font-normal text-neutral-500">{me.vendorNo}</span> : null}</p>
              <p className="truncate text-[11px] text-neutral-500" title={me?.hospitals.join(", ")}>{me ? `Supplier to ${me.hospitalName}` : "Loading…"}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setPwOpen(true)} title="Change password" aria-label="Change password"
              className="flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100">
              <KeyRound size={15} aria-hidden="true" /><span className="max-sm:hidden">Password</span>
            </button>
            <button type="button" onClick={logout} className="flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100">
              <LogOut size={15} aria-hidden="true" /><span className="max-sm:hidden">Sign out</span>
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          {/* Computer: a sidebar. Phone: the tabs along the bottom. */}
          <nav aria-label="Vendor portal" className="hidden w-56 shrink-0 flex-col gap-1 border-r border-black/[0.06] bg-white p-3 md:flex print:hidden">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined}
                className={`flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-sm font-medium transition-colors ${active(t.href) ? "bg-[var(--accent)] text-white shadow-sm" : "text-neutral-700 hover:bg-neutral-100"}`}>
                <t.icon size={16} aria-hidden="true" />{t.label}
              </Link>
            ))}
          </nav>
          <main className="min-w-0 flex-1 overflow-y-auto p-3 pb-24 sm:p-5 md:pb-5">
            {error && <p role="alert" className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <nav aria-label="Vendor portal" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-black/[0.06] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-[color,transform] duration-150 active:scale-95 ${active(t.href) ? "text-[var(--accent)]" : "text-neutral-500"}`}>
              <t.icon size={19} aria-hidden="true" />{t.label}
            </Link>
          ))}
        </nav>
        {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
      </div>
    </MeContext.Provider>
  );
}
