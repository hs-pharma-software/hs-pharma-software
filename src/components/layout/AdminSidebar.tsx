"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { ADMIN_NAV } from "@/config/adminNav";

function normalize(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function AdminSidebar() {
  const pathname = usePathname();
  const norm = normalize(pathname);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-gradient-to-b from-neutral-950 to-neutral-900 text-sm text-neutral-200">
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
                isActive ? "text-amber-400" : "text-neutral-200"
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="admin-sidebar-active-bar"
                  className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-amber-400"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon size={17} className="shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
