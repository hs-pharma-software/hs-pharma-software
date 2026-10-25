"use client";

import QRCode from "react-qr-code";
import type { LabReport } from "@/lib/repo/labReports";

/** The laboratory report as printed and as shown online (QR code). Only the
 * verified results are in `report.tests`. */
export function LabReportSheet({ report: r, qrUrl }: { report: LabReport; qrUrl: string | null }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-2">
        <div>
          <p className="text-xl font-bold leading-tight">{r.hospital.name}</p>
          <p className="text-xs text-neutral-600">Department of Pathology / Laboratory</p>
          {(r.hospital.address || r.hospital.phone) && <p className="text-xs text-neutral-600">{[r.hospital.address, r.hospital.phone].filter(Boolean).join(" · ")}</p>}
          {r.hospital.registration && <p className="text-xs text-neutral-500">Reg. {r.hospital.registration}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tracking-wide">LABORATORY REPORT</p>
          <p className="font-mono text-xs">Lab No {r.request.lab_no}</p>
          <p className="font-mono text-xs">Invoice {r.request.invoice_no}</p>
        </div>
      </div>

      <div className="flex gap-4 border-b border-neutral-300 py-2">
        <div className="grid flex-1 grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
          <p><span className="text-neutral-500">Patient:</span> <b>{r.patient.name}</b></p>
          <p><span className="text-neutral-500">MR No:</span> <span className="font-mono">{r.patient.mrNo}</span></p>
          <p><span className="text-neutral-500">Age / Sex:</span> {[r.patient.age, r.patient.gender].filter(Boolean).join(" / ") || "—"}</p>
          <p><span className="text-neutral-500">Referred by:</span> {r.referringDoctor ?? "Self"}</p>
          <p><span className="text-neutral-500">Registered at:</span> {r.location}</p>
          {r.request.external_ref && <p><span className="text-neutral-500">Center ref:</span> {r.request.external_ref}</p>}
          <p><span className="text-neutral-500">Sample collected:</span> {r.request.sample_collected_at ?? "—"}</p>
          <p><span className="text-neutral-500">Sample received:</span> {r.request.sample_received_at ?? "—"}</p>
          <p><span className="text-neutral-500">Reported:</span> {r.reportDate ?? "—"}</p>
          <p><span className="text-neutral-500">Order No(s):</span> <span className="font-mono">{r.tests.map((t) => t.order_no).join(", ")}</span></p>
        </div>
        {qrUrl && (
          <div className="flex w-[84px] shrink-0 flex-col items-center gap-1 text-center">
            <QRCode value={qrUrl} size={76} style={{ width: 76, height: 76 }} viewBox="0 0 256 256" />
            <p className="text-[9px] leading-tight text-neutral-500">Scan to view this report online</p>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-neutral-400 text-[11px] uppercase tracking-wide text-neutral-600">
              <th className="py-1 pr-2 font-semibold">Test</th>
              <th className="py-1 pr-2 font-semibold">Sample</th>
              <th className="py-1 pr-2 font-semibold">Result</th>
              <th className="py-1 pr-2 font-semibold">Unit</th>
              <th className="py-1 pr-2 font-semibold">Reference range</th>
            </tr>
          </thead>
          <tbody>
            {r.tests.map((t) => {
              if (t.components.length) {
                return [
                  <tr key={t.id} className="border-b border-neutral-200">
                    <td colSpan={2} className="pb-0.5 pt-2 pr-2 font-semibold">{t.test_name}</td>
                    <td colSpan={3} className="pb-0.5 pt-2 text-neutral-600">{t.sample_type ?? ""}</td>
                  </tr>,
                  ...t.components.map((c, i) => {
                    const abnormal = c.flag === "H" || c.flag === "L";
                    const header = c.group && c.group !== t.components[i - 1]?.group ? c.group : null;
                    return [
                      header ? <tr key={`${t.id}-g-${c.key}`}><td colSpan={5} className="pt-1 pl-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{header}</td></tr> : null,
                      <tr key={`${t.id}-${c.key}`} className="border-b border-neutral-50 align-top">
                        <td colSpan={2} className="py-0.5 pl-3 pr-2">{c.name}</td>
                        <td className={`py-0.5 pr-2 tabular-nums ${abnormal ? "font-bold" : ""}`}>{c.value}{abnormal ? ` ${c.flag === "H" ? "H ↑" : "L ↓"}` : ""}</td>
                        <td className="py-0.5 pr-2">{c.unit ?? ""}</td>
                        <td className="py-0.5 pr-2">{c.ref_range ?? ""}</td>
                      </tr>,
                    ];
                  }),
                ];
              }
              const abnormal = t.flag === "H" || t.flag === "L";
              return (
                <tr key={t.id} className="border-b border-neutral-100 align-top">
                  <td className="py-1.5 pr-2 font-medium">{t.test_name}</td>
                  <td className="py-1.5 pr-2 text-neutral-600">{t.sample_type ?? "—"}</td>
                  <td className={`py-1.5 pr-2 tabular-nums ${abnormal ? "font-bold" : ""}`}>{t.result_value}{abnormal ? ` ${t.flag === "H" ? "H ↑" : "L ↓"}` : ""}</td>
                  <td className="py-1.5 pr-2">{t.unit ?? ""}</td>
                  <td className="py-1.5 pr-2">{t.ref_range ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {r.pendingTests.length > 0 && (
        <p className="mt-2 text-xs italic text-neutral-600">
          Not included (not yet verified): {r.pendingTests.map((t) => `${t.test_name} (${t.label})`).join(", ")}. A complete report will follow.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 text-xs">
        <div>
          {[...new Map(r.tests.map((t) => [`${t.verified_by_name}|${t.verified_by_license}`, t])).values()].map((t) => (
            <p key={`${t.verified_by_name}${t.verified_by_license}`}>
              Verified by <b>{t.verified_by_name ?? "—"}</b>{t.verified_by_license ? `, ${t.verified_by_license}` : ""}
            </p>
          ))}
          <p className="text-neutral-500">Electronically verified report; no signature required.</p>
        </div>
        <div className="text-right">
          <p className="text-neutral-500">Verification code</p>
          <p className="font-mono text-sm font-semibold">{r.verificationCode}</p>
        </div>
      </div>
    </>
  );
}
