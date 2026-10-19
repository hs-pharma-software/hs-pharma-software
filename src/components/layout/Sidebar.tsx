"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { NAV } from "@/config/nav";
import { useAuthStore } from "@/store/authStore";

/** Strips trailing slashes so routes compare consistently regardless of
 * Next's `trailingSlash: true` static-export setting. */
function normalize(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/** Several nav children share a path prefix with their own parent's `href`
 * (e.g. Invoices' parent link is "/invoices", and so is its first child,
 * "Invoices Details") — a naive `pathname.startsWith(href)` check would then
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
  const visibleNav = allowedModules ? NAV.filter((item) => allowedModules.includes(item.moduleKey)) : NAV;
  const activeHref = findActiveHref(pathname);
  const activeTop = visibleNav.find(
    (item) => item.href === activeHref || item.children?.some((c) => c.href === activeHref)
  );
  const [openLabel, setOpenLabel] = useState<string | null>(activeTop?.label ?? null);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-gradient-to-b from-neutral-950 to-neutral-900 text-sm text-neutral-200">
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
                  className="relative flex w-full items-center gap-3 px-4 py-2.5 text-left font-medium text-neutral-200 transition-colors hover:bg-white/[0.06]"
                >
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active-bar"
                      className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-amber-400"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <Icon size={17} className={`shrink-0 ${isActive ? "text-amber-400" : ""}`} />
                  <span className={`flex-1 ${isActive ? "text-amber-400" : ""}`}>{item.label}</span>
                  <motion.span
                    animate={{ rotate: isOpen ? 90 : 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    className="shrink-0"
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
                      className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-amber-400"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <Icon size={17} className="shrink-0" />
                  <span>{item.label}</span>
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
                      {item.children.map((child) => {
                        const childActive = child.href === activeHref;
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`relative block px-11 py-2 transition-all duration-150 hover:pl-12 hover:text-white ${
                              childActive
                                ? "bg-amber-400 font-semibold text-neutral-950 hover:bg-amber-400 hover:pl-11"
                                : "text-neutral-300 hover:bg-white/[0.06]"
                            }`}
                          >
                            {child.label}
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
