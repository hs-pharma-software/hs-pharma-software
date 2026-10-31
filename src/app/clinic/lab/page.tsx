"use client";

import { ClinicWorklist } from "@/components/clinic/ClinicWorklist";

/** Clinic lab: tests ordered in consultations, results and reports. */
export default function ClinicLabPage() {
  return <ClinicWorklist kind="lab" />;
}
