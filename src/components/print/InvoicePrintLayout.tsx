"use client";

import type { CSSProperties } from "react";
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

/** #rrggbb + alpha -> rgba(), for tinted rows and boxes. */
function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Renders an invoice from a print template. Used for both the template
 * editor preview (with `editor` hooks) and real printing. A4 / A5 use the
 * template's colour theme; thermal always prints black. */
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
  const style = thermal ? "plain" : template.theme?.style ?? "plain";
  const banner = style === "banner";
  const colored = style !== "plain";
  const primary = template.theme?.primary ?? "#111111";
  const accent = template.theme?.accent ?? "#999999";

  const font = (blk: BlockConfig) => ({ fontSize: `${(base * SIZE_SCALE[blk.size]).toFixed(1)}px` });
  const justify = (a: BlockConfig["align"]) => (a === "center" ? "center" : a === "right" ? "flex-end" : "flex-start");
  // Label colour inside coloured designs.
  const label: CSSProperties = colored ? { color: primary, fontWeight: 700 } : { fontWeight: 700 };
  // Side rule used by the info blocks (meta, customer).
  const infoBox = (blk: BlockConfig): CSSProperties =>
    colored
      ? {
          [blk.align === "right" ? "borderRight" : "borderLeft"]: `3px solid ${accent}`,
          padding: blk.align === "right" ? "2px 8px 2px 0" : "2px 0 2px 8px",
        }
      : {};

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
      case "business": {
        const sub: CSSProperties = { fontSize: blk.size === "lg" ? "0.72em" : "0.9em", opacity: banner ? 0.92 : 1 };
        return (
          <div
            style={{
              textAlign: blk.align,
              ...font(blk),
              ...(banner
                ? {
                    background: primary,
                    color: "#fff",
                    padding: "10px 14px",
                    borderRadius: 6,
                    borderBottom: `4px solid ${accent}`,
                  }
                : colored
                  ? { borderBottom: `2px solid ${accent}`, paddingBottom: 4 }
                  : {}),
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "1.25em", color: banner ? "#fff" : colored ? primary : undefined }}>
              {data.business.name}
            </div>
            {/* Contact lines stay smaller than the name, even at Large size. */}
            {data.business.address && <div style={sub}>{data.business.address}</div>}
            {data.business.phone && <div style={sub}>Ph: {data.business.phone}</div>}
            {data.business.ntn && <div style={sub}>NTN: {data.business.ntn}</div>}
          </div>
        );
      }
      case "title":
        return (
          <div style={{ textAlign: blk.align, ...font(blk) }}>
            <span
              style={{
                fontWeight: 700,
                letterSpacing: "0.06em",
                ...(banner
                  ? { background: accent, color: "#fff", padding: "2px 10px", borderRadius: 4 }
                  : colored
                    ? { color: primary, borderBottom: `2px solid ${accent}` }
                    : {}),
              }}
            >
              {data.title}
            </span>{" "}
            <span style={colored ? { color: primary, fontWeight: 600 } : undefined}>{data.number}</span>
            {data.returnOf && <div style={{ fontSize: "0.85em" }}>Return of Bill {data.returnOf}</div>}
          </div>
        );
      case "meta":
        return (
          <div style={{ textAlign: blk.align, ...font(blk), ...infoBox(blk) }}>
            <div>
              <span style={label}>Date:</span> {data.date}
            </div>
            <div>
              {data.payment}
              {data.invoiceType ? ` · ${data.invoiceType}` : ""}
            </div>
            {data.salesman && (
              <div>
                <span style={label}>Salesman:</span> {data.salesman}
              </div>
            )}
          </div>
        );
      case "customer":
        return (
          <div style={{ textAlign: blk.align, ...font(blk), ...infoBox(blk) }}>
            <div><span style={label}>Customer:</span> {data.customer.name}</div>
            {data.customer.phone && <div><span style={label}>Mobile:</span> {data.customer.phone}</div>}
            {data.customer.ntn && <div><span style={label}>NTN/CNIC:</span> {data.customer.ntn}</div>}
            {data.customer.address && <div><span style={label}>Address:</span> {data.customer.address}</div>}
          </div>
        );
      case "items": {
        if (thermal) {
          return (
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
          );
        }
        const th = (align: "left" | "right" = "left"): CSSProperties => ({
          padding: "4px 6px",
          textAlign: align,
          ...(banner ? { background: primary, color: "#fff" } : colored ? { color: primary } : {}),
        });
        const td = (align: "left" | "right" = "left"): CSSProperties => ({ padding: "3px 6px", textAlign: align });
        return (
          <table style={{ width: "100%", borderCollapse: "collapse", ...font(blk) }}>
            <thead>
              <tr style={{ borderBottom: colored ? `2px solid ${banner ? accent : primary}` : "1px solid #999" }}>
                <th style={th()}>Product</th>
                {template.columns.batch && <th style={th()}>Batch</th>}
                <th style={th("right")}>Qty</th>
                {template.columns.bonus && <th style={th("right")}>Bonus</th>}
                <th style={th("right")}>Price</th>
                {template.columns.discount && <th style={th("right")}>Disc</th>}
                <th style={th("right")}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr
                  key={it.id}
                  style={{
                    borderBottom: `1px solid ${colored ? tint(primary, 0.15) : "#eee"}`,
                    background: banner && i % 2 === 1 ? tint(primary, 0.06) : undefined,
                  }}
                >
                  <td style={td()}>{it.name}</td>
                  {template.columns.batch && <td style={td()}>{it.batch ?? "-"}</td>}
                  <td style={td("right")}>{it.qty}</td>
                  {template.columns.bonus && <td style={td("right")}>{it.bonus ?? "-"}</td>}
                  <td style={td("right")}>{money(it.price)}</td>
                  {template.columns.discount && <td style={td("right")}>{it.discountPct ? `${it.discountPct}%` : "-"}</td>}
                  <td style={{ ...td("right"), fontWeight: colored ? 600 : undefined }}>{money(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
      case "totals": {
        const t = data.totals;
        const row = (text: string, value: string, strong = false, extra?: CSSProperties) => (
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: strong ? 700 : 400, ...extra }}>
            <span>{text}</span>
            <span>{value}</span>
          </div>
        );
        return (
          <div style={{ display: "flex", justifyContent: justify(blk.align) }}>
            <div
              style={{
                width: thermal ? "100%" : "55%",
                ...font(blk),
                ...(colored ? { border: `1px solid ${tint(primary, 0.25)}`, borderRadius: 6, padding: "6px 8px" } : {}),
              }}
            >
              {row("Total", money(t.total))}
              {t.charges > 0 && row("Charges", money(t.charges))}
              {t.discount > 0 && row("Discount", `-${money(t.discount)}`)}
              {banner ? (
                row("Payable", money(t.payable), true, {
                  background: primary,
                  color: "#fff",
                  margin: "4px -8px",
                  padding: "4px 8px",
                  borderLeft: `4px solid ${accent}`,
                })
              ) : (
                <div style={{ borderTop: `1px solid ${colored ? primary : "#999"}`, marginTop: 2, paddingTop: 2 }}>
                  {row("Payable", money(t.payable), true, colored ? { color: primary } : undefined)}
                </div>
              )}
              {row("Paid", money(t.paid))}
              {row("Balance", money(t.balance), true, colored ? { color: primary } : undefined)}
            </div>
          </div>
        );
      }
      case "note":
        return data.note ? (
          <div style={{ textAlign: blk.align, ...font(blk), ...(colored ? { background: tint(accent, 0.12), padding: "4px 8px", borderRadius: 4 } : {}) }}>
            <span style={label}>Note:</span> {data.note}
          </div>
        ) : null;
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
          <div
            style={{
              textAlign: blk.align,
              ...font(blk),
              borderTop: thermal ? "1px dashed #999" : colored ? `1px solid ${tint(accent, 0.6)}` : undefined,
              paddingTop: 3,
              ...(colored ? { color: primary, fontStyle: "italic", fontWeight: 600 } : {}),
            }}
          >
            {template.thanksText}
          </div>
        ) : null;
    }
  }

  return (
    <div
      style={{
        width: `${contentMm}mm`,
        color: "#111",
        fontFamily: "Arial, Helvetica, sans-serif",
        lineHeight: 1.35,
        // Keep backgrounds and colours when printing.
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
      }}
    >
      <style>{`@media print { @page { size: ${paper.css}; margin: ${paper.marginMm}mm; } }`}</style>
      {colored && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: banner ? 6 : 3, background: primary, borderRadius: 2 }} />
          {banner && <div style={{ height: 2, marginTop: 2, width: "40%", background: accent, borderRadius: 2 }} />}
        </div>
      )}
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
      <div
        style={{
          marginTop: 10,
          borderTop: colored ? `2px solid ${accent}` : "1px solid #ddd",
          paddingTop: 3,
          textAlign: "center",
          fontSize: `${Math.max(8, base - 3)}px`,
          color: colored ? primary : "#777",
        }}
      >
        {DEVELOPER_CREDIT}
      </div>
    </div>
  );
}
