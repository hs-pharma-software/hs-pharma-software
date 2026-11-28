import { invoke } from "@tauri-apps/api/core";
import { PAPERS, type PaperSize } from "./printTemplates";
import { isTauri } from "./platform";
import { localBridge } from "./edition";
import { desktopBridge } from "./desktopBridge";

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
  // The MAVIN Windows app: straight to Windows' default printer, without a dialog.
  const desktop = desktopBridge();
  if (desktop?.printPage) {
    const r = await desktop.printPage({ widthMm: p.widthMm, heightMm, marginMm: p.marginMm });
    if (!r.ok) throw new Error(`${r.error} Check the default printer in Windows.`);
    return;
  }
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

/** Shrinks `area` (at most to 75%) so it prints on a single A4 page, and
 * returns a function that puts it back. A report whose signature and QR code
 * would otherwise spill alone onto a second page then fits on one. */
export function fitToA4Page(area: HTMLElement | null): () => void {
  if (!area) return () => {};
  const p = PAPERS.find((x) => x.id === "a4")!;
  const prev = { width: area.style.width, maxWidth: area.style.maxWidth, zoom: area.style.zoom };
  // Measured at the printed width, where lines wrap as they will on paper.
  area.style.maxWidth = "none";
  area.style.width = `${p.widthMm - p.marginMm * 2}mm`;
  area.style.zoom = "1";
  const pageHeight = (297 - p.marginMm * 2) * PX_PER_MM;
  const height = area.scrollHeight;
  area.style.width = prev.width;
  area.style.maxWidth = prev.maxWidth;
  // A little room for rounding by the printer.
  const scale = height > pageHeight * 0.98 ? Math.max(0.75, (pageHeight * 0.97) / height) : 1;
  area.style.zoom = scale < 1 ? String(scale) : prev.zoom;
  return () => { area.style.zoom = prev.zoom; };
}
