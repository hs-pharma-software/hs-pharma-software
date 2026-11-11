/** The only bridge between the page (the MAVIN web app) and the desktop:
 * a fixed list of calls, plus connection/sync status updates. */
import { contextBridge, ipcRenderer } from "electron";

const CALLS = ["status", "request", "rememberSession", "offlineSignIn", "provision", "query", "createSale", "syncNow", "printText"] as const;

contextBridge.exposeInMainWorld("mavinDesktop", {
  ...Object.fromEntries(CALLS.map((c) => [c, (arg?: unknown) => ipcRenderer.invoke(`mavin:${c}`, arg)])),
  onStatus(cb: (s: unknown) => void) {
    const h = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on("mavin:status", h);
    return () => ipcRenderer.removeListener("mavin:status", h);
  },
});
