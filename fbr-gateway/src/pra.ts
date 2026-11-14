/** The only PRA call the gateway makes: eIMS cloud PostData (PRA / PRAL
 * eIMS manual v1.0 §6.4.2), sandbox or production, from this server's static
 * IP (the one PRA whitelists for production). Never an open proxy. */

export type PraEnvironment = "sandbox" | "production";

export const praPath = (env: PraEnvironment) => `/ims/${env}/api/Live/PostData`;

/** An eIMS invoice: POSID (number), USIN, and 1-500 items; nothing huge. */
export function praPayloadOk(p: unknown): boolean {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const o = p as Record<string, unknown>;
  if (typeof o.POSID !== "number" || !Number.isSafeInteger(o.POSID) || o.POSID <= 0) return false;
  if (typeof o.USIN !== "string" || !o.USIN || o.USIN.length > 50) return false;
  if (!Array.isArray(o.Items) || !o.Items.length || o.Items.length > 500) return false;
  if (o.InvoiceType !== 1 && o.InvoiceType !== 2 && o.InvoiceType !== 3) return false;
  return o.Items.every((i) => i && typeof i === "object" && typeof (i as Record<string, unknown>).PCTCode === "string");
}
