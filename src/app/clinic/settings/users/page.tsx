"use client";

import { UserLoginsPage } from "@/components/admin/UserLoginsPage";

/** Settings > Users: the clinic's staff logins and which sections each one sees. */
export default function ClinicUsersPage() {
  return <UserLoginsPage scope="own" />;
}
