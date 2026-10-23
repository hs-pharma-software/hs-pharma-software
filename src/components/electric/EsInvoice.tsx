"use client";

import QRCode from "react-qr-code";
import { translate, type Lang } from "@/lib/i18n";
import { DEVELOPER_CREDIT } from "@/lib/printTemplates";
import type { EsDoc, EsDocItem } from "@/lib/electric/store";

export type InvoiceLang = "en" | "ur" | "bi";

export interface EsBusiness {
  name: string;
  nameUr?: string | null;
  address?: string | null;
  addressUr?: string | null;
  phone?: string | null;
  ntn?: string | null;
  logo?: string | null;
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => String(Math.round((Number(n) || 0) * 1000) / 1000);

/** Store invoice / quotation / return document. Language changes only the
 * labels and which product name is shown; every amount comes straight from
 * the saved document. */
export function EsInvoice({
  doc,
  items,
  business,
  lang,
  paper,
  terms,
}: {
  doc: EsDoc;
  items: EsDocItem[];
  business: EsBusiness;
  lang: InvoiceLang;
  paper: "a4" | "thermal";
  terms: { en: string | null; ur: string | null };
}) {
  const thermal = paper === "thermal";
  const ur = lang === "ur";
  const bi = lang === "bi";
  const dir = ur ? "rtl" : "ltr";
  // Label: one language, or "English · اردو" for bilingual.
  const L = (key: string) => {
    if (bi) {
      return (
        <>
          {translate(key, "en")} <span className="font-urdu" style={{ fontSize: "0.95em" }}>· {translate(key, "ur")}</span>
        </>
      );
    }
    return translate(key, (ur ? "ur" : "en") as Lang);
  };
  const urduText = (s: string | null | undefined) => (s ? <span className="font-urdu" dir="rtl">{s}</span> : null);
  // User-entered text: Urdu script gets the Nastaleeq font, in any invoice language.
  const auto = (v: string | null | undefined) =>
    !v ? null : /[؀-ۿ]/.test(v) ? <span className="font-urdu" dir="auto">{v}</span> : <bdi dir="auto">{v}</bdi>;
  const id = (s: string | number | null | undefined) => (s == null || s === "" ? "-" : <bdi className="ltr-id" dir="ltr">{s}</bdi>);
  const productName = (i: EsDocItem) => {
    if (ur) return i.name_ur ? urduText(i.name_ur) : auto(i.name);
    if (bi && i.name_ur) {
      return (
        <>
          {auto(i.name)}
          <br />
          {urduText(i.name_ur)}
        </>
      );
    }
    return auto(i.name);
  };
  const party = doc.party_type === "supplier" ? "inv.supplier" : "inv.customer";
  const pays = doc.payments ? (JSON.parse(doc.payments) as { method: string; amount: number }[]) : [];
  const methodLabel = (m: string) => (bi ? `${translate(`pay.${m}`, "en")} / ${translate(`pay.${m}`, "ur")}` : translate(`pay.${m}`, ur ? "ur" : "en"));
  const cell: React.CSSProperties = { padding: thermal ? "2px 3px" : "5px 6px", borderBottom: "1px solid #e5e5e5", verticalAlign: "top", textAlign: "start" };
  const num: React.CSSProperties = { ...cell, textAlign: "end", whiteSpace: "nowrap" };
  // Header cells repeat on every printed page: room for Nastaleeq's tall
  // strokes, and overflow clipped (Chromium otherwise paints stray ink from
  // the repeated header at the bottom of the previous page).
  const head: React.CSSProperties = {
    ...cell,
    background: "#f2f2f2",
    fontWeight: 700,
    borderBottom: "1.5px solid #333",
    overflow: "hidden",
    lineHeight: ur || bi ? 2.3 : 1.4,
    paddingTop: ur || bi ? 2 : cell.padding ? undefined : 4,
  };
  const showTax = items.some((i) => i.tax > 0);
  const showDisc = items.some((i) => i.discount > 0);
  const total = (label: string, v: string, strong = false) => (
    <tr style={{ fontWeight: strong ? 700 : 400 }}>
      <td style={{ padding: "2px 6px", textAlign: "start" }}>{L(label)}</td>
      <td style={{ padding: "2px 6px", textAlign: "end", whiteSpace: "nowrap" }}>
        <bdi className="ltr-id">Rs {v}</bdi>
      </td>
    </tr>
  );

  return (
    <div
      dir={dir}
      lang={ur ? "ur" : "en"}
      className={ur ? "font-urdu" : undefined}
      style={{
        width: thermal ? "74mm" : "186mm",
        fontSize: thermal ? 11 : 12,
        color: "#111",
        lineHeight: ur || bi ? 1.9 : 1.4,
        fontFamily: ur ? "var(--font-urdu)" : "Arial, Helvetica, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", flexDirection: thermal ? "column" : "row", alignItems: thermal ? "center" : "flex-start", justifyContent: "space-between", gap: 8, borderBottom: "2px solid #111", paddingBottom: 6, marginBottom: 6, textAlign: thermal ? "center" : "start" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexDirection: thermal ? "column" : "row" }}>
          {business.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logo} alt="" style={{ height: thermal ? 36 : 56, objectFit: "contain" }} />
          )}
          <div>
            <div style={{ fontSize: thermal ? 15 : 20, fontWeight: 700 }}>
              {ur && business.nameUr ? urduText(business.nameUr) : auto(business.name)}
            </div>
            {bi && business.nameUr && <div style={{ fontSize: thermal ? 13 : 16 }}>{urduText(business.nameUr)}</div>}
            <div>{ur && business.addressUr ? urduText(business.addressUr) : business.address}</div>
            {business.phone && (
              <div>
                {L("inv.phone")}: {id(business.phone)}
              </div>
            )}
            {business.ntn && <div>NTN: {id(business.ntn)}</div>}
          </div>
        </div>
        <div style={{ textAlign: thermal ? "center" : "end" }}>
          <div style={{ fontSize: thermal ? 13 : 17, fontWeight: 700, letterSpacing: ur ? 0 : 1 }}>{L(`inv.${doc.doc_type}`)}</div>
          <div>
            {L("inv.no")}: {id(doc.doc_no)}
          </div>
          <div>
            {L("inv.date")}: {id(doc.date)}
          </div>
          {doc.valid_until && (
            <div>
              {L("inv.validUntil")}: {id(doc.valid_until)}
            </div>
          )}
        </div>
      </div>

      {/* Party */}
      <div style={{ marginBottom: 6 }}>
        <div>
          <b>{L(party)}:</b> {doc.party_name ? auto(doc.party_name) : L("c.walkIn")}
        </div>
        {doc.party_phone && (
          <div>
            <b>{L("inv.phone")}:</b> {id(doc.party_phone)}
          </div>
        )}
        {doc.party_address && !thermal && (
          <div>
            <b>{L("inv.address")}:</b> {auto(doc.party_address)}
          </div>
        )}
        {doc.notes && <div style={{ fontSize: "0.9em" }}>{auto(doc.notes)}</div>}
      </div>

      {/* Items: the header repeats on every printed page; rows never split. */}
      {thermal ? (
        <div style={{ borderTop: "1px dashed #333" }}>
          {items.map((i, n) => (
            <div key={i.id} style={{ borderBottom: "1px dashed #bbb", padding: "2px 0", breakInside: "avoid" }}>
              <div style={{ fontWeight: 600 }}>
                {n + 1}. {productName(i)}
              </div>
              {i.model && <div>{L("inv.model")}: {id(i.model)}</div>}
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  {id(qtyFmt(i.qty))} {i.unit} × {id(fmt(i.price))}
                </span>
                <b>{id(fmt(i.line_total))}</b>
              </div>
              {i.serials && <div>{L("inv.serials")}: {id((JSON.parse(i.serials) as string[]).join(", "))}</div>}
              {i.warranty_end && <div>{L("inv.warranty")}: {id(i.warranty_end)}</div>}
            </div>
          ))}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ display: "table-header-group" }}>
            <tr>
              <th style={{ ...head, width: 28 }}>{L("inv.sr")}</th>
              <th style={head}>{L("inv.item")}</th>
              <th style={{ ...head, textAlign: "end" }}>{L("inv.qty")}</th>
              <th style={head}>{L("inv.unit")}</th>
              <th style={{ ...head, textAlign: "end" }}>{L("inv.rate")}</th>
              {showDisc && <th style={{ ...head, textAlign: "end" }}>{L("inv.discount")}</th>}
              {showTax && <th style={{ ...head, textAlign: "end" }}>{L("inv.tax")}</th>}
              <th style={{ ...head, textAlign: "end" }}>{L("inv.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={i.id} style={{ breakInside: "avoid" }}>
                <td style={cell}>{id(n + 1)}</td>
                <td style={cell}>
                  <div style={{ fontWeight: 600 }}>{productName(i)}</div>
                  {i.model && (
                    <div style={{ fontSize: "0.9em" }}>
                      {L("inv.model")}: {id(i.model)}
                    </div>
                  )}
                  {i.serials && (
                    <div style={{ fontSize: "0.9em" }}>
                      {L("inv.serials")}: {id((JSON.parse(i.serials) as string[]).join(", "))}
                    </div>
                  )}
                  {i.warranty_end && (
                    <div style={{ fontSize: "0.9em" }}>
                      {L("inv.warranty")}: {id(i.warranty_end)}
                    </div>
                  )}
                </td>
                <td style={num}>{id(qtyFmt(i.qty))}</td>
                <td style={cell}>{id(i.unit)}</td>
                <td style={num}>{id(fmt(i.price))}</td>
                {showDisc && <td style={num}>{i.discount ? id(fmt(i.discount)) : "-"}</td>}
                {showTax && <td style={num}>{i.tax ? id(`${fmt(i.tax)} (${i.tax_rate}%)`) : "-"}</td>}
                <td style={{ ...num, fontWeight: 600 }}>{id(fmt(i.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Totals stay together on one page. */}
      <div style={{ display: "flex", justifyContent: thermal ? "stretch" : "flex-end", marginTop: 6, breakInside: "avoid" }}>
        <table style={{ width: thermal ? "100%" : "48%", borderCollapse: "collapse" }}>
          <tbody>
            {total("inv.subtotal", fmt(doc.gross))}
            {doc.discount > 0 && total("inv.discount", `-${fmt(doc.discount)}`)}
            {doc.tax > 0 && total("inv.tax", fmt(doc.tax))}
            <tr><td colSpan={2} style={{ borderTop: "1.5px solid #111" }} /></tr>
            {total("inv.total", fmt(doc.total), true)}
            {doc.doc_type !== "quotation" && total("inv.received", fmt(doc.paid))}
            {doc.doc_type !== "quotation" && total("inv.balance", fmt(doc.balance), true)}
            {pays.length > 0 && (
              <tr>
                <td style={{ padding: "2px 6px", textAlign: "start" }}>{L("inv.method")}</td>
                <td style={{ padding: "2px 6px", textAlign: "end" }}>{[...new Set(pays.map((p) => p.method))].map(methodLabel).join(", ")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(terms.en || terms.ur) && (
        <div style={{ marginTop: 8, fontSize: "0.9em", breakInside: "avoid" }}>
          <b>{L("inv.terms")}</b>
          {(ur || bi) && terms.ur && <div className="font-urdu" dir="rtl" style={{ whiteSpace: "pre-line" }}>{terms.ur}</div>}
          {(!ur || bi) && terms.en && <div dir="ltr" style={{ whiteSpace: "pre-line" }}>{terms.en}</div>}
          {ur && !terms.ur && terms.en && <div dir="ltr" style={{ whiteSpace: "pre-line" }}>{terms.en}</div>}
        </div>
      )}

      {doc.fbr_invoice_no && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, breakInside: "avoid" }}>
          <div style={{ background: "#fff", padding: 3, lineHeight: 0 }}>
            <QRCode value={doc.fbr_invoice_no} size={thermal ? 64 : 76} />
          </div>
          <div>
            {L("inv.fbr")}: <b>{id(doc.fbr_invoice_no)}</b>
          </div>
        </div>
      )}

      {!thermal && doc.doc_type !== "quotation" && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 28, breakInside: "avoid" }}>
          <div style={{ borderTop: "1px solid #333", width: 180, textAlign: "center", paddingTop: 2 }}>{L("inv.signature")}</div>
        </div>
      )}
      <div style={{ textAlign: "center", marginTop: 8 }}>{L("inv.thanks")}</div>
      {!doc.fbr_invoice_no && (
        <div style={{ textAlign: "center", fontSize: "0.8em", color: "#555" }}>{L("inv.notOfficial")}</div>
      )}
      <div style={{ textAlign: "center", fontSize: "0.75em", color: "#777", borderTop: "1px solid #ddd", marginTop: 4, paddingTop: 2, fontFamily: "Arial, sans-serif" }} dir="ltr">
        {DEVELOPER_CREDIT}
      </div>
    </div>
  );
}
