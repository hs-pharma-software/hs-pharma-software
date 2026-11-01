"use client";

import { ServicesManager } from "@/components/clinic/ServicesManager";

/** The lab's tests and their rates (panels such as CBC and LFT carry every parameter). */
export default function LabTestsPage() {
  return <ServicesManager only="lab" title="Tests & Rates" />;
}
