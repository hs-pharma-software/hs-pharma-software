/** The only bridge between the page (MAVIN's Pharmacy screens) and Mavin
 * Pharmacy Offline: a fixed list of calls (src/lib/edition.ts LocalBridge). */
import { contextBridge, ipcRenderer } from "electron";

const CALLS = [
  "info", "select", "execute", "batch", "setup", "login", "checkSession", "logout", "setPassword", "recover", "newRecoveryKey",
  "saveText", "license", "importLicense", "requestCode", "backup", "restore", "print", "catalogueStatus", "catalogueSync", "audit",
] as const;

contextBridge.exposeInMainWorld("mavinLocal", Object.fromEntries(CALLS.map((c) => [c, (arg?: unknown) => ipcRenderer.invoke(`mp:${c}`, arg)])));
