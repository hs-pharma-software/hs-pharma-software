"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { NavChild, NavItem } from "@/config/nav";
import { useAuthStore } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { businessType } from "@/config/businessTypes";
import { visibleNavFor } from "@/config/navFilter";
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
function collectHrefs(children: NavChild[] | undefined, out: string[]) {
  children?.forEach((c) => {
    out.push(c.href);
    collectHrefs(c.children, out);
  });
}

/** Whether `href` is this entry's page or one of the pages inside it. */
function containsHref(node: { href: string; children?: NavChild[] }, href: string | null): boolean {
  return node.href === href || Boolean(node.children?.some((c) => containsHref(c, href)));
}

function findActiveHref(pathname: string, items: NavItem[]): string | null {
  const allHrefs: string[] = [];
  items.forEach((item) => {
    allHrefs.push(item.href);
    collectHrefs(item.children, allHrefs);
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
  const visibleNav = visibleNavFor(typeId, allowedModules, userPermissions);
  const activeHref = findActiveHref(pathname, visibleNav);
  const activeTop = visibleNav.find((item) => containsHref(item, activeHref));
  const [openLabel, setOpenLabel] = useState<string | null>(activeTop?.label ?? null);
  // The expanded second-level group (e.g. Purchase Cell / Banks), by "parent/child".
  const activeSub = activeTop?.children?.find((c) => c.children && containsHref(c, activeHref));
  const [openSub, setOpenSub] = useState<string | null>(activeTop && activeSub ? `${activeTop.label}/${activeSub.label}` : null);

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
          const isActive = containsHref(item, activeHref);
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
                        if (child.children) {
                          const subKey = `${item.label}/${child.label}`;
                          const subOpen = openSub === subKey;
                          const subActive = containsHref(child, activeHref);
                          return (
                            <div key={subKey}>
                              <button
                                type="button"
                                onClick={() => setOpenSub(subOpen ? null : subKey)}
                                className="flex w-full items-center gap-2 px-11 py-2 text-start text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                                style={subActive ? { color: "var(--accent)" } : {}}
                              >
                                <span className="flex-1">{label(child)}</span>
                                <span className={`shrink-0 transition-transform rtl:-scale-x-100 ${subOpen ? "rotate-90" : ""}`}>
                                  <ChevronRight size={13} />
                                </span>
                              </button>
                              {subOpen && (
                                <div className="bg-black/20 pb-1">
                                  {child.children.map((leaf) => {
                                    const leafActive = leaf.href === activeHref;
                                    return (
                                      <Link
                                        key={leaf.href}
                                        href={leaf.href}
                                        className={`relative block px-14 py-1.5 text-[13px] transition-all duration-150 hover:text-white ${
                                          leafActive ? "font-semibold" : "text-neutral-400 hover:bg-white/[0.06]"
                                        }`}
                                        style={leafActive ? { background: "var(--accent)", color: "#0f172a" } : {}}
                                      >
                                        {label(leaf)}
                                      </Link>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        }
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
