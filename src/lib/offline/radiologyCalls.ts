/** MAVIN desktop app, Radiology Centre without internet: the screens' saves go
 * to this computer's local copy and reach MAVIN.pk when the connection returns.
 * Online, and in a browser, nothing here is used. */
import { desktopBridge, desktopOffline } from "@/lib/desktopBridge";
import { localDateTime } from "@/lib/localDate";
import { useAuthStore } from "@/store/authStore";

export const radiologyOffline = () =>
  desktopOffline() && useAuthStore.getState().currentTenant?.businessType === "radiology_center" && Boolean(desktopBridge()?.moduleCall);

/** Saves on this computer, with the local time the printed papers show. */
export async function radiologyCall<T>(fn: string, input: Record<string, unknown>): Promise<T> {
  const r = await desktopBridge()!.moduleCall!({ module: "radiology", fn, args: [{ ...input, time: localDateTime() }] });
  if (!r.ok) throw new Error(r.error);
  return r.value.result as T;
}
