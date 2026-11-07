"use client";

import { Fragment } from "react";
import QRCode from "react-qr-code";
import type { LabReportView } from "@/lib/labReportView";
import type { ClinicProfile } from "@/lib/clinicProfile";
import { PAPERS } from "@/lib/printTemplates";
import { PAPER_WIDTH, type ClinicPrintTemplate } from "@/lib/clinicPrintTemplates";
import type { LabReportDesign } from "@/lib/labReportDesigns";
import { ReportWithFooterLine } from "@/components/brand/PageFooterLine";

export type { LabPart, LabLine, LabReportView } from "@/lib/labReportView";
export { SAMPLE_LAB_REPORT } from "@/lib/labReportView";

const FONT: Record<LabReportDesign["font"], string> = {
  sans: "ui-sans-serif, system-ui, 'Segoe UI', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
};

const abnormal = (f: string | null | undefined) => f === "H" || f === "L";
/** A block the printer keeps on one page: a test that does not fit in the space
 * left starts on the next page with its heading, instead of leaving the heading behind. */
export const KEEP_TOGETHER: React.CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" };
/** Same column widths in every test's table, so the columns line up down the page. */
const COLS = ["36%", "16%", "13%", "23%", "12%"];

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
export function LabReportDocument({ view, design, t, profile, areaRef, logo = null, qrUrl = null }: {
  view: LabReportView;
  design: LabReportDesign;
  t: ClinicPrintTemplate;
  profile: ClinicProfile;
  areaRef?: React.RefObject<HTMLDivElement | null>;
  /** The business logo (Settings > Print Templates), shown in the header. */
  logo?: string | null;
  /** Address of the online copy: printed as a QR code. */
  qrUrl?: string | null;
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
      <div className={`flex items-center gap-3 ${left || design.header === "sidebar" ? "" : "justify-center"} ${narrow ? "flex-col" : ""}`}>
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className={`${narrow ? "max-h-10" : "max-h-16"} max-w-[30%] shrink-0 object-contain`} />
        )}
        <div>
          <p className={`font-bold leading-tight ${narrow ? "text-base" : "text-xl"}`} style={{ color: design.header === "plain" ? undefined : acc }}>{profile.name || "Laboratory"}</p>
          {profile.address && <p className="text-[0.85em] text-neutral-700">{profile.address}</p>}
          {profile.contact && <p className="text-[0.85em] text-neutral-700">Contact: {profile.contact}</p>}
          {t.showIds && ids && <p className="text-[0.8em] text-neutral-600">{ids}</p>}
        </div>
      </div>
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
  const cols = <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>;
  const row = (key: string, name: string, value: string | null | undefined, unit: string | null | undefined, range: string | null | undefined, flag: string | null | undefined, sub: boolean) => {
    const n = rowIndex++;
    return (
      <tr key={key} className={rowCls} style={rowStyle(n)}>
        <td className={`${sub ? "py-1 pl-2 pr-1" : "px-1 py-1.5 font-medium"} ${cell}`}>{name}</td>
        <td className={`px-1 ${sub ? "py-1 font-semibold tabular-nums" : "py-1.5 font-bold"} ${cell} ${abnormal(flag) ? "text-rose-700" : ""}`}>{value}</td>
        <td className={`px-1 ${sub ? "py-1" : "py-1.5"} ${cell}`}>{unit ?? (sub ? "" : "—")}</td>
        <td className={`px-1 ${sub ? "py-1" : "py-1.5"} ${cell}`}>{range ?? (sub ? "" : "—")}</td>
        <td className={`px-1 ${sub ? "py-1" : "py-1.5"} ${cell}`}>{sub || abnormal(flag) ? <Flag flag={flag} design={design} /> : flag === "N" ? "Normal" : "—"}</td>
      </tr>
    );
  };
  // One table per test, each kept on one page; the column header goes with the first test.
  const results = view.lab.length > 0 && (
    <div className="mt-4">
      {view.lab.map((o, idx) => (
        <div key={o.id} style={KEEP_TOGETHER}>
          <table className="w-full table-fixed border-collapse">
            {cols}
            {idx === 0 && (
              <thead>
                <tr className={headRow.className} style={headRow.style}>
                  {["Test", "Result", "Unit", "Normal range", "Flag"].map((h) => <th key={h} className={`px-1 py-1 ${cell}`}>{h}</th>)}
                </tr>
              </thead>
            )}
            <tbody>
              {o.parts.length > 0 ? (
                <>
                  <tr><td colSpan={5} className={`px-1 pt-3 font-semibold ${cell}`} style={{ color: design.header === "plain" ? undefined : acc }}>{o.name}</td></tr>
                  {o.parts.map((c, i, all) => (
                    <Fragment key={c.key}>
                      {c.group && c.group !== all[i - 1]?.group && (
                        <tr><td colSpan={5} className={`px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 ${cell}`}>{c.group}</td></tr>
                      )}
                      {row(c.key, c.name, c.value, c.unit, c.range, c.flag, true)}
                    </Fragment>
                  ))}
                </>
              ) : row(o.id, o.name, o.value, o.unit, o.range, o.flag, false)}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );

  const frame = design.frame === "double" ? { border: `3px double ${acc}`, padding: "10px" } : design.frame === "single" ? { border: `1.5px solid ${acc}`, padding: "10px" } : {};

  return (
    <div
      ref={areaRef}
      className={`print-area mx-auto w-full ${PAPER_WIDTH[t.paper]} bg-white ${narrow ? "text-[11px]" : "text-[13px]"} text-neutral-900`}
      style={{ fontFamily: FONT[design.font], WebkitPrintColorAdjust: "exact", printColorAdjust: "exact", ...frame }}
    >
      <style>{`@media print { @page { size: ${p.css}; margin: ${p.marginMm}mm; } }`}</style>
      <ReportWithFooterLine>
      {header}
      {title}
      {info}
      {results}
      {view.radiology.map((o) => (
        <div key={o.id} className="mt-4 flex flex-col gap-2" style={KEEP_TOGETHER}>
          <p className="font-semibold" style={{ color: acc }}>{o.name}</p>
          {o.findings && <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Findings</p><p className="whitespace-pre-line">{o.findings}</p></div>}
          <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Impression</p><p className="whitespace-pre-line font-semibold">{o.impression}</p></div>
        </div>
      ))}
      {view.comments.length > 0 && (
        <div className="mt-4" style={KEEP_TOGETHER}>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Pathologist&apos;s comments</p>
          {view.comments.map((c) => <p key={c} className="whitespace-pre-line">{c}</p>)}
        </div>
      )}
      <div style={KEEP_TOGETHER}>
      {qrUrl && (
        <div className="mt-5 flex items-center gap-3">
          <div className="shrink-0 rounded border p-1" style={{ borderColor: acc }}>
            <QRCode value={qrUrl} size={narrow ? 72 : 84} style={{ width: narrow ? 72 : 84, height: narrow ? 72 : 84 }} viewBox="0 0 256 256" />
          </div>
          <p className="text-[0.8em] leading-snug text-neutral-600">Scan to view this report online.<br />Only verified results are shown.</p>
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
      </ReportWithFooterLine>
    </div>
  );
}
