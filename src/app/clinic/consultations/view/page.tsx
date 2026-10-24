"use client";

import { useEffect, useState } from "react";
import ConsultationForm from "../ConsultationForm";

/** Static export: the consultation id arrives as ?id=, read after mount. */
export default function ConsultationViewPage() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id")), []);
  if (!id) return null;
  return <ConsultationForm key={id} consultationId={id} />;
}
