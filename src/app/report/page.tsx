"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { getPublicLabReport, type LabReport } from "@/lib/repo/labReports";
import { LabReportSheet } from "@/components/hospital/LabReportSheet";

/** Online copy of a lab report, opened from the QR code on the printed report.
 * Public (no login): the random token in the link is the key. */
export default function PublicReportPage() {
  return (
    <Suspense fallback={<Message text="Loading the report…" />}>
      <PublicReport />
    </Suspense>
  );
}

function PublicReport() {
  const token = useSearchParams().get("t") ?? "";
  const [report, setReport] = useState<LabReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("This link has no report in it. Scan the QR code on the report again.");
      return;
    }
    getPublicLabReport(token).then(setReport).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  if (error) return <Message text={error} tone="error" />;
  if (!report) return <Message text="Loading the report…" />;
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto w-full max-w-[190mm] rounded-xl bg-white p-5 text-[13px] text-neutral-900 shadow-sm ring-1 ring-black/5 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <LabReportSheet report={report} qrUrl={null} />
      </div>
      <div className="mx-auto mt-3 flex w-full max-w-[190mm] flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 print:hidden">
        <span>Online copy of the verified report. Check the verification code against the printed copy.</span>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700">
          <Printer size={13} /> Print
        </button>
      </div>
    </main>
  );
}

function Message({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <p className={`max-w-sm rounded-xl bg-white px-5 py-4 text-center text-sm shadow-sm ring-1 ring-black/5 ${tone === "error" ? "text-rose-700" : "text-neutral-500"}`}>{text}</p>
    </main>
  );
}
