/** The vendor portal's calls (src/server/vendorPortal.ts through /api/vendor-portal). */
import { serverJson } from "./serverMode";
import type { PortalOrder, PortalPayment, PortalRequest } from "../server/vendorPortal";

export type { PortalOrder, PortalPayment, PortalRequest, PortalRequestItem, PaymentStage } from "../server/vendorPortal";

export interface PortalMe { vendorName: string; vendorNo: string | null; hospitalName: string; username: string }

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await serverJson<{ result: T }>("/api/vendor-portal/", { ...body, action });
  return r.result;
}

export const portalMe = () => call<PortalMe>("me");
export const portalRequests = () => call<PortalRequest[]>("requests");
export const portalOrders = () => call<PortalOrder[]>("orders");
export const portalPayments = () => call<PortalPayment[]>("payments");

export interface QuoteInput {
  rfqId: string;
  lines: { itemId: string; rate: number | null; offeredSpec: string | null; available: boolean }[];
  deliveryDays: number | null; validTill: string | null; remarks: string | null;
}
export const sendQuote = (q: QuoteInput) => call<{ ok: true }>("quote", { ...q });
export const declineRequest = (rfqId: string, reason: string) => call<{ ok: true }>("decline", { rfqId, reason });
export const submitInvoice = (x: { poId: string; invoiceNo: string; invoiceDate: string; note: string | null }) => call<{ ok: true; id: string }>("submitInvoice", { ...x });

export const pkr = (n: number) => `Rs ${Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
