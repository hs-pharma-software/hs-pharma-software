/** The only bridge between the page and the device: a fixed list of calls. */
import { contextBridge, ipcRenderer } from "electron";

const CALLS = ["status", "provision", "signIn", "signOut", "search", "createSale", "sync", "recentSales", "receipt", "print", "diagnostics", "backup", "online"] as const;

contextBridge.exposeInMainWorld(
  "mavin",
  Object.fromEntries(CALLS.map((c) => [c, (arg?: unknown) => ipcRenderer.invoke(`mavin:${c}`, arg)])),
);
