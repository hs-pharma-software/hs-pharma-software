"use client";

import { useEffect, useState } from "react";
import { BookingForm } from "@/components/banquet/BookingForm";

/** ?id=<booking> changes that booking; ?date=YYYY-MM-DD starts a new one on that date. */
export default function NewBookingPage() {
  const [ready, setReady] = useState(false);
  const [params, setParams] = useState<{ id?: string; date?: string }>({});
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setParams({ id: q.get("id") ?? undefined, date: q.get("date") ?? undefined });
    setReady(true);
  }, []);
  if (!ready) return null;
  return <BookingForm key={params.id ?? "new"} bookingId={params.id} initialDate={params.date} />;
}
