"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePublicPage } from "@/components/auth/usePublicPage";
import { useAuthStore } from "@/store/authStore";
import { AppShell } from "./AppShell";
import { SuperAdminShell } from "./SuperAdminShell";
import { SubSuperShell } from "./SubSuperShell";

/** Picks which chrome wraps the current page based on who's logged in — the
 * Super Admin never sees pharmacy business screens (or any tenant's private
 * data), so `/admin/*` and every other route are two separate worlds. A Sub
 * Super (distributor) sees only their workspace at /sub-super; the server
 * refuses them everything else in any case. */
export function RoleShell({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const distributor = useAuthStore((s) => s.currentUser?.platformRole === "distributor");
  const pathname = usePathname();
  const publicPage = usePublicPage();
  const router = useRouter();
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isSubSuperRoute = pathname === "/sub-super" || pathname.startsWith("/sub-super/");
  const isSuperAdmin = role === "super_admin";

  useEffect(() => {
    if (publicPage || !role) return;
    if (distributor) {
      if (!isSubSuperRoute) router.replace("/sub-super");
      return;
    }
    if (isSubSuperRoute) router.replace(isSuperAdmin ? "/admin/sub-supers" : "/dashboard");
    else if (isSuperAdmin && !isAdminRoute) router.replace("/admin");
    else if (!isSuperAdmin && isAdminRoute) router.replace("/dashboard");
  }, [publicPage, role, distributor, isSuperAdmin, isAdminRoute, isSubSuperRoute, router]);

  // Landing page — no shell, no sidebar
  if (publicPage) return <>{children}</>;

  if (distributor) return <SubSuperShell>{isSubSuperRoute ? children : null}</SubSuperShell>;
  if (isSuperAdmin) {
    return <SuperAdminShell>{children}</SuperAdminShell>;
  }
  return <AppShell>{isSubSuperRoute ? null : children}</AppShell>;
}
