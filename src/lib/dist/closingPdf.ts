/** The distributor's month-closing report as a PDF (A4), made in the browser:
 * a draft (stamped DRAFT) before closing, the final one after. */
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import type { dist } from "./index";

export type ClosingReport = Awaited<ReturnType<typeof dist.closeMonth>> & { closedAt?: string; closedBy?: string | null };

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const ink = rgb(0.1, 0.1, 0.1);
const soft = rgb(0.42, 0.42, 0.42);
const rule = rgb(0.85, 0.85, 0.85);
const rs = (n: number | null | undefined) => (n == null ? "—" : `Rs ${Number(n).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** Standard PDF fonts cover Latin-1 only: anything else is replaced. */
const safe = (s: unknown) => String(s ?? "").replace(/[^\x20-\x7E -ÿ]/g, "?");

export async function closingReportPdf(r: ClosingReport): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`${r.business} - month closing ${r.month}${r.draft ? " (draft)" : ""}`);
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;

  const stamp = (p: PDFPage) => {
    if (!r.draft) return;
    p.drawText("DRAFT", { x: 150, y: 330, size: 110, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(35) });
  };
  stamp(page);
  const ensure = (h: number) => {
    if (y - h >= M + 20) return;
    page = pdf.addPage(A4);
    stamp(page);
    y = A4[1] - M;
  };
  const text = (s: string, x: number, size = 9, f: PDFFont = font, color = ink) => page.drawText(safe(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, size = 9, f: PDFFont = font) => page.drawText(safe(s), { x: xRight - f.widthOfTextAtSize(safe(s), size), y, size, font: f, color: ink });
  /** Cuts text to fit a column width (with an ellipsis). */
  const fit = (v: string, w: number) => {
    let t = safe(v);
    if (font.widthOfTextAtSize(t, 8) <= w) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, 8) > w) t = t.slice(0, -1);
    return `${t}...`;
  };
  const line = () => page.drawLine({ start: { x: M, y: y + 4 }, end: { x: A4[0] - M, y: y + 4 }, thickness: 0.5, color: rule });

  // Heading
  text(r.business, M, 16, bold);
  y -= 20;
  text(`Month closing report: ${monthName(r.month)}`, M, 12, bold);
  right(r.draft ? "DRAFT (not closed)" : "FINAL", A4[0] - M, 10, bold);
  y -= 15;
  text(r.draft ? `Draft made ${r.generatedAt.slice(0, 16).replace("T", " ")} by ${r.generatedBy ?? ""}` : `Closed ${(r.closedAt ?? r.generatedAt).slice(0, 16).replace("T", " ")} by ${r.closedBy ?? r.generatedBy ?? ""}`, M, 8, font, soft);
  y -= 22;

  const section = (title: string) => {
    ensure(40);
    text(title, M, 11, bold);
    y -= 6;
    line();
    y -= 12;
  };
  const kv = (rows: [string, string, boolean?][]) => {
    for (const [k, v, strong] of rows) {
      ensure(14);
      text(k, M, 9, strong ? bold : font);
      right(v, A4[0] - M, 9, strong ? bold : font);
      y -= 14;
    }
    y -= 6;
  };
  const table = (cols: { h: string; w: number; right?: boolean }[], rows: string[][], totals?: string[]) => {
    const xs: number[] = [];
    let x = M;
    for (const c of cols) { xs.push(x); x += c.w; }
    const head = () => {
      ensure(30);
      cols.forEach((c, i) => (c.right ? right(c.h, xs[i] + c.w - 4, 8, bold) : text(c.h, xs[i], 8, bold)));
      y -= 4;
      line();
      y -= 10;
    };
    head();
    for (const row of rows) {
      if (y - 12 < M + 20) { ensure(1000); head(); }
      row.forEach((v, i) => (cols[i].right ? right(v, xs[i] + cols[i].w - 4, 8) : text(fit(v, cols[i].w - 4), xs[i], 8)));
      y -= 12;
    }
    if (totals) {
      y -= 2;
      line();
      y -= 10;
      totals.forEach((v, i) => v && (cols[i].right ? right(v, xs[i] + cols[i].w - 4, 8, bold) : text(v, xs[i], 8, bold)));
      y -= 14;
    }
    y -= 8;
  };

  const s = r.sales;
  section("Sales and profit");
  kv([
    ["Invoices", String(s.invoices)],
    ["Sales", rs(s.sales)],
    ["Returns", rs(-s.returns)],
    ["Net sales", rs(s.net), true],
    ["Gross profit", `${rs(s.grossProfit)}  (margin ${s.marginPct.toFixed(1)} %)`],
    ["Withholding tax collected (236G / 236H)", rs(s.wht)],
    ["Collected from customers", rs(s.collected)],
    ["Purchases", rs(s.purchases)],
  ]);

  section("Salaries");
  if (r.salaries.length) {
    table(
      [{ h: "Salesman", w: 130 }, { h: "Code", w: 45 }, { h: "Wage", w: 50 }, { h: "Rate", w: 72, right: true }, { h: "Days", w: 35, right: true }, { h: "Amount", w: 85, right: true }, { h: "", w: 12 }, { h: "Status", w: 86 }],
      r.salaries.map((x) => [x.name, x.code, x.wage_type, rs(x.rate), x.days == null ? "" : String(x.days), rs(x.amount), "", x.status === "paid" ? `paid ${x.paid_on ?? ""}`.trim() : "unpaid"]),
      ["Total", "", "", "", "", rs(r.salariesTotal), "", ""],
    );
    kv([["Paid", rs(r.salariesPaid)], ["Unpaid (payable)", rs(r.salariesUnpaid)]]);
  } else {
    text("No salaries this month.", M, 9, font, soft);
    y -= 18;
  }

  section("Result");
  kv([
    ["Gross profit", rs(s.grossProfit)],
    ["Salaries", rs(-r.salariesTotal)],
    ["Other expenses", rs(-r.otherExpenses)],
    ["Net profit", rs(r.netProfit), true],
    ["Customers owe you (end of report)", rs(r.receivable)],
    ["You owe suppliers (end of report)", rs(r.payable)],
  ]);

  if (r.targets.length) {
    section("Salesmen against target");
    table(
      [{ h: "Salesman", w: 160 }, { h: "Target", w: 95, right: true }, { h: "Achieved", w: 95, right: true }, { h: "%", w: 60, right: true }, { h: "", w: 15 }, { h: "Status", w: 90 }],
      r.targets.map((t) => [t.name, rs(t.target), rs(t.achieved), t.target > 0 ? `${t.pct.toFixed(1)} %` : "-", "", t.target > 0 ? t.status.replace("_", " ") : "no target"]),
    );
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(safe(`${r.business} · ${r.month} · page ${i + 1} of ${pages.length}`), { x: M, y: 22, size: 7, font, color: soft }));
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/** Saves the report as a PDF file. */
export async function downloadClosingPdf(r: ClosingReport) {
  const blob = await closingReportPdf(r);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `month-closing-${r.month}${r.draft ? "-draft" : ""}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
