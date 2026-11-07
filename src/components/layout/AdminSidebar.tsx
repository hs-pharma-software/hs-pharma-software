"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { ADMIN_NAV } from "@/config/adminNav";
import { useUnreadQueries } from "@/lib/queriesClient";
import { useAuthStore } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";

function normalize(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function AdminSidebar() {
  const pathname = usePathname();
  const norm = normalize(pathname);
  const unread = useUnreadQueries(useAuthStore((s) => s.currentUser?.role === "super_admin"));
  const open = useAppStore((s) => s.sidebarMobileOpen);

  return (
    <aside
      aria-label="Menu"
      className={`fixed bottom-0 left-0 top-12 z-40 flex w-[min(18rem,85vw)] flex-col overflow-y-auto pb-safe bg-gradient-to-b from-[var(--sidebar-from)] to-[var(--sidebar-to)] text-sm text-neutral-200 transition-transform duration-300 md:static md:z-auto md:h-full md:w-64 md:shrink-0 md:translate-x-0 md:transition-none ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      <nav className="flex-1 py-1">
        {ADMIN_NAV.map((item) => {
          const href = normalize(item.href);
          const isActive = norm === href || (href !== "/admin" && norm.startsWith(`${href}/`));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-3 border-b border-white/5 px-4 py-2.5 font-medium transition-colors hover:bg-white/[0.06] ${
                isActive ? "text-[var(--accent)]" : "text-neutral-200"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="admin-sidebar-active-bar"
                  className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-[var(--accent)]"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon size={17} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.href === "/admin/queries" && unread != null && unread > 0 && (
                <span className="min-w-[1.25rem] rounded-full bg-rose-500 px-1.5 text-center text-[11px] font-semibold leading-5 text-white tabular-nums" aria-label={`${unread} unread`}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
