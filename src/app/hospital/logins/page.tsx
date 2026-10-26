"use client";

import { UserLoginsPage } from "@/components/admin/UserLoginsPage";

/** The hospital's staff logins: who can sign in and which sections they see. */
export default function HospitalLoginsPage() {
  return <UserLoginsPage scope="own" />;
}
