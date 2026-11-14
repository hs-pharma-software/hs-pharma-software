/** Module saves that work offline (Phase 2), shared by the pages, the desktop
 * and MAVIN.pk. No imports: the web pages use it too. */

/** Saves a business module makes offline, by module: the store function the
 * page called, replayed on MAVIN.pk as the same login with the same ids and clock. */
export const OFFLINE_CALLS = {
  dist: ["createSale", "createBooking", "receivePayment", "createSaleReturn"],
  electric: ["createSale", "createQuotation", "receivePayment", "createReturn"],
} as const;
export type CallModule = keyof typeof OFFLINE_CALLS;
/** The module whose saves work offline, by business type. */
export const CALL_MODULE_FOR_TYPE: Readonly<Record<string, CallModule>> = { distributor: "dist", electronics_solar: "electric" };
export const callAllowed = (module: string, fn: string) =>
  Object.prototype.hasOwnProperty.call(OFFLINE_CALLS, module) && (OFFLINE_CALLS[module as CallModule] as readonly string[]).includes(fn);
