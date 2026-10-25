"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isPublicPath } from "@/lib/publicPaths";
import { useAuthStore } from "@/store/authStore";
import { AppShell } from "./AppShell";
import { SuperAdminShell } from "./SuperAdminShell";

/** Picks which chrome wraps the current page based on who's logged in \u2014 the
 * Super Admin never sees pharmacy business screens (or any tenant's private
 * data), so `/admin/*` and every other route are two separate worlds. */
export function RoleShell({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const pathname = usePathname();
  const router = useRouter();
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isSuperAdmin = role === "super_admin";

  useEffect(() => {
    if (isPublicPath(pathname)) return;
    if (isSuperAdmin && !isAdminRoute) router.replace("/admin");
    if (!isSuperAdmin && isAdminRoute) router.replace("/dashboard");
  }, [pathname, isSuperAdmin, isAdminRoute, router]);

  // Landing page \u2014 no shell, no sidebar
  if (isPublicPath(pathname)) return <>{children}</>;

  if (isSuperAdmin) {
    return <SuperAdminShell>{children}</SuperAdminShell>;
  }
  return <AppShell>{children}</AppShell>;
}
