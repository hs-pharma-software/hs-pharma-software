"use client";

import { Fragment } from "react";
import type { ClinicProfile } from "@/lib/clinicProfile";
import { PAPERS } from "@/lib/printTemplates";
import { PAPER_WIDTH, type ClinicPrintTemplate } from "@/lib/clinicPrintTemplates";
import type { LabReportDesign } from "@/lib/labReportDesigns";

export interface LabPart { key: string; name: string; group: string | null; value: string; unit: string | null; range: string | null; flag: string | null }
export interface LabLine { id: string; name: string; value: string | null; unit: string | null; range: string | null; flag: string | null; parts: LabPart[] }

/** What a lab report says, independent of how it looks. */
export interface LabReportView {
  title: string;
  info: { label: string; value: string; strong?: boolean }[];
  lab: LabLine[];
  radiology: { id: string; name: string; findings: string | null; impression: string | null }[];
  comments: string[];
  /** e.g. "Verified by: Dr. Sana" (signature line, or the closing line when there is none). */
  signedBy: string;
}

const FONT: Record<LabReportDesign["font"], string> = {
  sans: "ui-sans-serif, system-ui, 'Segoe UI', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
};

const abnormal = (f: string | null | undefined) => f === "H" || f === "L";

function Flag({ flag, design }: { flag: string | null | undefined; design: LabReportDesign }) {
  if (!abnormal(flag)) return null;
  const high = flag === "H";
  switch (design.flag) {
    case "arrow": return <span className="font-bold text-rose-700">{high ? "↑ High" : "↓ Low"}</span>;
    case "letter": return <span className="font-bold text-rose-700">{high ? "H" : "L"}</span>;
    case "badge": return <span className="rounded px-1.5 py-0.5 text-[0.85em] font-semibold text-white" style={{ background: high ? "#be123c" : "#1d4ed8" }}>{high ? "HIGH" : "LOW"}</span>;
    default: return <span className="font-semibold text-rose-700">{high ? "High" : "Low"}</span>;
  }
}

/** The report, laid out by a design: header, title, patient details, results,
 * radiology, comments, signature and footer. Prints on the template's paper. */
export function LabReportDocument({ view, design, t, profile, areaRef }: {
  view: LabReportView;
  design: LabReportDesign;
  t: ClinicPrintTemplate;
  profile: ClinicProfile;
  areaRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const p = PAPERS.find((x) => x.id === t.paper)!;
  const narrow = t.paper === "thermal";
  const acc = design.accent;
  const tint = `${acc}12`;
  const ids = [profile.phc_reg_no && `PHC Reg No: ${profile.phc_reg_no}`, profile.ntn && `NTN: ${profile.ntn}`].filter(Boolean).join("  ·  ");
  const left = t.headerAlign === "left";

  const header = (
    <div
      className={`${left || design.header === "sidebar" ? "text-left" : "text-center"} ${design.header === "boxed" ? "rounded-md border-2 px-3 py-2" : "pb-2"} ${design.header === "sidebar" ? "border-l-[6px] pl-3" : ""}`}
      style={{
        borderColor: acc,
        borderBottom: design.header === "plain" ? "2px solid #262626" : design.header === "rule" ? `4px solid ${acc}` : design.header === "band" ? `1px solid ${acc}` : undefined,
      }}
    >
      {design.header === "band" && <div className="-mx-0 mb-2 h-2 rounded-sm" style={{ background: acc }} />}
      <p className={`font-bold leading-tight ${narrow ? "text-base" : "text-xl"}`} style={{ color: design.header === "plain" ? undefined : acc }}>{profile.name || "Laboratory"}</p>
      {profile.address && <p className="text-[0.85em] text-neutral-700">{profile.address}</p>}
      {profile.contact && <p className="text-[0.85em] text-neutral-700">Contact: {profile.contact}</p>}
      {t.showIds && ids && <p className="text-[0.8em] text-neutral-600">{ids}</p>}
    </div>
  );

  const title = (() => {
    const text = view.title.toUpperCase();
    switch (design.title) {
      case "left": return <p className="mt-3 text-left text-sm font-bold tracking-widest" style={{ color: acc }}>{text}</p>;
      case "pill": return <div className="mt-3 text-center"><span className="inline-block rounded-full px-4 py-1 text-xs font-bold tracking-widest text-white" style={{ background: acc }}>{text}</span></div>;
      case "bar": return <p className="mt-3 rounded-sm py-1 text-center text-sm font-bold tracking-widest text-white" style={{ background: acc }}>{text}</p>;
      default: return <p className="mt-3 text-center text-sm font-bold tracking-widest">{text}</p>;
    }
  })();

  const infoCls = {
    lines: "border-y border-neutral-300 py-2",
    box: "rounded-md border px-3 py-2",
    shaded: "rounded-md px-3 py-2",
    grid: "border border-neutral-300",
  }[design.info];
  const info = (
    <div
      className={`mt-3 grid ${narrow ? "grid-cols-1" : "grid-cols-2"} ${design.info === "grid" ? "" : "gap-x-6 gap-y-1"} ${infoCls}`}
      style={{ borderColor: design.info === "box" ? acc : undefined, background: design.info === "shaded" ? tint : undefined }}
    >
      {view.info.map((x) => (
        <div key={x.label} className={design.info === "grid" ? "border border-neutral-300 px-2 py-1" : ""}>
          <span className="text-neutral-500">{x.label}: </span>{x.strong ? <b>{x.value}</b> : x.value}
        </div>
      ))}
    </div>
  );

  const cell = design.table === "grid" ? "border border-neutral-300 px-1.5" : "";
  const headRow = (() => {
    switch (design.table) {
      case "shaded-head": return { className: "text-left text-white", style: { background: acc } };
      case "grid": return { className: "text-left", style: { background: tint } };
      case "minimal": return { className: "border-b text-left text-[0.85em] uppercase tracking-wide text-neutral-500", style: {} };
      default: return { className: "border-b-2 text-left", style: { borderColor: design.table === "striped" ? acc : "#262626" } };
    }
  })();
  const rowCls = design.table === "minimal" || design.table === "grid" ? "" : "border-b border-neutral-100";
  const rowStyle = (i: number) => (design.table === "striped" && i % 2 === 1 ? { background: tint } : undefined);

  let rowIndex = 0;
  const results = view.lab.length > 0 && (
    <table className="mt-4 w-full border-collapse">
      <thead>
        <tr className={headRow.className} style={headRow.style}>
          {["Test", "Result", "Unit", "Normal range", "Flag"].map((h) => <th key={h} className={`px-1 py-1 ${cell}`}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {view.lab.map((o) =>
          o.parts.length > 0 ? (
            <Fragment key={o.id}>
              <tr><td colSpan={5} className={`px-1 pt-3 font-semibold ${cell}`} style={{ color: design.header === "plain" ? undefined : acc }}>{o.name}</td></tr>
              {o.parts.map((c, i, all) => {
                const n = rowIndex++;
                return (
                  <Fragment key={c.key}>
                    {c.group && c.group !== all[i - 1]?.group && (
                      <tr><td colSpan={5} className={`px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 ${cell}`}>{c.group}</td></tr>
                    )}
                    <tr className={rowCls} style={rowStyle(n)}>
                      <td className={`py-1 pl-2 pr-1 ${cell}`}>{c.name}</td>
                      <td className={`px-1 py-1 font-semibold tabular-nums ${cell} ${abnormal(c.flag) ? "text-rose-700" : ""}`}>{c.value}</td>
                      <td className={`px-1 py-1 ${cell}`}>{c.unit ?? ""}</td>
                      <td className={`px-1 py-1 ${cell}`}>{c.range ?? ""}</td>
                      <td className={`px-1 py-1 ${cell}`}><Flag flag={c.flag} design={design} /></td>
                    </tr>
                  </Fragment>
                );
              })}
            </Fragment>
          ) : (() => {
            const n = rowIndex++;
            return (
              <tr key={o.id} className={rowCls} style={rowStyle(n)}>
                <td className={`px-1 py-1.5 font-medium ${cell}`}>{o.name}</td>
                <td className={`px-1 py-1.5 font-bold ${cell} ${abnormal(o.flag) ? "text-rose-700" : ""}`}>{o.value}</td>
                <td className={`px-1 py-1.5 ${cell}`}>{o.unit ?? "—"}</td>
                <td className={`px-1 py-1.5 ${cell}`}>{o.range ?? "—"}</td>
                <td className={`px-1 py-1.5 ${cell}`}>{abnormal(o.flag) ? <Flag flag={o.flag} design={design} /> : o.flag === "N" ? "Normal" : "—"}</td>
              </tr>
            );
          })(),
        )}
      </tbody>
    </table>
  );

  const frame = design.frame === "double" ? { border: `3px double ${acc}`, padding: "10px" } : design.frame === "single" ? { border: `1.5px solid ${acc}`, padding: "10px" } : {};

  return (
    <div
      ref={areaRef}
      className={`print-area mx-auto w-full ${PAPER_WIDTH[t.paper]} bg-white ${narrow ? "text-[11px]" : "text-[13px]"} text-neutral-900`}
      style={{ fontFamily: FONT[design.font], WebkitPrintColorAdjust: "exact", printColorAdjust: "exact", ...frame }}
    >
      <style>{`@media print { @page { size: ${p.css}; margin: ${p.marginMm}mm; } }`}</style>
      {header}
      {title}
      {info}
      {results}
      {view.radiology.map((o) => (
        <div key={o.id} className="mt-4 flex flex-col gap-2">
          <p className="font-semibold" style={{ color: acc }}>{o.name}</p>
          {o.findings && <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Findings</p><p className="whitespace-pre-line">{o.findings}</p></div>}
          <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Impression</p><p className="whitespace-pre-line font-semibold">{o.impression}</p></div>
        </div>
      ))}
      {view.comments.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Pathologist&apos;s comments</p>
          {view.comments.map((c) => <p key={c} className="whitespace-pre-line">{c}</p>)}
        </div>
      )}
      {t.signature ? (
        <div className="mt-10 flex justify-end">
          <div className="min-w-[45%] border-t pt-1 text-center text-xs text-neutral-700" style={{ borderColor: acc }}>{view.signedBy}</div>
        </div>
      ) : (
        <p className="mt-10 text-right text-xs text-neutral-600">{view.signedBy}</p>
      )}
      {t.footer && <p className="mt-4 border-t border-neutral-300 pt-1 text-center text-[0.85em] text-neutral-600">{t.footer}</p>}
    </div>
  );
}

/** A made-up report to preview designs (no real patient). */
export const SAMPLE_LAB_REPORT: LabReportView = {
  title: "Laboratory Report",
  info: [
    { label: "Patient", value: "Sample Patient", strong: true },
    { label: "MRN", value: "MRN-000123" },
    { label: "Gender / DOB", value: "Male / 1990-05-14" },
    { label: "Referred by", value: "Dr. Sample Doctor" },
    { label: "Order", value: "LAB-20261105-001" },
    { label: "Reported", value: "2026-11-05 10:30" },
  ],
  lab: [
    {
      id: "cbc", name: "Complete Blood Count (CBC)", value: null, unit: null, range: null, flag: null,
      parts: [
        { key: "hb", name: "Haemoglobin (Hb)", group: "Red cells", value: "12.1", unit: "g/dL", range: "13.0-17.0", flag: "L" },
        { key: "rbc", name: "RBC count", group: "Red cells", value: "4.8", unit: "×10⁶/µL", range: "4.5-5.5", flag: "N" },
        { key: "tlc", name: "Total Leucocyte Count", group: "White cells", value: "12.6", unit: "×10³/µL", range: "4.0-11.0", flag: "H" },
        { key: "plt", name: "Platelet count", group: "Platelets", value: "250", unit: "×10³/µL", range: "150-400", flag: "N" },
      ],
    },
    { id: "fbs", name: "Blood Sugar (Fasting)", value: "96", unit: "mg/dL", range: "70-110", flag: "N", parts: [] },
  ],
  radiology: [],
  comments: ["Mild anaemia with raised TLC; correlate clinically."],
  signedBy: "Verified by: Dr. Sample Pathologist",
};
