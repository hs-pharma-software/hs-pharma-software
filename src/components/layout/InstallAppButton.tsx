"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

/** The browser's own install prompt (Chrome / Edge / Android), kept for later. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let saved: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // no automatic banner; the person chooses "Install app"
    saved = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    saved = null;
    listeners.forEach((l) => l());
  });
}

/** "Install app": shown only when the browser offers installing MAVIN.pk
 * (it adds a home-screen shortcut that opens the same web app). Hidden
 * everywhere else, including when it is already open as an installed app. */
export function InstallAppButton({ className = "" }: { className?: string }) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  if (!saved) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const e = saved;
        if (!e) return;
        await e.prompt();
        await e.userChoice.catch(() => undefined);
        saved = null;
        rerender((n) => n + 1);
      }}
    >
      <Download size={16} /> Install app
    </button>
  );
}
