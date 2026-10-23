"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { NAV } from "@/config/nav";
import { useAuthStore } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { businessType, moduleAllowedForType } from "@/config/businessTypes";
import { translate, useLang } from "@/lib/i18n";

/** Strips trailing slashes so routes compare consistently regardless of
 * Next's `trailingSlash: true` static-export setting. */
function normalize(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/** Several nav children share a path prefix with their own parent's `href`
 * (e.g. Invoices' parent link is "/invoices", and so is its first child,
 * "Invoices Details") \u2014 a naive `pathname.startsWith(href)` check would then
 * light up both "/invoices" and "/invoices/returns" at once. Instead, match
 * every href in the whole nav tree and keep only the longest (most specific)
 * one, so exactly one entry is ever active. */
function findActiveHref(pathname: string): string | null {
  const allHrefs: string[] = [];
  NAV.forEach((item) => {
    allHrefs.push(item.href);
    item.children?.forEach((c) => allHrefs.push(c.href));
  });
  const norm = normalize(pathname);
  const matches = allHrefs.filter((href) => {
    const h = normalize(href);
    return norm === h || norm.startsWith(`${h}/`);
  });
  if (matches.length === 0) return null;
  return matches.reduce((longest, candidate) => (candidate.length > longest.length ? candidate : longest));
}

export function Sidebar() {
  const pathname = usePathname();
  const allowedModules = useAuthStore((s) => s.currentTenant?.allowedModules ?? null);
  const userPermissions = useAuthStore((s) => s.currentUser?.permissions ?? null);
  const typeId = useAuthStore((s) => businessType(s.currentTenant?.businessType).id);
  const lang = useLang((s) => s.lang);
  const sidebarMobileOpen = useAppStore((s) => s.sidebarMobileOpen);
  const setSidebarMobileOpen = useAppStore((s) => s.setSidebarMobileOpen);
  const label = (x: { label: string; labelKey?: string }) => (x.labelKey ? translate(x.labelKey, lang) : x.label);
  const visibleNav = NAV.filter((item) => {
    // Business-type sections (e.g. Restaurant) follow the tenant type, not the plan.
    if (item.onlyFor) {
      if (!item.onlyFor.includes(typeId)) return false;
    } else {
      // Shared sections a business type never uses (the pharmacy catalog for
      // restaurants) stay hidden whatever the plan lists.
      if (!moduleAllowedForType(typeId, item.moduleKey)) return false;
      if (allowedModules && allowedModules.length > 0 && !allowedModules.includes(item.moduleKey)) return false;
    }
    if (userPermissions !== null && !userPermissions.includes(item.moduleKey)) return false;
    return true;
  });
  const activeHref = findActiveHref(pathname);
  const activeTop = visibleNav.find(
    (item) => item.href === activeHref || item.children?.some((c) => c.href === activeHref)
  );
  const [openLabel, setOpenLabel] = useState<string | null>(activeTop?.label ?? null);

  return (
    <aside
      className={[
        // Mobile: fixed drawer sliding in from left, sits above overlay (z-40)
        "fixed top-12 bottom-0 left-0 z-40 flex w-72 flex-col overflow-y-auto text-sm text-neutral-200",
        "transition-transform duration-300 ease-in-out",
        sidebarMobileOpen ? "translate-x-0" : "-translate-x-full",
        // Desktop: inline in the flex layout, always visible
        "md:static md:top-auto md:bottom-auto md:z-auto md:h-full md:w-64 md:shrink-0",
        "md:translate-x-0 md:transition-none",
      ].join(" ")}
      style={{ background: "linear-gradient(to bottom, var(--sidebar-from), var(--sidebar-to))" }}
    >
      {/* Mobile close button */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 md:hidden">
        <span className="text-xs font-semibold uppercase tracking-widest text-white/60">Navigation</span>
        <button
          type="button"
          onClick={() => setSidebarMobileOpen(false)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10"
        >
          <X size={15} />
        </button>
      </div>
      <nav className="flex-1 py-1">
        {visibleNav.map((item) => {
          const isOpen = openLabel === item.label;
          const isActive =
            item.href === activeHref || item.children?.some((c) => c.href === activeHref);
          const Icon = item.icon;

          return (
            <div key={item.label} className="border-b border-white/5">
              {item.children ? (
                <button
                  type="button"
                  onClick={() => setOpenLabel(isOpen ? null : item.label)}
                  className="relative flex w-full items-center gap-3 px-4 py-2.5 text-start font-medium text-neutral-200 transition-colors hover:bg-white/[0.06]"
                >
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active-bar"
                      className="absolute inset-y-1 start-0 w-[3px] rounded-e-full"
                      style={{ background: "var(--accent)" }}
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <Icon size={17} className="shrink-0" style={isActive ? { color: "var(--accent)" } : {}} />
                  <span className="flex-1" style={isActive ? { color: "var(--accent)" } : {}}>{label(item)}</span>
                  <motion.span
                    animate={{ rotate: isOpen ? 90 : 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    className="shrink-0 rtl:-scale-x-100"
                  >
                    <ChevronRight size={15} />
                  </motion.span>
                </button>
              ) : (
                <Link
                  href={item.href}
                  className={`relative flex items-center gap-3 px-4 py-2.5 font-medium transition-colors hover:bg-white/[0.06] ${
                    isActive ? "text-amber-400" : "text-neutral-200"
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active-bar"
                      className="absolute inset-y-1 start-0 w-[3px] rounded-e-full"
                      style={{ background: "var(--accent)" }}
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <Icon size={17} className="shrink-0" />
                  <span>{label(item)}</span>
                </Link>
              )}

              <AnimatePresence initial={false}>
                {item.children && isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden bg-black/30"
                  >
                    <div className="pb-1">
                      {item.children.filter((child) => !child.onlyFor || child.onlyFor.includes(typeId)).map((child) => {
                        const childActive = child.href === activeHref;
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`relative block px-11 py-2 transition-all duration-150 hover:ps-12 hover:text-white ${
                              childActive
                                ? "font-semibold hover:ps-11"
                                : "text-neutral-300 hover:bg-white/[0.06]"
                            }`}
                          style={childActive ? { background: "var(--accent)", color: "#0f172a" } : {}}
                          >
                            {label(child)}
                          </Link>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
