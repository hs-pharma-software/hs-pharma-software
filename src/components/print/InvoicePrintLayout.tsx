"use client";

import QRCode from "react-qr-code";
import {
  DEVELOPER_CREDIT,
  PAPERS,
  type BlockConfig,
  type BlockId,
  type PrintTemplate,
} from "@/lib/printTemplates";

export interface PrintItem {
  id: string;
  name: string;
  batch: string | null;
  qty: string;
  bonus: string | null;
  price: number;
  discountPct: number;
  total: number;
}

export interface PrintData {
  business: { name: string; address: string | null; phone: string | null; ntn: string | null };
  logo: string | null;
  /** "INVOICE", "RECEIPT", "RETURN"... */
  title: string;
  number: string;
  returnOf: string | null;
  date: string;
  payment: string;
  invoiceType: string | null;
  salesman: string | null;
  customer: { name: string; phone: string | null; ntn: string | null; address: string | null };
  items: PrintItem[];
  totals: { total: number; charges: number; discount: number; payable: number; paid: number; balance: number };
  note: string | null;
  fbrInvoiceNo: string | null;
}

export interface EditorHooks {
  selected: BlockId | null;
  onSelect: (id: BlockId) => void;
  onDragStart: (id: BlockId) => void;
  onDropOn: (id: BlockId) => void;
}

const BASE_PX: Record<PrintTemplate["paper"], number> = { a4: 13, a5: 11, thermal: 11 };
const SIZE_SCALE = { sm: 0.85, md: 1, lg: 1.35 };
const money = (n: number) => n.toFixed(2);

/** Renders an invoice from a print template. Used for both the template
 * editor preview (with `editor` hooks) and real printing. */
export function InvoicePrintLayout({
  template,
  data,
  editor,
}: {
  template: PrintTemplate;
  data: PrintData;
  editor?: EditorHooks;
}) {
  const paper = PAPERS.find((p) => p.id === template.paper)!;
  const contentMm = paper.widthMm - paper.marginMm * 2;
  const base = BASE_PX[template.paper];
  const thermal = template.paper === "thermal";

  const font = (blk: BlockConfig) => ({ fontSize: `${(base * SIZE_SCALE[blk.size]).toFixed(1)}px` });
  const justify = (a: BlockConfig["align"]) => (a === "center" ? "center" : a === "right" ? "flex-end" : "flex-start");

  function renderBlock(blk: BlockConfig) {
    switch (blk.id) {
      case "logo":
        return data.logo ? (
          <div style={{ display: "flex", justifyContent: justify(blk.align) }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.logo} alt="" style={{ height: template.logoHeight, maxWidth: "100%", objectFit: "contain" }} />
          </div>
        ) : editor ? (
          <div style={{ textAlign: blk.align }} className="text-[11px] text-neutral-400">[ Logo - upload one above ]</div>
        ) : null;
      case "business":
        return (
          <div style={{ textAlign: blk.align, ...font(blk) }}>
            <div style={{ fontWeight: 700, fontSize: "1.25em" }}>{data.business.name}</div>
            {data.business.address && <div>{data.business.address}</div>}
            {data.business.phone && <div>Ph: {data.business.phone}</div>}
            {data.business.ntn && <div>NTN: {data.business.ntn}</div>}
          </div>
        );
      case "title":
        return (
          <div style={{ textAlign: blk.align, ...font(blk) }}>
            <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>{data.title}</span> {data.number}
            {data.returnOf && <div style={{ fontSize: "0.85em" }}>Return of Bill {data.returnOf}</div>}
          </div>
        );
      case "meta":
        return (
          <div style={{ textAlign: blk.align, ...font(blk) }}>
            <div>Date: {data.date}</div>
            <div>
              {data.payment}
              {data.invoiceType ? ` · ${data.invoiceType}` : ""}
            </div>
            {data.salesman && <div>Salesman: {data.salesman}</div>}
          </div>
        );
      case "customer":
        return (
          <div style={{ textAlign: blk.align, ...font(blk) }}>
            <div><b>Customer:</b> {data.customer.name}</div>
            {data.customer.phone && <div><b>Mobile:</b> {data.customer.phone}</div>}
            {data.customer.ntn && <div><b>NTN/CNIC:</b> {data.customer.ntn}</div>}
            {data.customer.address && <div><b>Address:</b> {data.customer.address}</div>}
          </div>
        );
      case "items":
        return thermal ? (
          <div style={{ ...font(blk), borderTop: "1px solid #999" }}>
            {data.items.map((it) => (
              <div key={it.id} style={{ borderBottom: "1px dashed #ccc", padding: "2px 0" }}>
                <div style={{ fontWeight: 600 }}>{it.name}</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>
                    {it.qty}
                    {template.columns.bonus && it.bonus ? ` +${it.bonus} free` : ""}
                    {template.columns.batch && it.batch ? ` (${it.batch})` : ""}
                  </span>
                  <span>
                    {money(it.price)} = <b>{money(it.total)}</b>
                  </span>
                </div>
                {template.columns.discount && it.discountPct > 0 && <div>Disc: {it.discountPct}%</div>}
              </div>
            ))}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", ...font(blk) }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #999", textAlign: "left" }}>
                <th style={{ padding: "3px 4px 3px 0" }}>Product</th>
                {template.columns.batch && <th style={{ padding: "3px 4px" }}>Batch</th>}
                <th style={{ padding: "3px 4px", textAlign: "right" }}>Qty</th>
                {template.columns.bonus && <th style={{ padding: "3px 4px", textAlign: "right" }}>Bonus</th>}
                <th style={{ padding: "3px 4px", textAlign: "right" }}>Price</th>
                {template.columns.discount && <th style={{ padding: "3px 4px", textAlign: "right" }}>Disc</th>}
                <th style={{ padding: "3px 0 3px 4px", textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "3px 4px 3px 0" }}>{it.name}</td>
                  {template.columns.batch && <td style={{ padding: "3px 4px" }}>{it.batch ?? "-"}</td>}
                  <td style={{ padding: "3px 4px", textAlign: "right" }}>{it.qty}</td>
                  {template.columns.bonus && <td style={{ padding: "3px 4px", textAlign: "right" }}>{it.bonus ?? "-"}</td>}
                  <td style={{ padding: "3px 4px", textAlign: "right" }}>{money(it.price)}</td>
                  {template.columns.discount && (
                    <td style={{ padding: "3px 4px", textAlign: "right" }}>{it.discountPct ? `${it.discountPct}%` : "-"}</td>
                  )}
                  <td style={{ padding: "3px 0 3px 4px", textAlign: "right" }}>{money(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case "totals": {
        const t = data.totals;
        const row = (label: string, value: string, strong = false) => (
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: strong ? 700 : 400 }}>
            <span>{label}</span>
            <span>{value}</span>
          </div>
        );
        return (
          <div style={{ display: "flex", justifyContent: justify(blk.align) }}>
            <div style={{ width: thermal ? "100%" : "55%", ...font(blk) }}>
              {row("Total", money(t.total))}
              {t.charges > 0 && row("Charges", money(t.charges))}
              {t.discount > 0 && row("Discount", `-${money(t.discount)}`)}
              <div style={{ borderTop: "1px solid #999", marginTop: 2, paddingTop: 2 }}>{row("Payable", money(t.payable), true)}</div>
              {row("Paid", money(t.paid))}
              {row("Balance", money(t.balance), true)}
            </div>
          </div>
        );
      }
      case "note":
        return data.note ? <div style={{ textAlign: blk.align, ...font(blk) }}>Note: {data.note}</div> : null;
      case "fbr":
        return data.fbrInvoiceNo ? (
          <div
            style={{
              display: "flex",
              flexDirection: thermal || blk.align === "center" ? "column" : "row",
              alignItems: blk.align === "center" || thermal ? "center" : "flex-start",
              justifyContent: blk.align === "right" ? "flex-end" : "space-between",
              gap: 8,
              ...font(blk),
            }}
          >
            <div style={{ textAlign: thermal || blk.align === "center" ? "center" : "left" }}>
              <span style={{ background: "#006633", color: "#fff", fontWeight: 700, fontSize: "0.75em", padding: "1px 6px", borderRadius: 4 }}>
                FBR Digital Invoice
              </span>
              <div style={{ marginTop: 2 }}>
                FBR Invoice No: <b>{data.fbrInvoiceNo}</b>
              </div>
              <div style={{ fontSize: "0.8em", color: "#666" }}>Scan QR to verify at FBR portal</div>
            </div>
            <QRCode value={data.fbrInvoiceNo} size={thermal ? 72 : 80} style={{ width: thermal ? 72 : 80, height: "auto" }} viewBox="0 0 256 256" />
          </div>
        ) : null;
      case "thanks":
        return template.thanksText ? (
          <div style={{ textAlign: blk.align, ...font(blk), borderTop: thermal ? "1px dashed #999" : undefined, paddingTop: 2 }}>
            {template.thanksText}
          </div>
        ) : null;
    }
  }

  return (
    <div style={{ width: `${contentMm}mm`, color: "#111", fontFamily: "Arial, Helvetica, sans-serif", lineHeight: 1.35 }}>
      <style>{`@media print { @page { size: ${paper.css}; margin: ${paper.marginMm}mm; } }`}</style>
      {template.blocks
        .filter((blk) => blk.visible)
        .map((blk) => {
          const content = renderBlock(blk);
          if (!editor) return content ? <div key={blk.id} style={{ marginBottom: 6 }}>{content}</div> : null;
          const isSel = editor.selected === blk.id;
          return (
            <div
              key={blk.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                editor.onDragStart(blk.id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                editor.onDropOn(blk.id);
              }}
              onClick={() => editor.onSelect(blk.id)}
              title="Drag to move, click to edit"
              style={{ marginBottom: 6, cursor: "grab" }}
              className={`rounded outline-dashed outline-1 outline-offset-2 ${isSel ? "outline-[#006633] bg-[#006633]/[0.04]" : "outline-transparent hover:outline-neutral-300"}`}
            >
              {content ?? <div className="text-[11px] text-neutral-300">[ {blk.id} - nothing to show in this sample ]</div>}
            </div>
          );
        })}
      <div style={{ marginTop: 10, borderTop: "1px solid #ddd", paddingTop: 3, textAlign: "center", fontSize: `${Math.max(8, base - 3)}px`, color: "#777" }}>
        {DEVELOPER_CREDIT}
      </div>
    </div>
  );
}
