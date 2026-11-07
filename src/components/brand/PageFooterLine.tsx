import { PoweredByFooter } from "./PoweredByFooter";

/** Reports: "Powered by MAVIN.pk — Aap Key Business Ka معاون · For your معاون +923160585858"
 * in one small line at the very bottom of every printed page.
 *
 * The report goes inside one table whose (empty) footer row repeats at the foot
 * of every printed page, keeping a strip free; the line is fixed into that strip
 * (fixed elements print on each page). On screen it is one line under the report. */
export function ReportWithFooterLine({ children }: { children: React.ReactNode }) {
  return (
    <>
      <table className="w-full border-collapse">
        {/* The whole report is this one row: it must be free to continue on the next page. */}
        <tbody><tr style={{ breakInside: "auto", pageBreakInside: "auto" }}><td className="p-0 align-top">{children}</td></tr></tbody>
        <tfoot className="hidden print:table-footer-group"><tr><td className="p-0" style={{ height: "6mm" }} /></tr></tfoot>
      </table>
      <div className="mt-3 print:hidden"><FooterLine /></div>
      <div className="hidden print:fixed print:inset-x-0 print:bottom-0 print:block"><FooterLine /></div>
    </>
  );
}

function FooterLine() {
  const img = (src: string, alt: string, w: number, h: number, cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={w} height={h} loading="eager" className={`inline-block w-auto object-contain ${cls}`} />
  );
  return (
    <p className="flex items-center justify-center gap-x-1 whitespace-nowrap text-center text-[8px] font-bold leading-none text-black">
      Powered by {img("/mavin-header.png", "MAVIN.pk", 1405, 361, "h-3")}
      <span>— Aap Key Business Ka</span> {img("/muawin-logo.png", "معاون", 800, 322, "h-3.5")}
      <span>· For your</span> {img("/muawin-logo.png", "معاون", 800, 322, "h-3.5")}
      <span className="tabular-nums">+923160585858</span>
    </p>
  );
}

/** Invoices and bills: thermal receipts end with the two-line footer; A4 / A5 pages
 * get the one-line footer at the very bottom of every page (like reports). */
export function PrintFooterFrame({ thermal, children }: { thermal: boolean; children: React.ReactNode }) {
  return thermal ? <>{children}<PoweredByFooter /></> : <ReportWithFooterLine>{children}</ReportWithFooterLine>;
}
