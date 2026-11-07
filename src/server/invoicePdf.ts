/** Invoice PDF and WhatsApp sharing (web, phone browsers, the installed app).
 *
 *  - Allowed only when the Super Admin switched the feature on for the business
 *    ("+invoice.pdf" / "+invoice.whatsapp", lib/tenantFeatures.ts), the login has
 *    it (owner: always; staff: unless the owner took it away) and the login has
 *    the Invoices section. Checked here on every request, not only in the app.
 *  - The invoice must be this business's and in a branch the login may open.
 *  - The PDF is built from the invoice as saved (lines, discounts, tax, totals,
 *    payments, FBR number): nothing is recalculated from today's prices.
 *  - Every download, share preparation and WhatsApp hand-off is written to the
 *    audit log (who, business, branch, invoice, when) without customer details.
 *    Nothing here sends a message: WhatsApp is opened by the person. */
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import qrcode from "qrcode-generator";
import type { Sql } from "./subSupers";
import { callerCan, type Caller } from "./sqlPolicy";
import { HttpError } from "./db";
import { branchScopeFor } from "./branches";

export type ShareAction = "pdf" | "whatsapp";

const ACTION: Record<ShareAction, string> = { pdf: "invoice.pdf", whatsapp: "invoice.whatsapp" };
const DENIED: Record<ShareAction, string> = {
  pdf: "Invoice PDF download is not enabled for your login or business.",
  whatsapp: "Sending invoices on WhatsApp is not enabled for your login or business.",
};

export interface InvoiceForShare {
  id: string; tenantId: string; branchId: string | null; no: number | null; date: string; isReturn: boolean;
  payable: number; customerName: string; customerPhone: string | null; businessName: string;
}

/** Permission, ownership and branch checks; the invoice's basic details. */
export async function authorizeInvoice(sql: Sql, caller: Caller, invoiceId: string, action: ShareAction, branchHeader: string | null): Promise<InvoiceForShare> {
  if (caller.role === "super_admin" || !caller.tenantId) throw new HttpError(403, "Open the invoice from the business's login.");
  if (!callerCan(caller, ACTION[action])) throw new HttpError(403, DENIED[action]);
  if (caller.role === "staff" && Array.isArray(caller.permissions) && !caller.permissions.includes("invoices")) {
    throw new HttpError(403, "Your login does not have the Invoices section.");
  }
  if (!invoiceId) throw new HttpError(400, "Which invoice?");
  const r = (await sql.execute(
    `SELECT i.id, i.tenant_id, i.branch_id, i.invoice_no, i.date, i.is_return, i.payable, i.customer_phone,
            COALESCE(NULLIF(i.customer_name, ''), c.name, 'Walk-in') AS customer_name, t.name AS tenant_name
     FROM invoices i JOIN tenants t ON t.id = i.tenant_id LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = ? AND i.tenant_id = ? AND i.deleted_at IS NULL AND COALESCE(i.is_quotation, 0) = 0`,
    [invoiceId, caller.tenantId],
  )).rows[0];
  if (!r) throw new HttpError(404, "Invoice not found.");
  // Branch: the invoice must be in a branch this login may open (unassigned rows belong to the main branch).
  const scope = await branchScopeFor(sql, caller, branchHeader);
  if (scope) {
    const b = r.branch_id == null ? scope.mainId : String(r.branch_id);
    if (!scope.accessible.includes(b)) throw new HttpError(404, "Invoice not found.");
  }
  const printName = await setting(sql, caller.tenantId, "company_print_name");
  const showName = (await setting(sql, caller.tenantId, "company_show_name")) !== "false";
  return {
    id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id == null ? null : String(r.branch_id),
    no: r.invoice_no == null ? null : Number(r.invoice_no), date: String(r.date), isReturn: Number(r.is_return) === 1,
    payable: Number(r.payable) || 0, customerName: String(r.customer_name), customerPhone: (r.customer_phone as string | null) || null,
    businessName: (showName && printName?.trim()) || String(r.tenant_name),
  };
}

async function setting(sql: Sql, tenantId: string, key: string): Promise<string | null> {
  const r = (await sql.execute(`SELECT value FROM settings WHERE key = ?`, [`${tenantId}::${key}`])).rows[0];
  return r?.value == null ? null : String(r.value);
}

/** One line in the audit log: who, which business, branch and invoice, when (no customer data, no file). */
export async function auditShare(sql: Sql, caller: Caller, inv: InvoiceForShare, verb: string, ip: string | null): Promise<void> {
  await sql.execute(
    `INSERT INTO server_audit_log (id, user_id, tenant_id, role, verb, tables, statement, ip, created_at) VALUES (?, ?, ?, ?, ?, 'invoices', ?, ?, ?)`,
    [randomUUID(), caller.userId, caller.tenantId, caller.role, verb, `invoice=${inv.id} no=${inv.no ?? ""} branch=${inv.branchId ?? "main"}`, ip, new Date().toISOString()],
  ).catch(() => undefined); // the log never blocks the person's action
}

/** The short default WhatsApp text: no products, medicines or other details. */
export function shareMessage(inv: InvoiceForShare): string {
  const total = inv.payable.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Dear customer, your ${inv.isReturn ? "return invoice" : "invoice"} #${inv.no ?? ""} from ${inv.businessName} is ready. Total: PKR ${total}. Thank you.`;
}

/** "Invoice-123.pdf" (only safe characters). */
export const pdfFileName = (inv: Pick<InvoiceForShare, "no" | "id">) => `Invoice-${String(inv.no ?? inv.id.slice(0, 8)).replace(/[^\w-]/g, "")}.pdf`;

// ── The PDF ───────────────────────────────────────────────────────────────

/** Standard PDF fonts cover Latin text; other scripts (Urdu) print as "?" (the printed invoice keeps them). */
const safe = (s: unknown) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
const money = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2));

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      // A single word longer than the column is cut.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let i = w.length;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

async function embedDataUrl(doc: PDFDocument, dataUrl: string | null): Promise<PDFImage | null> {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2], "base64");
    return /png/i.test(m[1]) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch { return null; }
}

async function embedUrl(doc: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await doc.embedPng(new Uint8Array(await res.arrayBuffer()));
  } catch { return null; }
}

/** The invoice as a real A4 PDF. `origin` serves the MAVIN.pk footer images. */
export async function buildInvoicePdf(sql: Sql, inv: InvoiceForShare, origin: string): Promise<Uint8Array> {
  const t = inv.tenantId;
  const head = (await sql.execute(
    `SELECT i.*, s.name AS salesman_name, o.invoice_no AS original_no FROM invoices i
     LEFT JOIN salesmen s ON s.id = i.salesman_id LEFT JOIN invoices o ON o.id = i.original_invoice_id
     WHERE i.id = ? AND i.tenant_id = ?`, [inv.id, t])).rows[0];
  if (!head) throw new HttpError(404, "Invoice not found.");
  const items = (await sql.execute(
    `SELECT ii.*, p.name AS product_name, COALESCE(p.packing, 1) AS packing, p.secondary_unit_id, su.name AS secondary_unit_name
     FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id AND (p.tenant_id = ii.tenant_id OR p.tenant_id IS NULL)
     LEFT JOIN uoms su ON su.id = p.secondary_unit_id
     WHERE ii.invoice_id = ? AND ii.tenant_id = ? AND ii.deleted_at IS NULL ORDER BY ii.created_at, ii.id`, [inv.id, t])).rows;
  const tenant = (await sql.execute(`SELECT name, address, phone FROM tenants WHERE id = ?`, [t])).rows[0] ?? {};
  const keys = ["company_address", "company_contact", "company_ntn", "company_stn", "company_pra", "company_numbers", "print_logo"];
  const sv = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await setting(sql, t, k)] as const)));
  let branch: Record<string, unknown> | undefined;
  try {
    const all = (await sql.execute(`SELECT id, name, code, address, phone, is_main FROM branches WHERE tenant_id = ?`, [t])).rows;
    if (all.length > 1) branch = all.find((b) => b.id === (inv.branchId ?? `main-${t}`)) ?? all.find((b) => Number(b.is_main) === 1);
  } catch { /* before multi-branch */ }

  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.no ?? ""}`);
  doc.setProducer("MAVIN.pk");
  doc.setCreator("MAVIN.pk");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedDataUrl(doc, sv.print_logo ?? null);
  const [mavin, muawin] = await Promise.all([embedUrl(doc, `${origin}/mavin-header.png`), embedUrl(doc, `${origin}/muawin-logo.png`)]);

  const W = 595.28, H = 841.89, M = 36, FOOT = 34;
  const ink = rgb(0.07, 0.07, 0.07), grey = rgb(0.42, 0.42, 0.42), line = rgb(0.82, 0.82, 0.82), band = rgb(0.95, 0.95, 0.95);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M;
    // Later pages say whose invoice they continue.
    if (pages.length > 1) {
      text(`${inv.businessName} - ${inv.isReturn ? "Return invoice" : "Invoice"} No. ${inv.no ?? "-"} (continued)`, M, y - 2, 8.5, bold, grey);
      y -= 16;
    }
  };
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = ink) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xr: number, yy: number, size = 9, f: PDFFont = font, color = ink) => text(s, xr - f.widthOfTextAtSize(safe(s), size), yy, size, f, color);
  newPage();

  // Header: logo, business, registration numbers; title and number on the right.
  let left = M;
  if (logo) {
    const s = Math.min(56 / logo.height, 120 / logo.width);
    page.drawImage(logo, { x: M, y: y - logo.height * s, width: logo.width * s, height: logo.height * s });
    left = M + logo.width * s + 10;
  }
  let hy = y - 12;
  text(inv.businessName, left, hy, 14, bold); hy -= 13;
  const address = sv.company_address || (tenant.address as string) || "";
  for (const l of wrap(address, font, 8.5, 300)) { if (!l) continue; text(l, left, hy, 8.5, font, grey); hy -= 10; }
  const contact = sv.company_contact || (tenant.phone as string) || "";
  if (contact) { text(contact, left, hy, 8.5, font, grey); hy -= 10; }
  const regs = [sv.company_ntn && `NTN: ${sv.company_ntn}`, sv.company_stn && `STN: ${sv.company_stn}`, sv.company_pra && `PRA: ${sv.company_pra}`];
  try { for (const n of JSON.parse(sv.company_numbers || "[]") as { label: string; value: string }[]) regs.push(`${n.label}: ${n.value}`); } catch { /* none */ }
  const regLine = regs.filter(Boolean).join("   ");
  if (regLine) { for (const l of wrap(regLine, font, 8, 300)) { text(l, left, hy, 8, font, grey); hy -= 10; } }
  if (branch) { text(`Branch: ${branch.name} (${branch.code})${branch.address ? `, ${branch.address}` : ""}`, left, hy, 8, font, grey); hy -= 10; }
  const title = inv.isReturn ? "RETURN INVOICE" : "INVOICE";
  right(title, W - M, y - 14, 16, bold);
  right(`No. ${inv.no ?? "-"}`, W - M, y - 30, 10, bold);
  right(`Date: ${String(head.date).slice(0, 10)}`, W - M, y - 43, 9);
  right(`Payment: ${head.inv_on === "credit" ? "Credit" : "Cash"}`, W - M, y - 55, 9);
  if (inv.isReturn && head.original_no != null) right(`Return of #${head.original_no}`, W - M, y - 67, 9);
  y = Math.min(hy, y - 72) - 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: ink });
  y -= 14;

  // Customer.
  text("Bill to", M, y, 8, bold, grey);
  if (head.salesman_name) right(`Salesman: ${head.salesman_name}`, W - M, y, 8.5, font, grey);
  y -= 12;
  text(inv.customerName, M, y, 10, bold); y -= 11;
  const cust = [head.customer_phone, head.buyer_ntn_cnic && `NTN/CNIC: ${head.buyer_ntn_cnic}`].filter(Boolean).join("   ");
  if (cust) { text(String(cust), M, y, 8.5, font, grey); y -= 10; }
  if (head.buyer_address) { for (const l of wrap(`${head.buyer_address}${head.buyer_province ? `, ${head.buyer_province}` : ""}`, font, 8.5, W - 2 * M)) { text(l, M, y, 8.5, font, grey); y -= 10; } }
  y -= 8;

  // Lines, as saved (a line sold in the secondary unit is shown in that unit).
  const rows = items.map((it, i) => {
    const packing = Number(it.packing) || 1;
    const q = Number(it.qty) || 0, bonus = Number(it.bonus_qty) || 0;
    const frac = !!it.secondary_unit_id && packing > 1 && Math.abs(q - Math.round(q)) > 0.001;
    const unit = frac && it.secondary_unit_name ? ` ${it.secondary_unit_name}` : "";
    const qty = frac ? q * packing : q, bq = frac ? bonus * packing : bonus;
    return {
      n: String(i + 1),
      name: String(it.product_name ?? "Item"),
      batch: head.invoice_type === "general" ? "" : String(it.line_batch || it.batch_no || ""),
      qty: `${qtyText(qty)}${unit}${bq > 0 ? ` +${qtyText(bq)}` : ""}`,
      price: money(frac ? Number(it.sale_price) / packing : Number(it.sale_price)),
      disc: Number(it.discount_pct) ? `${qtyText(Number(it.discount_pct))}%` : "",
      tax: Number(it.tax_rs) ? money(Number(it.tax_rs)) : "",
      total: money(Number(it.total)),
    };
  });
  const showBatch = rows.some((r) => r.batch);
  type Col = { key: keyof (typeof rows)[number]; label: string; w: number; align: "l" | "r" };
  const fixed: Col[] = [
    { key: "n", label: "#", w: 20, align: "l" },
    ...(showBatch ? [{ key: "batch", label: "Batch", w: 62, align: "l" } as Col] : []),
    { key: "qty", label: "Qty", w: 58, align: "r" },
    { key: "price", label: "Price", w: 62, align: "r" },
    { key: "disc", label: "Disc", w: 36, align: "r" },
    { key: "tax", label: "Tax", w: 50, align: "r" },
    { key: "total", label: "Amount", w: 70, align: "r" },
  ];
  const itemW = W - 2 * M - fixed.reduce((s, c) => s + c.w, 0);
  const cols: Col[] = [fixed[0], { key: "name", label: "Item", w: itemW, align: "l" }, ...fixed.slice(1)];
  const drawHead = () => {
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 16, color: band });
    let x = M;
    for (const c of cols) { if (c.align === "r") right(c.label, x + c.w - 3, y, 8.5, bold); else text(c.label, x + 3, y, 8.5, bold); x += c.w; }
    y -= 16;
  };
  drawHead();
  for (const r of rows) {
    const nameLines = wrap(r.name, font, 8.5, itemW - 6);
    const batchLines = showBatch ? wrap(r.batch, font, 8, 56) : [""];
    const h = Math.max(nameLines.length, batchLines.length) * 10 + 4;
    if (y - h < M + FOOT + 10) { newPage(); drawHead(); }
    let x = M;
    for (const c of cols) {
      if (c.key === "name") nameLines.forEach((l, i) => text(l, x + 3, y - i * 10, 8.5));
      else if (c.key === "batch") batchLines.forEach((l, i) => text(l, x + 3, y - i * 10, 8, font, grey));
      else if (c.align === "r") right(r[c.key], x + c.w - 3, y, 8.5);
      else text(r[c.key], x + 3, y, 8.5);
      x += c.w;
    }
    y -= h;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.4, color: line });
  }
  if (!rows.length) { text("No items.", M + 3, y, 9, font, grey); y -= 14; }

  // Totals (as saved): payable = total - discounts + tax + charges.
  const lineDisc = items.reduce((s, i) => s + (Number(i.discount_rs) || 0), 0);
  const tax = items.reduce((s, i) => s + (Number(i.tax_rs) || 0), 0);
  const totals: [string, number, boolean][] = [
    ["Total", Number(head.total) || 0, false],
    ...(lineDisc + (Number(head.discount_rs) || 0) ? [["Discount", lineDisc + (Number(head.discount_rs) || 0), false] as [string, number, boolean]] : []),
    ...(tax ? [["Sales tax", tax, false] as [string, number, boolean]] : []),
    ...(Number(head.charges) ? [["Charges", Number(head.charges), false] as [string, number, boolean]] : []),
    ["Payable", Number(head.payable) || 0, true],
    ["Paid", Number(head.paid) || 0, false],
    ["Balance", Number(head.balance) || 0, true],
  ];
  const fbrNo = head.fbr_invoice_no ? String(head.fbr_invoice_no) : null;
  const need = totals.length * 14 + 10 + (fbrNo ? 0 : 0);
  if (y - need < M + FOOT + 10) newPage();
  y -= 4;
  const ty = y;
  for (const [label, value, strong] of totals) {
    text(label, W - M - 190, y, 9.5, strong ? bold : font);
    right(`Rs ${money(value)}`, W - M, y, 9.5, strong ? bold : font);
    y -= 14;
  }
  // FBR number and QR (only when the invoice was reported to FBR).
  if (fbrNo) {
    const qr = qrcode(0, "M");
    qr.addData(fbrNo);
    qr.make();
    const n = qr.getModuleCount(), size = 72, cell = size / n, qx = M, qy = ty - size + 8;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) page.drawRectangle({ x: qx + c * cell, y: qy + (n - 1 - r) * cell, width: cell + 0.05, height: cell + 0.05, color: ink });
    text("FBR Invoice No.", qx + size + 8, ty, 8, bold, grey);
    for (const [i, l] of wrap(fbrNo, font, 8.5, 170).entries()) text(l, qx + size + 8, ty - 11 - i * 10, 8.5);
    y = Math.min(y, qy - 8);
  }
  if (head.description) {
    const ls = wrap(`Note: ${head.description}`, font, 8.5, W - 2 * M);
    if (y - ls.length * 10 < M + FOOT + 10) newPage();
    y -= 6;
    for (const l of ls) { text(l, M, y, 8.5, font, grey); y -= 10; }
  }

  // Every page: MAVIN.pk line and page number.
  pages.forEach((p, i) => {
    page = p;
    const fy = M - 8;
    page.drawLine({ start: { x: M, y: fy + 16 }, end: { x: W - M, y: fy + 16 }, thickness: 0.5, color: line });
    let x = M;
    const put = (s: string, f: PDFFont = bold) => { text(s, x, fy, 7.5, f, ink); x += f.widthOfTextAtSize(safe(s), 7.5) + 3; };
    const img = (im: PDFImage | null, h: number, alt: string) => {
      if (!im) return put(alt);
      const w = (im.width / im.height) * h;
      page.drawImage(im, { x, y: fy - 3, width: w, height: h });
      x += w + 3;
    };
    put("Powered by");
    img(mavin, 10, "MAVIN.pk");
    put("- Aap Key Business Ka");
    img(muawin, 12, "Muawin");
    put("- For your");
    img(muawin, 12, "Muawin");
    put("+923160585858");
    right(`Page ${i + 1} of ${pages.length}`, W - M, fy, 7.5, font, grey);
  });
  return doc.save();
}
