"use client";

import { ClinicWorklist } from "@/components/clinic/ClinicWorklist";

/** Clinic radiology: studies ordered in consultations and their reports. */
export default function ClinicRadiologyPage() {
  return <ClinicWorklist kind="radiology" />;
}
