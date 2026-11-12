import { invoke } from "@tauri-apps/api/core";
import { PAPERS, type PaperSize } from "./printTemplates";
import { isTauri } from "./platform";
import { localBridge } from "./edition";

const PX_PER_MM = 96 / 25.4;

/** Prints the current page (only `.print-area` is visible in print CSS)
 * straight to the default Windows printer, with no print dialog. Falls back
 * to the browser dialog outside the desktop app or if WebView2 can't print
 * silently. `area` is measured so thermal rolls get an exact page length. */
export async function printDirect(paper: PaperSize, area?: HTMLElement | null): Promise<void> {
  const p = PAPERS.find((x) => x.id === paper)!;
  // Logos (pharmacy, FBR) must be loaded or they print blank.
  if (area) {
    await Promise.all(
      Array.from(area.querySelectorAll("img"))
        .filter((img) => !img.complete)
        .map((img) => new Promise<void>((done) => {
          img.addEventListener("load", () => done(), { once: true });
          img.addEventListener("error", () => done(), { once: true });
          setTimeout(done, 3000);
        }))
    );
  }
  const heightMm =
    paper === "a4" ? 297 : paper === "a5" ? 210 : Math.ceil((area?.scrollHeight ?? 600) / PX_PER_MM) + p.marginMm * 2 + 5;
  // Mavin Pharmacy Offline: Windows printing through the desktop (default printer, no dialog).
  const local = localBridge();
  if (local) {
    const r = await local.print({ widthMm: p.widthMm, heightMm, marginMm: p.marginMm, silent: true });
    if (!r.ok) { console.warn("silent print failed, falling back to the print dialog", r.error); window.print(); }
    return;
  }
  if (!isTauri()) {
    window.print();
    return;
  }
  try {
    await invoke("print_silent", { widthMm: p.widthMm, heightMm, marginMm: p.marginMm });
  } catch (e) {
    console.warn("silent print failed, falling back to the print dialog", e);
    window.print();
  }
}
