"use client";

import { use } from "react";
import ConsultationForm from "../ConsultationForm";

export default function EditConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ConsultationForm consultationId={id} />;
}
