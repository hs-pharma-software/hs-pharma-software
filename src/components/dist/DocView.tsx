"use client";

import { useRef, useState } from "react";
import { Printer, RotateCcw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useAuthStore } from "@/store/authStore";
import { printDirect } from "@/lib/print";
import { DEVELOPER_CREDIT } from "@/lib/printTemplates";
import { dist, errorText } from "@/lib/dist";
import type { DistDoc, DistDocItem } from "@/lib/dist/store";
import { Err, Note, money, useLoad } from "./ui";

const TITLE: Record<string, string> = { sale: "SALES INVOICE", sale_return: "CREDIT NOTE (SALES RETURN)", purchase: "PURCHASE INVOICE", purchase_return: "PURCHASE RETURN" };

/** A finalized document. It can't be edited: corrections are credit notes / returns. */
export function DocView({ id, onClose }: { id: string; onClose: () => void }) {
  const data = useLoad(() => dist.getDoc(id), [id]);
  const area = useRef<HTMLDivElement>(null);
  const [returning, setReturning] = useState(false);
  const [paying, setPaying] = useState(false);
  const d = data.data?.doc;
  return (
    <Modal title={d ? `${TITLE[d.doc_type]} #${d.doc_no}` : "Document"} onClose={onClose} width="max-w-4xl">
      <Err error={data.error} />
      {d && data.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void printDirect("a4", area.current)}><Printer size={14} /> Print</Button>
            {(d.doc_type === "sale" || d.doc_type === "purchase") && <Button onClick={() => setReturning(true)}><RotateCcw size={14} /> {d.doc_type === "sale" ? "Credit note / return" : "Purchase return"}</Button>}
            {d.balance > 0 && <Button onClick={() => setPaying(true)}><Wallet size={14} /> {d.doc_type === "sale" ? "Receive payment" : "Pay supplier"}</Button>}
          </div>
          <div className="overflow-x-auto rounded-xl bg-neutral-100 p-3">
            <div ref={area} className="print-area mx-auto w-[190mm] bg-white p-6 text-[12px] text-black">
              <DocPrint doc={d} items={data.data.items} />
            </div>
          </div>
        </div>
      )}
      {returning && data.data && <ReturnModal doc={data.data.doc} items={data.data.items} onClose={() => setReturning(false)} onDone={() => { setReturning(false); void data.reload(); }} />}
      {paying && d && <PayModal doc={d} onClose={() => setPaying(false)} onDone={() => { setPaying(false); void data.reload(); }} />}
    </Modal>
  );
}

function DocPrint({ doc, items }: { doc: DistDoc; items: DistDocItem[] }) {
  const business = useAuthStore((s) => s.currentTenant?.name ?? "");
  const snap = doc.tax_snapshot ? (JSON.parse(doc.tax_snapshot) as { atlStatus?: string; atlCheckedAt?: string | null; atlSource?: string | null; overridden?: boolean; overrideReason?: string | null; treatment?: { note?: string } }) : null;
  const payable = doc.total + doc.wht_amount;
  return (
    <div>
      <div className="mb-3 flex justify-between border-b-2 border-black pb-2">
        <div>
          <p className="text-lg font-bold">{business}</p>
        </div>
        <div className="text-end">
          <p className="text-base font-bold">{TITLE[doc.doc_type]}</p>
          <p>No. {doc.doc_no} · {doc.date}</p>
          {doc.supplier_invoice_no && <p>Supplier inv. {doc.supplier_invoice_no}</p>}
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <p className="font-semibold">{doc.party_type === "customer" ? "Customer" : "Supplier"}: {doc.party_name}</p>
          {doc.party_address && <p>{doc.party_address}</p>}
          {doc.party_type === "customer" && <p>NTN: {doc.party_ntn ?? "—"} · CNIC: {doc.party_cnic ?? "—"}</p>}
        </div>
        {doc.description && <p className="text-end">{doc.description}</p>}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="py-1 text-start">#</th><th className="text-start">Product</th><th className="text-end">Qty</th><th className="text-end">Rate</th><th className="text-end">Discount</th><th className="text-end">ST %</th><th className="text-end">ST</th><th className="text-end">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={i.id} className="border-b border-neutral-300">
              <td className="py-0.5">{n + 1}</td>
              <td>{i.name} <span className="text-[10px] text-neutral-500">{i.code}</span></td>
              <td className="text-end">{i.qty} {i.unit}</td>
              <td className="text-end">{i.price.toFixed(2)}</td>
              <td className="text-end">{i.discount.toFixed(2)}</td>
              <td className="text-end">{i.sales_tax_rate}</td>
              <td className="text-end">{i.sales_tax.toFixed(2)}</td>
              <td className="text-end">{i.line_total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 ms-auto w-80 space-y-0.5">
        <Row l="Gross" v={doc.gross} />
        <Row l="Discount" v={-doc.discount} />
        <Row l="Sales tax" v={doc.sales_tax} />
        <Row l="Total (goods)" v={doc.total} bold />
        {doc.party_type === "customer" && (
          <>
            <Row l={`Withholding income tax ${doc.wht_section ?? ""} @ ${doc.wht_rate}% on ${doc.wht_base.toFixed(2)}`} v={doc.wht_amount} />
            <Row l="Payable" v={payable} bold />
          </>
        )}
        {(doc.doc_type === "sale" || doc.doc_type === "purchase") && (
          <>
            <Row l="Paid" v={doc.paid} />
            <Row l="Balance" v={doc.balance} bold />
          </>
        )}
      </div>
      {doc.party_type === "customer" && snap && (
        <div className="mt-3 border-t border-neutral-300 pt-2 text-[10px]">
          Withholding basis: NTN {doc.party_ntn ?? "none"}, ATL status <b>{doc.wht_status}</b>
          {snap.atlCheckedAt ? ` (checked ${snap.atlCheckedAt.slice(0, 10)} via ${snap.atlSource})` : " (not verified)"}. {snap.treatment?.note}
          {snap.overridden ? ` Rate/amount overridden by authorised user: ${snap.overrideReason}.` : ""}
        </div>
      )}
      <p className="mt-6 text-center text-[9px] text-neutral-500" style={{ fontFamily: "Arial, sans-serif" }}>{DEVELOPER_CREDIT}</p>
    </div>
  );
}

function Row({ l, v, bold }: { l: string; v: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? "border-t border-black font-bold" : ""}`}>
      <span>{l}</span>
      <span>{money(v)}</span>
    </div>
  );
}

function ReturnModal({ doc, items, onClose, onDone }: { doc: DistDoc; items: DistDocItem[]; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={doc.doc_type === "sale" ? "Credit note / sales return" : "Purchase return"} onClose={onClose} width="max-w-xl">
      <div className="space-y-2 text-sm">
        <Note>The original document stays unchanged; a {doc.doc_type === "sale" ? "credit note (withholding reversed at the invoice's rate)" : "purchase return"} is created.</Note>
        {items.map((i) => (
          <div key={i.id} className="flex items-center gap-2">
            <span className="flex-1">{i.name}</span>
            <span className="text-xs text-neutral-500">can return {Math.round((i.qty - i.returned_qty) * 1000) / 1000}</span>
            <Input className="!w-24" type="number" min="0" step="any" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
          </div>
        ))}
        <Field label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([itemId, v]) => ({ itemId, qty: Number(v) }));
                if (doc.doc_type === "sale") await dist.createSaleReturn({ invoiceId: doc.id, lines, reason });
                else await dist.createPurchaseReturn({ purchaseId: doc.id, lines, reason });
                onDone();
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Create return
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PayModal({ doc, onClose, onDone }: { doc: DistDoc; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(doc.balance));
  const [method, setMethod] = useState<"cash" | "bank" | "cheque" | "digital">("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={doc.doc_type === "sale" ? "Receive payment" : "Pay supplier"} onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <p className="text-sm">Balance: <b>{money(doc.balance)}</b></p>
        <Field label="Amount"><Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {["cash", "bank", "cheque", "digital"].map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Reference (cheque / transaction no.)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Err error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={async () => { try { await dist.receivePayment({ partyType: doc.party_type, partyId: doc.party_id, amount: Number(amount), method, docId: doc.id, reference }); onDone(); } catch (e) { setError(errorText(e)); } }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
