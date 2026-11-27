/** The vendor portal's calls (src/server/vendorPortal.ts through /api/vendor-portal). */
import { serverJson } from "./serverMode";
import type { PortalOrder, PortalPayment, PortalRequest } from "../server/vendorPortal";
import type { VendorAccount } from "../server/vendorRegistration";
import type { EpCategory, ProfileStep, VendorProfile, VendorStatus } from "./vendorProfile";

export type { PortalOrder, PortalPayment, PortalRequest, PortalRequestItem, PaymentStage } from "../server/vendorPortal";

/** `hospitals`: every hospital this vendor supplies through the portal; `hospitalName`: one name, or "N hospitals". */
export interface PortalMe { vendorName: string; vendorNo: string | null; hospitalName: string; hospitals: string[]; username: string }

/** The vendor's own new password (the server ends their other sessions). */
export const changeOwnPassword = (newPassword: string) => serverJson<{ ok: true }>("/api/auth/password/", { newPassword });

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

// ── Registration (works before approval) ────────────────────────────────────
export type { VendorAccount } from "../server/vendorRegistration";
export type { VendorProfile, VendorStatus, BusinessKind, EpCategory, ProfileStep } from "./vendorProfile";

export const portalAccount = () => call<VendorAccount>("account");
export const portalCategories = () => call<EpCategory[]>("categories");
export const saveProfileStep = (step: ProfileStep, profile: VendorProfile) => call<{ ok: true; problems: Record<string, string> }>("saveProfile", { step, profile });
export const submitRegistration = () => call<{ ok: true; status: VendorStatus }>("submitRegistration", { confirmed: true });

export interface SignUpInput { companyName: string; contactName: string; email: string; phone: string; username: string; password: string }
/** A vendor's own new account (no sign-in yet); sign in with it next. */
export const vendorSignUp = (x: SignUpInput) => serverJson<{ ok: true; username: string }>("/api/vendor-portal/signup/", { ...x });
