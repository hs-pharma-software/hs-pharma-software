"use client";

import type { CSSProperties, ReactNode } from "react";
import QRCode from "react-qr-code";
import {
  DEVELOPER_CREDIT,
  PAPERS,
  type BlockConfig,
  type BlockId,
  type PrintStyle,
  type PrintTemplate,
} from "@/lib/printTemplates";

export interface PrintItem {
  id: string;
  name: string;
  hsCode: string | null;
  batch: string | null;
  qty: string;
  bonus: string | null;
  price: number;
  discountPct: number;
  taxPct: number;
  taxRs: number;
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
  /** total = gross before discount and tax; discount = line + bill discount. */
  totals: { total: number; discount: number; tax: number; charges: number; payable: number; paid: number; balance: number };
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

/** How each design draws the page. Colours come from the template theme. */
interface Skin {
  top: "none" | "stripe" | "line" | "wave" | "diagonal";
  bottom: "none" | "wave" | "diagonal";
  frame: "none" | "sidebar" | "double";
  head: "banner" | "gradient" | "tint" | "text" | "underline" | "dark" | "boxed" | "medical" | "plain";
  title: "pill" | "underline" | "ribbon" | "tintPill" | "caps" | "plain";
  info: "rule" | "box" | "tint" | "plain";
  thead: "fill" | "gradient" | "underline" | "double" | "tint" | "accentFill" | "plain";
  zebra: boolean;
  grand: "bar" | "gradient" | "tint" | "line" | "double" | "dark" | "plain";
  boxed: boolean;
}

const SKINS: Record<PrintStyle, Skin> = {
  banner: { top: "stripe", bottom: "none", frame: "none", head: "banner", title: "pill", info: "rule", thead: "fill", zebra: true, grand: "bar", boxed: false },
  gradient: { top: "none", bottom: "none", frame: "none", head: "gradient", title: "pill", info: "rule", thead: "gradient", zebra: true, grand: "gradient", boxed: false },
  wave: { top: "wave", bottom: "wave", frame: "none", head: "text", title: "underline", info: "tint", thead: "fill", zebra: true, grand: "bar", boxed: false },
  medical: { top: "stripe", bottom: "none", frame: "none", head: "medical", title: "pill", info: "rule", thead: "fill", zebra: true, grand: "bar", boxed: false },
  sidebar: { top: "none", bottom: "none", frame: "sidebar", head: "text", title: "caps", info: "rule", thead: "fill", zebra: true, grand: "bar", boxed: false },
  boxed: { top: "none", bottom: "none", frame: "none", head: "boxed", title: "pill", info: "box", thead: "tint", zebra: false, grand: "bar", boxed: true },
  ribbon: { top: "none", bottom: "none", frame: "none", head: "text", title: "ribbon", info: "rule", thead: "fill", zebra: true, grand: "bar", boxed: false },
  dark: { top: "none", bottom: "none", frame: "none", head: "dark", title: "pill", info: "rule", thead: "accentFill", zebra: true, grand: "dark", boxed: false },
  pastel: { top: "none", bottom: "none", frame: "none", head: "tint", title: "tintPill", info: "tint", thead: "tint", zebra: true, grand: "tint", boxed: false },
  diagonal: { top: "diagonal", bottom: "diagonal", frame: "none", head: "text", title: "pill", info: "rule", thead: "fill", zebra: true, grand: "bar", boxed: false },
  frame: { top: "none", bottom: "none", frame: "double", head: "underline", title: "underline", info: "plain", thead: "double", zebra: false, grand: "double", boxed: false },
  lines: { top: "line", bottom: "none", frame: "none", head: "underline", title: "underline", info: "rule", thead: "underline", zebra: false, grand: "line", boxed: false },
  minimal: { top: "line", bottom: "none", frame: "none", head: "plain", title: "caps", info: "plain", thead: "underline", zebra: false, grand: "line", boxed: false },
  plain: { top: "none", bottom: "none", frame: "none", head: "plain", title: "plain", info: "plain", thead: "plain", zebra: false, grand: "plain", boxed: false },
};

/** #rrggbb + alpha -> rgba(), for tinted rows and boxes. */
function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Black or white, whichever reads better on this background. */
function on(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111" : "#fff";
}

/** Renders an invoice from a print template. Used for both the template
 * editor preview (with `editor` hooks) and real printing. A4 / A5 use the
 * template's design and colours; thermal always prints black and shows tax
 * only in the totals. */
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
  const skin = SKINS[thermal ? "plain" : template.theme?.style ?? "plain"] ?? SKINS.banner;
  const colored = !thermal && template.theme?.style !== "plain";
  const P = colored ? template.theme.primary : "#111111";
  const A = colored ? template.theme.accent : "#999999";
  const gradient = `linear-gradient(90deg, ${P}, ${A})`;
  const showHs = !thermal && template.columns.hsCode;
  const showTax = !thermal && template.columns.tax;

  const font = (blk: BlockConfig) => ({ fontSize: `${(base * SIZE_SCALE[blk.size]).toFixed(1)}px` });
  const justify = (a: BlockConfig["align"]) => (a === "center" ? "center" : a === "right" ? "flex-end" : "flex-start");
  const label: CSSProperties = colored ? { color: P, fontWeight: 700 } : { fontWeight: 700 };

  const infoBox = (blk: BlockConfig): CSSProperties => {
    const side = blk.align === "right" ? "borderRight" : "borderLeft";
    switch (skin.info) {
      case "rule":
        return { [side]: `3px solid ${A}`, padding: blk.align === "right" ? "2px 8px 2px 0" : "2px 0 2px 8px" };
      case "box":
        return { border: `1px solid ${tint(P, 0.35)}`, borderRadius: 6, padding: "4px 8px" };
      case "tint":
        return { background: tint(P, 0.07), borderRadius: 6, padding: "4px 8px" };
      default:
        return {};
    }
  };

  function decor(kind: Skin["top"] | Skin["bottom"], flip = false): ReactNode {
    if (!colored || kind === "none") return null;
    if (kind === "stripe")
      return (
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 6, background: P, borderRadius: 2 }} />
          <div style={{ height: 2, marginTop: 2, width: "40%", background: A, borderRadius: 2 }} />
        </div>
      );
    if (kind === "line") return <div style={{ height: 3, background: P, borderRadius: 2, marginBottom: 8 }} />;
    if (kind === "diagonal")
      return (
        <div
          style={{
            height: 10,
            margin: flip ? "8px 0 0" : "0 0 8px",
            borderRadius: 2,
            background: `repeating-linear-gradient(135deg, ${P} 0 10px, ${A} 10px 20px)`,
          }}
        />
      );
    // wave
    return (
      <svg
        viewBox="0 0 600 40"
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: 26, margin: flip ? "8px 0 0" : "0 0 8px", transform: flip ? "scaleY(-1)" : undefined }}
      >
        <path d="M0 0 H600 V18 C450 40 330 4 200 22 C120 34 50 30 0 20 Z" fill={P} />
        <path d="M0 20 C50 30 120 34 200 22 C330 4 450 40 600 18 V26 C450 46 330 12 200 30 C120 40 50 36 0 28 Z" fill={A} />
      </svg>
    );
  }

  function renderBusiness(blk: BlockConfig) {
    const sub: CSSProperties = { fontSize: blk.size === "lg" ? "0.72em" : "0.9em", opacity: 0.92 };
    const filled = (bg: string, extra?: CSSProperties): CSSProperties => ({
      background: bg,
      color: on(skin.head === "gradient" ? P : bg),
      padding: "10px 14px",
      borderRadius: 6,
      ...extra,
    });
    let box: CSSProperties = {};
    let nameColor: string | undefined;
    switch (skin.head) {
      case "banner":
        box = filled(P, { borderBottom: `4px solid ${A}` });
        break;
      case "medical":
        box = filled(P, { borderBottom: `4px solid ${A}`, position: "relative", paddingRight: 56 });
        break;
      case "gradient":
        box = filled(gradient);
        break;
      case "dark":
        box = filled(P, { borderLeft: `6px solid ${A}` });
        nameColor = A;
        break;
      case "tint":
        box = { background: tint(P, 0.1), padding: "10px 14px", borderRadius: 10 };
        nameColor = P;
        break;
      case "boxed":
        box = { border: `2px solid ${P}`, padding: "8px 12px", borderRadius: 6, borderTop: `8px solid ${P}` };
        nameColor = P;
        break;
      case "text":
        nameColor = P;
        break;
      case "underline":
        box = { borderBottom: `2px solid ${A}`, paddingBottom: 4 };
        nameColor = P;
        break;
    }
    if (!colored) {
      box = {};
      nameColor = undefined;
    }
    return (
      <div style={{ textAlign: blk.align, ...font(blk), ...box }}>
        {colored && skin.head === "medical" && (
          <div
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              width: 36,
              height: 36,
              borderRadius: 18,
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg viewBox="0 0 24 24" width={22} height={22}>
              <path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill={A} />
            </svg>
          </div>
        )}
        <div style={{ fontWeight: 700, fontSize: "1.25em", color: nameColor }}>{data.business.name}</div>
        {/* Contact lines stay smaller than the name, even at Large size. */}
        {data.business.address && <div style={sub}>{data.business.address}</div>}
        {data.business.phone && <div style={sub}>Ph: {data.business.phone}</div>}
        {data.business.ntn && <div style={sub}>NTN: {data.business.ntn}</div>}
      </div>
    );
  }

  function renderTitle(blk: BlockConfig) {
    const number = <span style={colored ? { color: P, fontWeight: 600 } : undefined}>{data.number}</span>;
    const returnOf = data.returnOf && <div style={{ fontSize: "0.85em" }}>Return of Bill {data.returnOf}</div>;
    if (colored && skin.title === "ribbon") {
      return (
        <div style={{ ...font(blk), background: P, color: on(P), padding: "5px 12px", borderLeft: `8px solid ${A}`, textAlign: blk.align }}>
          <span style={{ fontWeight: 700, letterSpacing: "0.12em" }}>{data.title}</span> <span style={{ fontWeight: 600 }}>{data.number}</span>
          {returnOf}
        </div>
      );
    }
    const titleStyle: CSSProperties = { fontWeight: 700, letterSpacing: "0.06em" };
    if (colored) {
      if (skin.title === "pill") Object.assign(titleStyle, { background: A, color: on(A), padding: "2px 10px", borderRadius: 4 });
      if (skin.title === "tintPill") Object.assign(titleStyle, { background: tint(P, 0.15), color: P, padding: "2px 10px", borderRadius: 12 });
      if (skin.title === "underline") Object.assign(titleStyle, { color: P, borderBottom: `2px solid ${A}` });
      if (skin.title === "caps") Object.assign(titleStyle, { color: A, letterSpacing: "0.2em", fontSize: "1.1em" });
    }
    return (
      <div style={{ textAlign: blk.align, ...font(blk) }}>
        <span style={titleStyle}>{data.title}</span> {number}
        {returnOf}
      </div>
    );
  }

  function renderItems(blk: BlockConfig) {
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
    const headCell = (align: "left" | "right" = "left"): CSSProperties => {
      const s: CSSProperties = { padding: "4px 5px", textAlign: align, whiteSpace: "nowrap" };
      if (!colored) return s;
      switch (skin.thead) {
        case "fill":
          return { ...s, background: P, color: on(P) };
        case "gradient":
          return { ...s, background: P, color: on(P) };
        case "accentFill":
          return { ...s, background: A, color: on(A) };
        case "tint":
          return { ...s, background: tint(P, 0.14), color: P };
        default:
          return { ...s, color: P };
      }
    };
    const headRow: CSSProperties = colored
      ? skin.thead === "gradient"
        ? { background: gradient }
        : skin.thead === "double"
          ? { borderTop: `3px double ${P}`, borderBottom: `3px double ${P}` }
          : skin.thead === "underline"
            ? { borderBottom: `2px solid ${P}` }
            : { borderBottom: `2px solid ${A}` }
      : { borderBottom: "1px solid #999" };
    const cell = (align: "left" | "right" = "left"): CSSProperties => ({
      padding: "3px 5px",
      textAlign: align,
      ...(skin.boxed && colored ? { border: `1px solid ${tint(P, 0.2)}` } : {}),
    });
    return (
      <table style={{ width: "100%", borderCollapse: "collapse", ...font(blk) }}>
        <thead>
          <tr style={headRow}>
            <th style={{ ...headCell(), ...(skin.thead === "gradient" ? { background: "transparent" } : {}) }}>Product</th>
            {showHs && <th style={{ ...headCell(), ...(skin.thead === "gradient" ? { background: "transparent" } : {}) }}>HS Code</th>}
            {template.columns.batch && <th style={{ ...headCell(), ...(skin.thead === "gradient" ? { background: "transparent" } : {}) }}>Batch</th>}
            {[
              ["Qty", true],
              ["Bonus", template.columns.bonus],
              ["Price", true],
              ["Disc", template.columns.discount],
              ["Tax %", showTax],
              ["Tax Rs", showTax],
              ["Total", true],
            ]
              .filter(([, show]) => show)
              .map(([h]) => (
                <th key={h as string} style={{ ...headCell("right"), ...(skin.thead === "gradient" ? { background: "transparent" } : {}) }}>
                  {h}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => (
            <tr
              key={it.id}
              style={{
                borderBottom: `1px solid ${colored ? tint(P, 0.15) : "#eee"}`,
                background: colored && skin.zebra && i % 2 === 1 ? tint(P, skin.thead === "tint" ? 0.05 : 0.06) : undefined,
              }}
            >
              <td style={cell()}>{it.name}</td>
              {showHs && <td style={{ ...cell(), whiteSpace: "nowrap" }}>{it.hsCode ?? "-"}</td>}
              {template.columns.batch && <td style={cell()}>{it.batch ?? "-"}</td>}
              <td style={cell("right")}>{it.qty}</td>
              {template.columns.bonus && <td style={cell("right")}>{it.bonus ?? "-"}</td>}
              <td style={cell("right")}>{money(it.price)}</td>
              {template.columns.discount && <td style={cell("right")}>{it.discountPct ? `${it.discountPct}%` : "-"}</td>}
              {showTax && <td style={cell("right")}>{it.taxPct ? `${it.taxPct}%` : "-"}</td>}
              {showTax && <td style={cell("right")}>{it.taxRs ? money(it.taxRs) : "-"}</td>}
              <td style={{ ...cell("right"), fontWeight: colored ? 600 : undefined }}>{money(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderTotals(blk: BlockConfig) {
    const t = data.totals;
    const row = (text: string, value: string, strong = false, extra?: CSSProperties) => (
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: strong ? 700 : 400, ...extra }}>
        <span>{text}</span>
        <span>{value}</span>
      </div>
    );
    const bar = (bg: string, fg: string, extra?: CSSProperties): CSSProperties => ({
      background: bg,
      color: fg,
      margin: "4px -8px",
      padding: "4px 8px",
      ...extra,
    });
    let grand: CSSProperties | undefined;
    if (colored) {
      switch (skin.grand) {
        case "bar":
          grand = bar(P, on(P), { borderLeft: `4px solid ${A}` });
          break;
        case "gradient":
          grand = bar(gradient, on(P));
          break;
        case "dark":
          grand = bar(P, A);
          break;
        case "tint":
          grand = bar(tint(P, 0.15), P, { borderRadius: 4 });
          break;
        case "double":
          grand = { borderTop: `3px double ${P}`, borderBottom: `3px double ${P}`, color: P, padding: "3px 0", margin: "3px 0" };
          break;
        case "line":
          grand = { borderTop: `1.5px solid ${P}`, color: P, paddingTop: 2, marginTop: 2 };
          break;
      }
    } else {
      grand = { borderTop: "1px solid #999", marginTop: 2, paddingTop: 2 };
    }
    const framed = colored && skin.grand !== "line" && skin.grand !== "double";
    return (
      <div style={{ display: "flex", justifyContent: justify(blk.align) }}>
        <div
          style={{
            width: thermal ? "100%" : "55%",
            ...font(blk),
            ...(framed ? { border: `1px solid ${tint(P, 0.25)}`, borderRadius: 6, padding: "6px 8px", overflow: "hidden" } : {}),
          }}
        >
          {row("Total", money(t.total))}
          {t.discount > 0 && row("Discount", `-${money(t.discount)}`)}
          {/* Tax always shows before the grand total (thermal included). */}
          {t.tax > 0 && row("Sales Tax", money(t.tax))}
          {t.charges > 0 && row("Charges", money(t.charges))}
          {row("Grand Total", money(t.payable), true, grand)}
          {row("Paid", money(t.paid))}
          {row("Balance", money(t.balance), true, colored ? { color: P } : undefined)}
        </div>
      </div>
    );
  }

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
        return renderBusiness(blk);
      case "title":
        return renderTitle(blk);
      case "meta":
        return (
          <div style={{ textAlign: blk.align, ...font(blk), ...(colored ? infoBox(blk) : {}) }}>
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
          <div style={{ textAlign: blk.align, ...font(blk), ...(colored ? infoBox(blk) : {}) }}>
            <div><span style={label}>Customer:</span> {data.customer.name}</div>
            {data.customer.phone && <div><span style={label}>Mobile:</span> {data.customer.phone}</div>}
            {data.customer.ntn && <div><span style={label}>NTN/CNIC:</span> {data.customer.ntn}</div>}
            {data.customer.address && <div><span style={label}>Address:</span> {data.customer.address}</div>}
          </div>
        );
      case "items":
        return renderItems(blk);
      case "totals":
        return renderTotals(blk);
      case "note":
        return data.note ? (
          <div style={{ textAlign: blk.align, ...font(blk), ...(colored ? { background: tint(A, 0.12), padding: "4px 8px", borderRadius: 4 } : {}) }}>
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
              borderTop: thermal ? "1px dashed #999" : colored ? `1px solid ${tint(A, 0.6)}` : undefined,
              paddingTop: 3,
              ...(colored ? { color: P, fontStyle: "italic", fontWeight: 600 } : {}),
            }}
          >
            {template.thanksText}
          </div>
        ) : null;
    }
  }

  const frame: CSSProperties = !colored
    ? {}
    : skin.frame === "sidebar"
      ? { borderLeft: `10px solid ${P}`, boxShadow: `inset 3px 0 0 ${A}`, paddingLeft: 14 }
      : skin.frame === "double"
        ? { border: `4px double ${P}`, padding: 10 }
        : {};

  return (
    <div
      style={{
        width: `${contentMm}mm`,
        boxSizing: "border-box",
        color: "#111",
        fontFamily: "Arial, Helvetica, sans-serif",
        lineHeight: 1.35,
        // Keep backgrounds and colours when printing.
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
        ...frame,
      }}
    >
      <style>{`@media print { @page { size: ${paper.css}; margin: ${paper.marginMm}mm; } }`}</style>
      {decor(skin.top)}
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
      {decor(skin.bottom, true)}
      <div
        style={{
          marginTop: 10,
          borderTop: colored ? `2px solid ${A}` : "1px solid #ddd",
          paddingTop: 3,
          textAlign: "center",
          fontSize: `${Math.max(8, base - 3)}px`,
          color: colored ? P : "#777",
        }}
      >
        {DEVELOPER_CREDIT}
      </div>
    </div>
  );
}
