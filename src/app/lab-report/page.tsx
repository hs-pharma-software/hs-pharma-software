"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { LabReportDocument } from "@/components/clinic/LabReportDocument";
import { labDesign } from "@/lib/labReportDesigns";
import type { PublicLabReport } from "@/server/labVisitReport";

/** Online copy of a diagnostic-lab report, opened from the QR code on the
 * receipt or the printed report. Public (no login): the token is the key.
 * Only verified results are shown; until then it says the report is not ready. */
export default function OnlineLabReportPage() {
  return (
    <Suspense fallback={<Message text="Loading the report…" />}>
      <OnlineLabReport />
    </Suspense>
  );
}

function OnlineLabReport() {
  const token = useSearchParams().get("t") ?? "";
  const [report, setReport] = useState<PublicLabReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("This link has no report in it. Scan the QR code on your receipt again.");
      return;
    }
    fetch(`/api/public/lab-visit-report/?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { report?: PublicLabReport; error?: string };
        if (!res.ok || !body.report) throw new Error(body.error ?? "The report could not be loaded. Try again in a moment.");
        setReport(body.report);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  if (error) return <Message text={error} tone="error" />;
  if (!report) return <Message text="Loading the report…" />;
  if (!report.ready || !report.view) {
    return (
      <Message
        text={`Your report for visit ${report.visitNo} is not ready yet${report.pending ? ` (${report.pending} test${report.pending === 1 ? "" : "s"} in progress)` : ""}. Open this link again later; it shows the results once the pathologist has verified them.`}
      />
    );
  }
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto w-full max-w-[200mm] overflow-x-auto rounded-xl bg-white p-5 shadow-sm ring-1 ring-black/5 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <LabReportDocument view={report.view} design={labDesign(report.template.design)} t={report.template} profile={report.profile} logo={report.logo} />
      </div>
      <div className="mx-auto mt-3 flex w-full max-w-[200mm] flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 print:hidden">
        <span>
          Online copy of the verified results for visit {report.visitNo}.
          {report.pending > 0 && ` ${report.pending} test${report.pending === 1 ? " is" : "s are"} still in progress and will appear here when verified.`}
          {" "}For a PDF, press Download PDF and choose “Save as PDF”.
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {/* The browser saves the report as a PDF: choose "Save as PDF" as the printer. */}
          <button type="button" onClick={() => window.print()} title="Choose Save as PDF in the print window" className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700">
            <Download size={13} /> Download PDF
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-50">
            <Printer size={13} /> Print
          </button>
        </span>
      </div>
    </main>
  );
}

function Message({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <p className={`max-w-sm rounded-xl bg-white px-5 py-4 text-center text-sm shadow-sm ring-1 ring-black/5 ${tone === "error" ? "text-rose-700" : "text-neutral-600"}`}>{text}</p>
    </main>
  );
}
