/** MAVIN desktop app, offline: the saves listed in OFFLINE_CALLS (distribution,
 * electronics) go to the desktop, which makes them on this computer's copy
 * and sends them to MAVIN.pk later. Online, and in a browser, nothing changes. */
import { desktopBridge, desktopOffline } from "@/lib/desktopBridge";
import { callAllowed, type CallModule } from "@/offline/callList";

export function offlineCapable<T extends object>(module: CallModule, store: T): T {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== "string" || typeof v !== "function" || !callAllowed(module, prop)) return v;
      return async (...args: unknown[]) => {
        const b = desktopBridge();
        if (b?.moduleCall && desktopOffline()) {
          const r = await b.moduleCall({ module, fn: prop, args });
          if (!r.ok) throw new Error(r.error);
          return r.value.result;
        }
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
