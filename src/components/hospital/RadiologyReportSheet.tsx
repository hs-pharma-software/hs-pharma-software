"use client";

import QRCode from "react-qr-code";
import { parseStructuredReport, reportSections, ultrasoundTemplate, type UsPrintSection } from "@/config/ultrasoundReports";
import { narrativeTitle } from "@/config/ultrasoundNarrative";
import type { RadiologyReport } from "@/lib/radiologyReportDocument";

const Heading = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{children}</p>;

/** A value outside its reference range: marked in words, so it survives black-and-white printing. */
function Value({ value, flag }: { value: string; flag: "High" | "Low" | null }) {
  return <span className={flag ? "font-bold" : undefined}>{value}{flag ? ` (${flag})` : ""}</span>;
}

function Section({ s }: { s: UsPrintSection }) {
  return (
    <div className="mt-2.5 break-inside-avoid">
      <p className="border-b border-neutral-300 pb-0.5 text-[12px] font-bold">{s.title}</p>
      {s.rows.length > 0 && (
        <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
          {s.rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-3 border-b border-dotted border-neutral-200">
              <dt className="text-neutral-600">{r.label}</dt>
              <dd className="text-right"><Value value={r.value} flag={r.flag} /></dd>
            </div>
          ))}
        </dl>
      )}
      {s.tables.map((t) => (
        <table key={t.label} className="mt-1.5 w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-left font-semibold">No.</th>
              {t.columns.map((c) => <th key={c} className="border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-left font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, i) => (
              <tr key={i}>
                <td className="border border-neutral-300 px-1.5 py-0.5">{i + 1}</td>
                {row.map((c, j) => <td key={j} className="border border-neutral-300 px-1.5 py-0.5"><Value value={c.value} flag={c.flag} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

const GroupHeading = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-3 border-b border-neutral-400 pb-0.5 text-[12px] font-bold uppercase tracking-wide text-[#0b2a6b] print:text-neutral-900">{children}</p>
);

/** The findings in sentences, as signed: headings, then a bullet per organ. */
function Narrative({ paragraphs }: { paragraphs: NonNullable<ReturnType<typeof parseStructuredReport>>["narrative"] & object }) {
  const groups: { title: string; items: typeof paragraphs }[] = [];
  for (const p of paragraphs) {
    if (groups[groups.length - 1]?.title !== p.group) groups.push({ title: p.group, items: [] });
    groups[groups.length - 1].items.push(p);
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.title}>
          <GroupHeading>{g.title}</GroupHeading>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] leading-snug">
            {g.items.map((p) => <li key={p.id} className="break-inside-avoid"><b>{p.label}:</b> <span className="whitespace-pre-line">{p.text}</span></li>)}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The conclusion: one numbered point per line when there are several. */
function Points({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim()).filter(Boolean);
  if (lines.length < 2) return <p className="whitespace-pre-line font-medium">{text}</p>;
  return <ol className="list-decimal space-y-0.5 pl-5 font-medium">{lines.map((l, i) => <li key={i}>{l}</li>)}</ol>;
}

/** The radiology report: the printed page and the online copy. */
export function RadiologyReportSheet({ report: r, qrUrl }: { report: RadiologyReport; qrUrl: string | null }) {
  const o = r.order;
  const structured = parseStructuredReport(o.structured_report);
  const template = structured ? ultrasoundTemplate(structured.template) : null;
  const narrative = structured?.narrative?.length ? structured.narrative : null;
  const sections = structured && template && !narrative
    ? reportSections(template, structured.values, { gender: r.patient.gender, reportDate: (o.reported_at ?? o.ordered_at).slice(0, 10) })
    : null;
  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-2">
        {r.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.logo} alt="" className="max-h-16 max-w-[28%] shrink-0 object-contain" />
        )}
        <div className={r.logo ? "mr-auto" : undefined}>
          <p className="text-xl font-bold leading-tight">{r.hospital.name}</p>
          <p className="text-xs text-neutral-600">Department of Radiology</p>
          {(r.hospital.address || r.hospital.phone) && <p className="text-xs text-neutral-600">{[r.hospital.address, r.hospital.phone].filter(Boolean).join(" · ")}</p>}
          {r.hospital.registration && <p className="text-xs text-neutral-500">Reg. {r.hospital.registration}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tracking-wide">{template ? "ULTRASOUND REPORT" : "RADIOLOGY REPORT"}</p>
          <p className="font-mono text-xs">Invoice / Order {o.order_no}</p>
          {r.episodeNo && <p className="font-mono text-xs">Visit {r.episodeNo}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-neutral-300 py-2 text-xs">
        <p><span className="text-neutral-500">Patient:</span> <b>{r.patient.name}</b></p>
        <p><span className="text-neutral-500">MR No:</span> <span className="font-mono">{r.patient.mrNo}</span></p>
        <p><span className="text-neutral-500">Age / Sex:</span> {[r.patient.age, r.patient.gender].filter(Boolean).join(" / ") || "—"}</p>
        <p><span className="text-neutral-500">Referred by:</span> {r.referringDoctor ?? "Self"}</p>
        <p><span className="text-neutral-500">Ordered:</span> {o.ordered_at.replace("T", " ").slice(0, 16)}</p>
        <p><span className="text-neutral-500">Reported:</span> {o.reported_at?.replace("T", " ").slice(0, 16) ?? "—"}</p>
      </div>
      {narrative && template
        ? <p className="mt-3 text-center text-[15px] font-bold tracking-wide text-[#0b2a6b] print:text-neutral-900">{narrativeTitle(template, r.patient.gender)}</p>
        : <p className="mt-3 text-base font-semibold">{o.modality}{o.body_part ? ` · ${o.body_part}` : ""}</p>}
      {narrative ? <Narrative paragraphs={narrative} /> : sections ? sections.map((s) => <Section key={s.title} s={s} />) : o.findings && (
        <div className="mt-2">
          <Heading>Findings</Heading>
          <p className="whitespace-pre-line">{o.findings}</p>
        </div>
      )}
      {narrative ? (
        <div className="break-inside-avoid">
          <GroupHeading>Impression</GroupHeading>
          <div className="mt-1 text-[12.5px]"><Points text={o.impression ?? ""} /></div>
        </div>
      ) : (
        <div className="mt-3 break-inside-avoid rounded border border-neutral-400 px-2.5 py-1.5">
          <Heading>{template ? "Conclusion" : "Impression"}</Heading>
          <p className="whitespace-pre-line font-medium">{o.impression}</p>
        </div>
      )}
      {structured?.recommendation && (
        <div className="mt-2 break-inside-avoid">
          <Heading>Recommendation</Heading>
          <p className="whitespace-pre-line">{structured.recommendation}</p>
        </div>
      )}
      {structured?.note && (
        <div className="mt-2 break-inside-avoid">
          <Heading>Note</Heading>
          <p className="whitespace-pre-line">{structured.note}</p>
        </div>
      )}
      <div className="mt-4 flex items-end justify-between gap-4 break-inside-avoid text-xs">
        <div>
          <p>Reported by <b>{o.radiologist ?? "—"}</b></p>
          <p className="text-neutral-500">Electronically generated report.</p>
        </div>
        {qrUrl && (
          <div className="flex items-center gap-2 text-right">
            <p className="max-w-[28mm] text-[10px] leading-tight text-neutral-600">Scan to view this report online</p>
            <div className="bg-white p-1 ring-1 ring-neutral-300"><QRCode value={qrUrl} size={64} style={{ width: 64, height: 64 }} viewBox="0 0 256 256" /></div>
          </div>
        )}
      </div>
    </>
  );
}
