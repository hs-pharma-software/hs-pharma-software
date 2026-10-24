"use client";

import { useEffect, useState } from "react";
import ConsultationForm from "../ConsultationForm";

/** ?appointment=<id> starts the consultation from that appointment. */
export default function NewConsultationPage() {
  const [ready, setReady] = useState(false);
  const [appointmentId, setAppointmentId] = useState<string | undefined>();
  useEffect(() => {
    setAppointmentId(new URLSearchParams(window.location.search).get("appointment") ?? undefined);
    setReady(true);
  }, []);
  if (!ready) return null;
  return <ConsultationForm appointmentId={appointmentId} />;
}
